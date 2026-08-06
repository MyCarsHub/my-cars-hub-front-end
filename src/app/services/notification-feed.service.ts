import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { DestroyRef, Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, catchError, finalize, map, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import { MarkAllReadResult, NotificationItem, UnreadCount } from '../types/notification-feed.types';
import { SessionService } from './session.service';

const BASE = `${environment.apiUrl}/notifications`;

/** Intervalo do polling do contador de não lidas. */
const POLL_INTERVAL_MS = 60_000;

/**
 * Feed de notificações persistidas (sino do header + `/alertas`).
 *
 * NÃO é o barramento de toasts (`notification.service.ts`) — são conceitos
 * diferentes e não devem ser fundidos.
 *
 * Contrato importante: `PATCH /read-all` devolve a quantidade de linhas
 * marcadas AGORA, não o restante — depois dele o não-lidas é sempre 0.
 * Por isso o contador é zerado localmente, e nunca alimentado com `count`.
 *
 * O estado de leitura é **por usuário**, não por empresa: dois membros da mesma
 * company têm sinos independentes. Por isso o cache é invalidado tanto na troca
 * de empresa quanto na troca de usuário (`syncTenant()`), e nunca compartilhado
 * entre sessões na mesma aba.
 *
 * O contador nunca é atualizado de forma otimista: só depois do 2xx.
 */
@Injectable({ providedIn: 'root' })
export class NotificationFeedService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly _items = signal<NotificationItem[]>([]);
  private readonly _page = signal(0);
  private readonly _size = signal(10);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _unreadCount = signal(0);

  readonly items = this._items.asReadonly();
  readonly page = this._page.asReadonly();
  readonly size = this._size.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly unreadCount = this._unreadCount.asReadonly();

  /** Últimos parâmetros de `list()` — usados para recarregar após mutações. */
  private lastUnreadOnly = false;

  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private visibilityListener: (() => void) | null = null;

  /**
   * Empresa e usuário donos dos dados atualmente em cache. Serviço root
   * sobrevive à troca de tenant (que só navega, sem destruir o AppShell), então
   * guardamos os ids para detectar a troca em `syncTenant()`. O usuário entra
   * na chave porque o estado de leitura é por usuário: o não-lidas de quem
   * estava logado antes não pode ser reaproveitado por quem entrou depois.
   */
  private cachedCompanyId: string | null = null;
  private cachedUserId: string | null = null;

  constructor() {
    // Serviço root: o DestroyRef do injector raiz morre junto com a aplicação,
    // então o interval e o listener não vazam entre testes/SSR.
    inject(DestroyRef).onDestroy(() => this.stopPolling());
    this.cachedCompanyId = this.session.getItem('selectedCompanyId');
    this.cachedUserId = this.session.getItem('id');
  }

  /**
   * Zera o cache para o estado inicial. Obrigatório no logout: o serviço é
   * `providedIn: 'root'` e sobrevive ao `sessionStorage.clear()`, então sem
   * isso o próximo usuário logado na MESMA aba veria os títulos (que carregam
   * placa/nome) do usuário anterior enquanto o primeiro fetch não volta.
   */
  reset(): void {
    this._items.set([]);
    this._page.set(0);
    this._size.set(10);
    this._total.set(0);
    this._loading.set(false);
    this._error.set(null);
    this._unreadCount.set(0);
    this.lastUnreadOnly = false;
    this.cachedCompanyId = this.session.getItem('selectedCompanyId');
    this.cachedUserId = this.session.getItem('id');
  }

  /**
   * Reconcilia o cache com a empresa E o usuário da sessão. Idempotente: só
   * age quando algum dos dois realmente mudou, e então zera o cache e dispara
   * um tick imediato em vez de esperar até 60s pelo próximo poll.
   *
   * O usuário conta porque `read` / `unread-count` são por usuário: reaproveitar
   * o contador do anterior mostraria o sino de outra pessoa.
   */
  syncTenant(): void {
    const companyId = this.session.getItem('selectedCompanyId');
    const userId = this.session.getItem('id');
    if (companyId === this.cachedCompanyId && userId === this.cachedUserId) return;
    this.reset();
    this.cachedCompanyId = companyId;
    this.cachedUserId = userId;
    this.tickUnreadCount();
  }

  /** `GET /v1/notifications`. */
  list(unreadOnly = false, page = 0, size = 10): Observable<PagedResponse<NotificationItem>> {
    this._loading.set(true);
    this._error.set(null);
    this.lastUnreadOnly = unreadOnly;

    let params = new HttpParams().set('page', String(page)).set('size', String(size));
    if (unreadOnly) params = params.set('unreadOnly', 'true');

    return this.http.get<PagedResponse<NotificationItem>>(BASE, { params }).pipe(
      tap((res) => {
        this._items.set(res.content ?? []);
        this._page.set(res.page ?? 0);
        this._size.set(res.size ?? size);
        this._total.set(res.total ?? 0);
      }),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar as notificações.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  /** `GET /v1/notifications/unread-count`. */
  refreshUnreadCount(): Observable<UnreadCount> {
    return this.http
      .get<UnreadCount>(`${BASE}/unread-count`)
      .pipe(tap((res) => this._unreadCount.set(res?.count ?? 0)));
  }

  /**
   * `PATCH /v1/notifications/{id}/read` → 204, marcando para o usuário do
   * token. Decrementa o contador só depois do 2xx e recarrega a lista com os
   * últimos filtros.
   *
   * Remarcar algo que o usuário já leu responde sucesso (não 404) e NÃO renova
   * a data de leitura — só id de outra empresa dá 404. Por isso a chamada é
   * segura de repetir e não precisa de guarda otimista.
   */
  markRead(id: string): Observable<void> {
    return this.http.patch(`${BASE}/${id}/read`, {}, { responseType: 'text' }).pipe(
      map(() => void 0),
      tap(() => {
        this._unreadCount.update((c) => Math.max(0, c - 1));
        this._items.update((list) => list.map((it) => (it.id === id ? { ...it, read: true } : it)));
        this.reloadCurrent();
      }),
    );
  }

  /**
   * `PATCH /v1/notifications/read-all`. O `count` devolvido são as linhas
   * marcadas agora PARA ESTE USUÁRIO — não o total da empresa e não o restante.
   * Depois dele o não-lidas do usuário é sempre 0, então zeramos localmente.
   */
  markAllRead(): Observable<MarkAllReadResult> {
    return this.http.patch<MarkAllReadResult>(`${BASE}/read-all`, {}).pipe(
      tap(() => {
        this._unreadCount.set(0);
        this._items.update((list) => list.map((it) => ({ ...it, read: true })));
        this.reloadCurrent();
      }),
    );
  }

  /**
   * Liga o polling do contador. Idempotente — chame no `ngOnInit` do sino.
   * Não roda em SSR, não roda com a aba escondida e não roda sem token.
   */
  startPolling(): void {
    if (!isPlatformBrowser(this.platformId) || this.pollHandle !== null) return;

    this.tickUnreadCount();
    this.pollHandle = setInterval(() => this.tickUnreadCount(), POLL_INTERVAL_MS);

    // Voltar pra aba deve refletir o estado atual sem esperar o próximo tick.
    this.visibilityListener = () => {
      if (!document.hidden) this.tickUnreadCount();
    };
    document.addEventListener('visibilitychange', this.visibilityListener);
  }

  stopPolling(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.visibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
    }
    this.visibilityListener = null;
  }

  private tickUnreadCount(): void {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!this.session.getToken()) return;
    this.refreshUnreadCount().subscribe({ error: () => void 0 });
  }

  /**
   * Recarrega a página atual do feed após uma mutação. O observable do HTTP
   * completa sozinho, então não há inscrição pendente para limpar.
   */
  private reloadCurrent(): void {
    this.list(this.lastUnreadOnly, this._page(), this._size()).subscribe({
      error: () => void 0,
    });
  }
}
