import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SILENT_HTTP_ERRORS } from '../../services/http-errors.context';
import {
  IMPERSONATION_ADMIN_TOKEN_KEY,
  IMPERSONATION_STATE_KEY,
} from '../../services/impersonation.context';
import { SessionService } from '../../services/session.service';
import { UnreadAnnouncement } from '../../types/announcement.types';
import { Notice, NoticesService } from './notices.service';

const BASE = `${environment.apiUrl}/announcements`;

/** Chave de sessão: já mostramos UMA novidade nesta sessão (por usuário). */
export const NEWS_SHOWN_KEY = 'mch:news-shown';

/** Prefixo do id do aviso na fila (`news:<id da novidade>`). */
export const NEWS_NOTICE_PREFIX = 'news:';

/**
 * Novidades do produto entregues pelo servidor, mostradas no popup de avisos que JÁ existe
 * (`NoticesService` + `NoticesPopup`) — não há um segundo popup.
 *
 * - Uma por sessão: a mais antiga não lida. As demais esperam as próximas sessões.
 * - Qualquer saída do aviso (Entendi, X, Esc, fundo, link) marca como lida UMA vez.
 * - Lembrete bloqueante na tela tem prioridade: a novidade só entra com a fila vazia.
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
  /** Novidade buscada esperando a fila esvaziar. */
  private readonly pending = signal<UnreadAnnouncement | null>(null);

  constructor() {
    effect(() => {
      const next = this.pending();
      if (!next || this.notices.current()) return;
      this.pending.set(null);
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
    if (this.session.getItem(this.shownKey()) === 'true') {
      this.attempted = true;
      return;
    }
    this.attempted = true;
    this.unread().subscribe({
      next: (list) => {
        const oldest = Array.isArray(list) ? list[0] : undefined;
        if (!oldest || this.isSupportSession()) return;
        this.session.setItem(this.shownKey(), 'true');
        this.pending.set(oldest);
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
    };
    this.notices.enqueue(notice).subscribe(() => {
      if (this.isSupportSession()) return;
      this.markRead(item.id).subscribe({ error: () => void 0 });
    });
  }

  private isSupportSession(): boolean {
    return (
      this.session.getItem(IMPERSONATION_STATE_KEY) !== null ||
      this.session.getItem(IMPERSONATION_ADMIN_TOKEN_KEY) !== null
    );
  }

  private shownKey(): string {
    return `${NEWS_SHOWN_KEY}:${this.session.getUserId() ?? 'anon'}`;
  }
}
