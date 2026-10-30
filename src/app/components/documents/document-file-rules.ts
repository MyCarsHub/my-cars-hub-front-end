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
 * Teto do cliente: o `file_size_limit` do bucket, o menor limite do caminho.
 * A guarda existe para falhar ANTES de gastar a franquia de dados de quem está
 * fotografando o documento pelo celular.
 */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_LABEL = '10MB';

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

/**
 * Foto do veículo (kind PHOTO, V115): sai da MESMA allowlist dos documentos,
 * estreitada ao que o servidor aceita para PHOTO e a `<img>` desenha — JPG, PNG
 * e WebP. PDF e HEIC/HEIF são recusados lá (`MSG_PHOTO_NOT_IMAGE`); recusar aqui
 * antes poupa a franquia de dados de quem escolheu o arquivo no celular e, na
 * TROCA, evita apagar a foto atual para só então descobrir que a nova não serve.
 *
 * O TETO é outro: `MAX_PHOTO_BYTES` espelha o `file_size_limit` do bucket
 * `rental-docs`, que é o limite que de fato derruba o envio (o arquivo passaria
 * pelo backend e cairia no storage como 500). Vale para o arquivo JÁ comprimido:
 * foto de câmera acima do teto entra, reduz e sobe.
 */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTO_LABEL = '10MB';

export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const PHOTO_ACCEPT = [
  ...PHOTO_MIME_TYPES.filter((m) => m !== 'image/jpg'),
  ...PHOTO_EXTENSIONS,
].join(',');

export function isAllowedPhotoFile(file: File): boolean {
  if (PHOTO_MIME_TYPES.includes(file.type)) return true;
  // `type` vazio em alguns Android: cai no nome do arquivo.
  const name = file.name.toLowerCase();
  return PHOTO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function formatDocumentSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
