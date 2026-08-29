/**
 * Regras de arquivo dos anexos do motorista, compartilhadas entre o card de
 * documentos (detalhe) e o bloco de anexos do cadastro (`driver-form`).
 * Fonte única: divergir os dois é aceitar no cadastro um arquivo que o card
 * (e o backend) recusariam.
 */

/**
 * Teto do cliente, alinhado ao `MAX_BYTES` de `DriverDocumentService`.
 * A guarda existe para falhar ANTES de gastar a franquia de dados de quem está
 * fotografando a CNH pelo celular.
 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Allowlist espelhada do backend — o que não está aqui seria recusado lá. */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];

/** Valor do atributo `accept` dos seletores de arquivo de documento. */
export const DOCUMENT_ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,' +
  '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif';

export function isAllowedDocumentFile(file: File): boolean {
  if (ALLOWED_MIME_TYPES.includes(file.type)) return true;
  // Alguns Android entregam `type` vazio para HEIC — cai no nome do arquivo.
  const name = file.name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function formatDocumentSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
