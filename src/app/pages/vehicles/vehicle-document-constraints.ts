/**
 * Regras de anexo de documento de veículo, compartilhadas entre o card de
 * documentos do detalhe (`vehicle-documents-card`) e o bloco de arquivos
 * pendentes do cadastro (`vehicle-form`). Espelham `VehicleDocumentService`
 * no backend — afrouxar aqui só muda o LUGAR do erro, não o resultado.
 */

/**
 * Teto do cliente, alinhado ao `MAX_BYTES` de `VehicleDocumentService`.
 * A guarda existe para falhar ANTES de gastar a franquia de dados de quem está
 * fotografando o CRLV pelo celular.
 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Allowlist espelhada do backend — o que não está aqui seria recusado lá. */
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

export const ALLOWED_DOCUMENT_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
  '.heif',
];

/** Valor pronto para o `accept` do `<input type="file">`. */
export const VEHICLE_DOCUMENT_ACCEPT = [
  ...ALLOWED_DOCUMENT_MIME_TYPES,
  ...ALLOWED_DOCUMENT_EXTENSIONS,
].join(',');

export function isAllowedDocumentFile(file: File): boolean {
  if (ALLOWED_DOCUMENT_MIME_TYPES.includes(file.type)) return true;
  // Alguns Android entregam `type` vazio para HEIC — cai no nome do arquivo.
  const name = file.name.toLowerCase();
  return ALLOWED_DOCUMENT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function formatDocumentSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
