import { UnreadAnnouncement } from './announcement.types';

/**
 * Uma novidade na página Novidades (`GET /v1/announcements`): os campos do popup mais quando
 * foi publicada e se ESTA pessoa já leu. Espelho de `AnnouncementFeedItemDto` no backend.
 */
export interface AnnouncementFeedItem extends UnreadAnnouncement {
  /** `LocalDateTime` do servidor, sem fuso (`yyyy-MM-ddTHH:mm:ss`). */
  publishedAt: string | null;
  read: boolean;
}

/**
 * Uma página do feed, mais nova primeiro. Sem total: `hasMore` diz se há próxima (o servidor
 * pede um item a mais). Espelho de `AnnouncementFeedPageDto`.
 */
export interface AnnouncementFeedPage {
  content: AnnouncementFeedItem[];
  page: number;
  size: number;
  hasMore: boolean;
}
