import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SILENT_HTTP_ERRORS } from '../../services/http-errors.context';
import {
  IMPERSONATION_ADMIN_TOKEN_KEY,
  IMPERSONATION_STATE_KEY,
} from '../../services/impersonation.context';
import { SessionResetRegistry } from '../../services/session-reset.registry';
import { SessionService } from '../../services/session.service';
import { UnreadAnnouncement } from '../../types/announcement.types';
import { Notice, NoticesService } from './notices.service';

const BASE = `${environment.apiUrl}/announcements`;

/** Prefixo do id do aviso na fila (`news:<id da novidade>`). */
export const NEWS_NOTICE_PREFIX = 'news:';

/**
 * Novidades do produto entregues pelo servidor, mostradas no popup de avisos que JÁ existe
 * (`NoticesService` + `NoticesPopup`) — não há um segundo popup.
 *
 * - Todas as não lidas, uma depois da outra, a mais antiga primeiro (ordem do servidor).
 * - Qualquer saída do aviso (Entendi, X, Esc, fundo, link) marca como lida UMA vez.
 * - Sem marca de sessão: o servidor só devolve as não lidas, então um reload no meio da
 *   sequência retoma as que faltam e nunca repete as já fechadas.
 * - Lembrete bloqueante na tela tem prioridade: cada novidade só entra com a fila vazia.
 * - Falha da busca nunca bloqueia o app: o erro é engolido e nada aparece.
 * - Sessão de suporte ("Ver como empresa") nem busca nem marca: o admin não pode "ler"
 *   a novidade no lugar do cliente (o servidor também recusa, 403).
 */
@Injectable({ providedIn: 'root' })
export class NewsNoticesService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);
  private readonly notices = inject(NoticesService);
  private readonly context = (): HttpContext => new HttpContext().set(SILENT_HTTP_ERRORS, true);

  /** Uma tentativa por carga do app (o shell chama a cada navegação). */
  private attempted = false;
  /** Novidades buscadas esperando a fila esvaziar, a próxima primeiro. */
  private readonly pending = signal<readonly UnreadAnnouncement[]>([]);
  /**
   * Sobe a cada logout: resposta de busca e desfecho de aviso que chegam depois pertencem à
   * sessão anterior e são descartados (nunca mostrados nem marcados como lidos por outra pessoa).
   */
  private generation = 0;
  /** Aviso de novidade enfileirado nesta sessão (para tirá-lo da fila no logout). */
  private queuedId: string | null = null;

  constructor() {
    inject(SessionResetRegistry).register(() => this.reset());
    effect(() => {
      const [next, ...rest] = this.pending();
      if (!next || this.notices.current()) return;
      if (this.isSupportSession()) {
        this.pending.set([]);
        return;
      }
      this.pending.set(rest);
      this.show(next);
    });
  }

  unread(): Observable<UnreadAnnouncement[]> {
    return this.http.get<UnreadAnnouncement[]>(`${BASE}/unread`, { context: this.context() });
  }

  markRead(id: string): Observable<void> {
    return this.http.post<void>(`${BASE}/${encodeURIComponent(id)}/read`, null, {
      context: this.context(),
    });
  }

  /** Chamado pelo shell quando a área de empresa/motorista está pronta. Idempotente. */
  maybeShow(): void {
    if (this.attempted) return;
    if (this.isSupportSession()) return;
    // Só o token de empresa (ACCESS) tem público; sem empresa não há novidade.
    if (this.session.getCompanyIdFromToken() === null) return;
    this.attempted = true;
    const gen = this.generation;
    this.unread().subscribe({
      next: (list) => {
        if (gen !== this.generation) return;
        const unread = Array.isArray(list) ? list.filter((a) => !!a?.id) : [];
        if (!unread.length || this.isSupportSession()) return;
        this.pending.set(unread);
      },
      error: () => void 0,
    });
  }

  private show(item: UnreadAnnouncement): void {
    const items = (item.items ?? []).filter((s) => !!s && s.trim().length > 0);
    const notice: Notice = {
      id: NEWS_NOTICE_PREFIX + item.id,
      type: 'NEWS',
      title: item.title,
      message: item.body,
      items: items.length ? items : undefined,
      link:
        item.linkUrl && item.linkLabel ? { label: item.linkLabel, route: item.linkUrl } : undefined,
      dismissLabel: 'Entendi',
      audience: this.session.getCompanyRoleFromToken() === 'DRIVER' ? 'MOTORISTA' : 'LOCADORA',
      media:
        item.mediaType && item.mediaUrl
          ? {
              type: item.mediaType,
              url: item.mediaUrl,
              width: item.mediaWidth ?? null,
              height: item.mediaHeight ?? null,
              // URL assinada vence (~1 h): se falhar, pede a lista de novo e pega a desta novidade.
              refresh: () =>
                this.unread().pipe(
                  map((list) => (Array.isArray(list) ? list : []).find((a) => a.id === item.id)?.mediaUrl ?? null),
                ),
            }
          : undefined,
    };
    const gen = this.generation;
    this.queuedId = notice.id;
    this.notices.enqueue(notice).subscribe(() => {
      if (this.queuedId === notice.id) this.queuedId = null;
      if (gen !== this.generation || this.isSupportSession()) return;
      this.markRead(item.id).subscribe({ error: () => void 0 });
    });
  }

  /** Logout: a próxima pessoa nesta mesma carga do app começa do zero. */
  private reset(): void {
    this.generation++;
    this.attempted = false;
    // Descarta TODAS as que esperavam, sem marcar nenhuma como lida.
    this.pending.set([]);
    const queued = this.queuedId;
    this.queuedId = null;
    // Sai da fila sem marcar como lida (a geração já mudou).
    if (queued) this.notices.dismiss(queued);
  }

  private isSupportSession(): boolean {
    return (
      this.session.getItem(IMPERSONATION_STATE_KEY) !== null ||
      this.session.getItem(IMPERSONATION_ADMIN_TOKEN_KEY) !== null
    );
  }
}
