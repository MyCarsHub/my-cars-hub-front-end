import { MaintenanceDocumentKind } from '../../types/maintenance.types';

/**
 * Regras de aceitação de anexo da manutenção, compartilhadas pelo formulário de
 * CADASTRO (FEAT-0055). Espelham o `MaintenanceDocumentService` do backend: o
 * que não passa aqui seria recusado lá, e falhar no cliente evita gastar a
 * franquia de dados de quem está fotografando a nota na oficina.
 *
 * NOTA DE DUPLICAÇÃO, deliberada e declarada: o `maintenance-documents-card`
 * carrega uma cópia destas mesmas constantes. Ela NÃO foi unificada aqui porque
 * o card pertence a outro nó (FEAT-0051) e o card não podia ser tocado neste.
 * A consolidação é trabalho do FIX-0150, que já existe para extrair a forma
 * N-documentos-por-pai. Enquanto as duas cópias viverem, mexer numa exige mexer
 * na outra — é exatamente esse o risco que o FIX-0150 fecha.
 */
export const MAINTENANCE_DOC_MAX_BYTES = 20 * 1024 * 1024;

/** Allowlist espelhada do backend. */
export const MAINTENANCE_DOC_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

export const MAINTENANCE_DOC_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
  '.heif',
];

/** `accept` do `<input type="file">`, montado a partir da allowlist. */
export const MAINTENANCE_DOC_ACCEPT = [
  ...MAINTENANCE_DOC_MIME_TYPES.filter((m) => m !== 'image/jpg'),
  ...MAINTENANCE_DOC_EXTENSIONS,
].join(',');

/**
 * Alguns Android entregam `type` vazio para HEIC — por isso a extensão do nome
 * é aceita como segunda chance, e não só o MIME declarado.
 */
export function isAllowedMaintenanceDoc(file: File): boolean {
  if (MAINTENANCE_DOC_MIME_TYPES.includes(file.type)) return true;
  const name = file.name.toLowerCase();
  return MAINTENANCE_DOC_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function formatDocSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Um arquivo escolhido no cadastro e ainda NÃO enviado.
 *
 * O `uid` existe porque o envio é sequencial e cada sucesso remove o seu item
 * da fila: sem uma identidade estável, um reenvio depois de falha parcial não
 * saberia quais arquivos já subiram e mandaria tudo de novo, duplicando anexo.
 */
export interface PendingMaintenanceDoc {
  uid: string;
  file: File;
  kind: MaintenanceDocumentKind;
}
