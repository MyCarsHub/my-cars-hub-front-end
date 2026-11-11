/**
 * Novidades (avisos de produto). Espelho dos DTOs do backend (`/v1/announcements`,
 * `/v1/admin/announcements`). Tudo é TEXTO SIMPLES: a tela renderiza por interpolação,
 * nunca como HTML.
 */

/** Público de uma novidade: LOCADORA = dono e gerente; MOTORISTA = área do motorista. */
export type AnnouncementAudience = 'LOCADORA' | 'MOTORISTA';

/** Situação EFETIVA (publicada com fim no passado já volta EXPIRED). */
export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'EXPIRED';

/** Novidade não lida, como o popup a mostra (`GET /v1/announcements/unread`). */
export interface UnreadAnnouncement {
  id: string;
  title: string;
  body: string;
  items: string[] | null;
  /** `linkUrl` e `linkLabel` vêm os dois ou nenhum. */
  linkUrl: string | null;
  linkLabel: string | null;
  startsOn: string | null;
}

/** Novidade na tela do admin. */
export interface AdminAnnouncement {
  id: string;
  title: string;
  body: string;
  items: string[] | null;
  linkUrl: string | null;
  linkLabel: string | null;
  audiences: AnnouncementAudience[];
  status: AnnouncementStatus;
  /** Datas ISO `yyyy-MM-dd`. `endsOn` nulo = sem fim. */
  startsOn: string | null;
  endsOn: string | null;
  publishedAt: string | null;
  endedAt: string | null;
  createdDate: string | null;
  modifyDate: string | null;
  /** Pessoas que já leram. */
  readCount: number;
}

/** Criar/editar (rascunho aceita público vazio; publicar exige um). */
export interface AnnouncementRequest {
  title: string;
  body: string;
  items: string[];
  linkUrl: string | null;
  linkLabel: string | null;
  audiences: AnnouncementAudience[];
  startsOn: string | null;
  endsOn: string | null;
}

/** Limites da tela e da V142 (o servidor confere de novo). */
export const ANNOUNCEMENT_LIMITS = {
  title: 80,
  body: 280,
  items: 4,
  item: 40,
  linkLabel: 30,
  linkUrl: 300,
} as const;
