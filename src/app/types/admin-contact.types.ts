/** De quem é o contato. O backend resolve o telefone na tabela certa, por id. */
export type ContactSubjectType = 'USER' | 'DRIVER' | 'COMPANY';

/** Para que o número foi revelado. Vai para a trilha de auditoria (nunca o número). */
export type ContactChannel = 'VIEW' | 'WHATSAPP' | 'CALL' | 'COPY';

/** Resposta de `POST /v1/admin/contacts/reveal`. `available=false` = "sem telefone". */
export interface RevealedContact {
  subjectType: ContactSubjectType;
  subjectId: string;
  available: boolean;
  /** +5511987654321 */
  e164: string | null;
  /** (11) 98765-4321 */
  display: string | null;
  /** https://wa.me/5511987654321 — sem texto; use `withWhatsAppText` para pré-preencher. */
  waLink: string | null;
  /** tel:+5511987654321 */
  telLink: string | null;
  mobile: boolean;
  email: string | null;
}
