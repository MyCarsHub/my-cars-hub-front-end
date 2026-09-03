/**
 * FONTE ÚNICA das regras de arquivo de documento (FIX-0231, supersede o
 * FIX-0150): allowlist, teto de tamanho, `accept` do seletor e formatação de
 * tamanho, compartilhados por TODOS os módulos que anexam documento a um pai
 * (motorista, veículo, manutenção — e os próximos).
 *
 * As cópias por módulo (`vehicle-document-constraints`;
 * `maintenance-document-upload`) viram re-exports daqui — a do motorista foi
 * DELETADA (todo o módulo de motoristas importa direto daqui): divergi-las era
 * aceitar num cadastro um arquivo que outro card (e o backend) recusariam.
 *
 * A allowlist espelha o backend e NÃO PODE ESTREITAR (decisão do usuário):
 * WebP/HEIC ficam — câmera de iPhone manda HEIC. O texto de descrição dos
 * cards pode prometer menos formato do que isto aceita; o inverso, nunca.
 */

/**
 * Teto do cliente, alinhado ao `MAX_BYTES` dos `*DocumentService` do backend.
 * A guarda existe para falhar ANTES de gastar a franquia de dados de quem está
 * fotografando o documento pelo celular.
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

/**
 * Valor do atributo `accept` dos seletores de arquivo de documento.
 * `image/jpg` fica fora do accept (não é MIME registrado; `.jpg` cobre o
 * caso) mas permanece na allowlist acima como segunda chance de validação.
 */
export const DOCUMENT_ACCEPT = [
  ...ALLOWED_DOCUMENT_MIME_TYPES.filter((m) => m !== 'image/jpg'),
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
