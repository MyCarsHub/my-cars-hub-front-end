import { ANNOUNCEMENT_MEDIA_LIMITS, AnnouncementMediaType } from '../../../types/announcement.types';

/** Tipos que o seletor de arquivo oferece (o servidor confere de novo pelos bytes). */
export const ANNOUNCEMENT_MEDIA_ACCEPT = [
  ...ANNOUNCEMENT_MEDIA_LIMITS.imageTypes,
  ...ANNOUNCEMENT_MEDIA_LIMITS.videoTypes,
].join(',');

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
};

/**
 * Tipo do arquivo escolhido. O `file.type` manda; vazio (alguns Android e Windows não
 * informam) cai na extensão. `null` = formato não aceito.
 */
export function mediaKindOf(file: File): { type: AnnouncementMediaType; contentType: string } | null {
  const declared = (file.type || '').toLowerCase();
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  const contentType = declared || EXTENSION_TYPES[ext] || '';
  if ((ANNOUNCEMENT_MEDIA_LIMITS.imageTypes as readonly string[]).includes(contentType)) {
    return { type: 'IMAGE', contentType };
  }
  if ((ANNOUNCEMENT_MEDIA_LIMITS.videoTypes as readonly string[]).includes(contentType)) {
    return { type: 'VIDEO', contentType };
  }
  return null;
}

/** "9,2 MB", "412 KB" (base 1024, como o servidor). */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('pt-BR')} KB`;
}

/**
 * Conferência na hora de escolher, antes de enviar. Devolve a mensagem para a pessoa ou
 * `null` quando o arquivo pode subir. O servidor é quem decide (ele lê os bytes).
 */
export function validateAnnouncementMedia(file: File): string | null {
  const kind = mediaKindOf(file);
  if (!kind) return 'Esse formato não é aceito. Envie JPG, PNG, WEBP ou MP4.';
  if (file.size <= 0) return 'O arquivo está vazio. Escolha outro.';
  if (kind.type === 'IMAGE' && file.size > ANNOUNCEMENT_MEDIA_LIMITS.imageBytes) {
    return `A imagem tem ${formatBytes(file.size)}. O limite é ${formatBytes(ANNOUNCEMENT_MEDIA_LIMITS.imageBytes)}.`;
  }
  if (kind.type === 'VIDEO' && file.size > ANNOUNCEMENT_MEDIA_LIMITS.videoBytes) {
    return `O vídeo tem ${formatBytes(file.size)}. O limite é ${formatBytes(ANNOUNCEMENT_MEDIA_LIMITS.videoBytes)}.`;
  }
  return null;
}

/** Rótulo curto do formato a partir do content type (`image/webp` → `WEBP`). */
export function formatLabel(contentType: string | null | undefined, type: AnnouncementMediaType | null): string {
  const sub = (contentType ?? '').split('/')[1]?.toUpperCase();
  if (sub === 'JPEG') return 'JPG';
  return sub || (type === 'VIDEO' ? 'MP4' : 'IMAGEM');
}

/** "deitado 16:9" / "em pé 9:16" / "quadrado". */
export function orientationLabel(width: number | null | undefined, height: number | null | undefined): string | null {
  if (!width || !height) return null;
  if (width === height) return 'quadrado';
  return width > height ? 'deitado' : 'em pé';
}
