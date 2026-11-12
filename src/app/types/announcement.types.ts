/**
 * Novidades (avisos de produto). Espelho dos DTOs do backend (`/v1/announcements`,
 * `/v1/admin/announcements`). Tudo é TEXTO SIMPLES: a tela renderiza por interpolação,
 * nunca como HTML.
 */

/** Público de uma novidade: LOCADORA = dono e gerente; MOTORISTA = área do motorista. */
export type AnnouncementAudience = 'LOCADORA' | 'MOTORISTA';

/** Situação EFETIVA (publicada com fim no passado já volta EXPIRED). */
export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'EXPIRED';

/** Mídia opcional (uma por novidade). */
export type AnnouncementMediaType = 'IMAGE' | 'VIDEO';

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
  /**
   * Mídia opcional: `mediaType` e `mediaUrl` vêm juntos ou nulos. `mediaUrl` é URL ASSINADA
   * de validade curta (~1 h): nunca guardar em storage; se falhar, pedir de novo.
   * Largura/altura só quando o servidor conseguiu ler do arquivo.
   */
  mediaType?: AnnouncementMediaType | null;
  mediaUrl?: string | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
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
  /** Mídia (toda nula quando não há). `mediaUrl` assinada, validade curta: não guardar. */
  mediaType?: AnnouncementMediaType | null;
  mediaUrl?: string | null;
  mediaContentType?: string | null;
  mediaSizeBytes?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
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

/**
 * Limites da mídia (o servidor confere de novo pelos bytes e é quem decide). Megabyte binário,
 * como o servidor (`5L * 1024 * 1024`).
 */
export const ANNOUNCEMENT_MEDIA_LIMITS = {
  imageBytes: 5 * 1024 * 1024,
  videoBytes: 25 * 1024 * 1024,
  imageTypes: ['image/jpeg', 'image/png', 'image/webp'],
  videoTypes: ['video/mp4'],
  /** Só orientação na tela; o servidor não mede a duração. */
  videoSecondsHint: 30,
} as const;
