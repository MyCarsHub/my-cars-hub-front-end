import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, effect, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { NEWS_NOTICE_PREFIX } from '../components/notices/news-notices.service';
import { NoticesService } from '../components/notices/notices.service';
import { AnnouncementFeedPage } from '../types/announcement-feed.types';
import { UnreadAnnouncement } from '../types/announcement.types';
import { SILENT_HTTP_ERRORS } from './http-errors.context';
import { IMPERSONATION_ADMIN_TOKEN_KEY, IMPERSONATION_STATE_KEY } from './impersonation.context';
import { NewsUnreadBadgeStore } from './news-unread-badge.store';
import { SessionResetRegistry } from './session-reset.registry';
import { SessionService } from './session.service';

const BASE = `${environment.apiUrl}/announcements`;

/** Tamanho de página da tela (o servidor usa o mesmo padrão e corta acima de 50). */
export const NEWS_FEED_PAGE_SIZE = 10;

/**
 * Dados da página Novidades e o contador "N novas" do menu.
 *
 * - `page()` lê o arquivo (`GET /v1/announcements`), mais nova primeiro. A tela NÃO marca
 *   nada como lido: quem marca é o popup (`NewsNoticesService`), uma novidade por sessão.
 * - Sessão de suporte ("Ver como empresa"): o servidor devolve página vazia e o contador nem
 *   é buscado — o admin não "tem" novidades no lugar do cliente.
 * - Erros não abrem toast (`SILENT_HTTP_ERRORS`): a tela mostra o próprio estado de erro e
 *   o contador simplesmente não aparece.
 */
@Injectable({ providedIn: 'root' })
export class NewsFeedService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);
  private readonly badge = inject(NewsUnreadBadgeStore);
  private readonly notices = inject(NoticesService);
  private readonly context = (): HttpContext => new HttpContext().set(SILENT_HTTP_ERRORS, true);

  /** Pessoa + papel do último contador buscado: troca de empresa com outro papel busca de novo. */
  private countedFor: string | null = null;
  /** Sobe a cada logout: resposta atrasada da sessão anterior é descartada. */
  private generation = 0;

  constructor() {
    inject(SessionResetRegistry).register(() => this.reset());
    // Uma novidade que sai do popup foi lida (o popup marca): o chip do menu desconta uma.
    let shownNewsId: string | null = null;
    effect(() => {
      const current = this.notices.current();
      const id = current && current.id.startsWith(NEWS_NOTICE_PREFIX) ? current.id : null;
      if (shownNewsId && shownNewsId !== id && !this.isSupportSession()) {
        this.badge.markRead(shownNewsId.slice(NEWS_NOTICE_PREFIX.length));
      }
      shownNewsId = id;
    });
  }

  page(page: number, size = NEWS_FEED_PAGE_SIZE): Observable<AnnouncementFeedPage> {
    const params = new HttpParams().set('page', String(page)).set('size', String(size));
    return this.http
      .get<AnnouncementFeedPage>(BASE, { params, context: this.context() })
      .pipe(map((res) => normalizePage(res, page, size)));
  }

  /**
   * Busca o contador do menu uma vez por pessoa e papel. O shell chama a cada navegação;
   * repetir é barato (não sai requisição).
   */
  loadUnreadCount(): void {
    if (this.isSupportSession() || this.session.getCompanyIdFromToken() === null) {
      this.badge.set(0);
      return;
    }
    const key = `${this.session.getUserId() ?? 'anon'}:${this.session.getCompanyRoleFromToken() ?? ''}`;
    if (this.countedFor === key) return;
    this.countedFor = key;
    const gen = this.generation;
    this.http
      .get<UnreadAnnouncement[]>(`${BASE}/unread`, { context: this.context() })
      .subscribe({
        next: (list) => {
          if (gen !== this.generation) return;
          this.badge.set(Array.isArray(list) ? list.length : 0);
        },
        error: () => {
          if (gen !== this.generation) return;
          // Tenta de novo na próxima navegação.
          this.countedFor = null;
        },
      });
  }

  private reset(): void {
    this.generation++;
    this.countedFor = null;
    this.badge.clear();
  }

  private isSupportSession(): boolean {
    return (
      this.session.getItem(IMPERSONATION_STATE_KEY) !== null ||
      this.session.getItem(IMPERSONATION_ADMIN_TOKEN_KEY) !== null
    );
  }
}

/** Resposta torta (ou vazia) vira página vazia: a tela nunca quebra por formato. */
function normalizePage(
  res: AnnouncementFeedPage | null | undefined,
  page: number,
  size: number,
): AnnouncementFeedPage {
  return {
    content: Array.isArray(res?.content) ? res.content : [],
    page: typeof res?.page === 'number' ? res.page : page,
    size: typeof res?.size === 'number' ? res.size : size,
    hasMore: res?.hasMore === true,
  };
}
