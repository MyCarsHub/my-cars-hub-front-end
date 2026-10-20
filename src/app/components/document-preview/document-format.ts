import type { DocumentFormat } from './document-preview.types';

/**
 * Formato pelos BYTES, nunca pelo `mimeType` declarado.
 *
 * O caso que obriga isto: ao receber o webhook do Autentique o backend sobrescreve o MESMO
 * objeto `.docx` do storage com o PDF assinado e nunca atualiza `mime_type` — um contrato
 * AUTO assinado se declara DOCX para sempre. Decidir pelo MIME jogaria bytes de PDF no
 * parser de DOCX (e salvaria o PDF como `.docx`).
 */
export function sniffFormat(head: Uint8Array): DocumentFormat {
  const at = (offset: number, bytes: readonly number[]) =>
    bytes.every((b, i) => head[offset + i] === b);
  const ascii = (offset: number, text: string) =>
    at(
      offset,
      Array.from(text, (c) => c.charCodeAt(0)),
    );

  if (ascii(0, '%PDF-')) return 'pdf';
  // DOCX é um ZIP (`PK\x03\x04`). O visualizador só recebe ZIP de documento Word.
  if (at(0, [0x50, 0x4b, 0x03, 0x04])) return 'docx';
  if (at(0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'webp';
  if (ascii(0, 'GIF8')) return 'gif';
  // ISO-BMFF: `ftyp` no offset 4 e a marca HEIF/HEIC logo depois (câmera de iPhone).
  if (ascii(4, 'ftyp') && ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].some((b) => ascii(8, b))) {
    return 'heic';
  }
  return 'unknown';
}

/** Quantos bytes `sniffFormat` precisa ler. */
export const SNIFF_BYTES = 16;

export const FORMAT_EXTENSION: Record<DocumentFormat, string | null> = {
  pdf: 'pdf',
  docx: 'docx',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  heic: 'heic',
  unknown: null,
};

export const FORMAT_MIME: Record<DocumentFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  unknown: 'application/octet-stream',
};

export const FORMAT_LABEL: Record<DocumentFormat, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  jpeg: 'Imagem JPG',
  png: 'Imagem PNG',
  webp: 'Imagem WEBP',
  gif: 'Imagem GIF',
  heic: 'Imagem HEIC',
  unknown: 'Arquivo',
};

export function isImageFormat(format: DocumentFormat): boolean {
  return (
    format === 'jpeg' || format === 'png' || format === 'webp' || format === 'gif' || format === 'heic'
  );
}

const KNOWN_EXTENSIONS = /\.(pdf|docx?|jpe?g|png|webp|gif|heic|heif)$/i;

/**
 * Nome do arquivo baixado com a extensão que os BYTES pedem. Uma extensão conhecida mas
 * errada no nome é TROCADA (não somada): `Contrato.docx` com bytes de PDF vira
 * `Contrato.pdf`. Formato desconhecido mantém o nome como veio.
 */
export function downloadFileName(fileName: string, format: DocumentFormat): string {
  const base = (fileName.trim() || 'documento').replace(/[\\/:*?"<>|]+/g, '-');
  const ext = FORMAT_EXTENSION[format];
  if (!ext) return base;
  const stem = base.replace(KNOWN_EXTENSIONS, '');
  return `${stem}.${ext}`;
}

/** "1,2 MB" — pt-BR, uma casa. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB`;
  return `${(kb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

/**
 * Tetos de pré-visualização. Acima deles o modal mostra o estado "arquivo grande" em vez
 * de travar uma aba de celular.
 *
 * DOCX herda o teto do card de contrato (o parse é síncrono e CPU-bound: não há
 * "visualizar mesmo assim"). PDF e imagem rendem por página/por demanda, então o estado
 * grande é só um AVISO com a opção de seguir.
 */
export const DOCX_RENDER_LIMIT_BYTES = 8 * 1024 * 1024;
export const PDF_WARN_BYTES = 25 * 1024 * 1024;
export const IMAGE_WARN_BYTES = 25 * 1024 * 1024;
