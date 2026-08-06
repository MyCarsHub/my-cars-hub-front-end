import { HttpErrorResponse } from '@angular/common/http';

/**
 * Screen copy for the invite-specific HTTP statuses.
 *
 * The backend messages for these are accurate but technical ("Invite is in a terminal
 * state"), and 410 in particular is a status no other screen in this app produces — a
 * generic "não encontrado" would tell the invitee the wrong story. So the invite screens
 * own the wording for the statuses below and fall back to `ApiErrorService.messageFor`
 * for everything else.
 *
 * 410 is kept strictly separate from 404: "expirou" is recoverable (ask for a new
 * invite), "não existe" is not.
 */
export type InviteErrorContext = 'manage' | 'accept';

const MANAGE_COPY: Readonly<Record<number, string>> = {
  403: 'Você não tem permissão para gerenciar convites. Peça a um proprietário ou gerente da empresa.',
  404: 'Este convite não existe mais. Atualize a lista para ver os convites atuais.',
  409: 'Este convite mudou de status enquanto você agia sobre ele. Atualize a lista e tente de novo.',
  410: 'Este convite expirou. Envie um novo convite para esta pessoa.',
  429: 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.',
};

const ACCEPT_COPY: Readonly<Record<number, string>> = {
  // `validate` answers 400 when the invite is in a terminal state AND past its deadline.
  400: 'Este convite não é mais válido. Peça à empresa para enviar um novo convite.',
  403: 'Este convite foi enviado para outro e-mail. Saia da conta atual e entre com o e-mail que recebeu o convite.',
  404: 'Convite não encontrado. Confira se você abriu o link mais recente que recebeu por e-mail.',
  409: 'Este convite já foi utilizado. Se a conta já é sua, é só entrar normalmente.',
  410: 'Este convite expirou. Peça à empresa para enviar um novo convite.',
  429: 'Muitas tentativas em pouco tempo. Aguarde um minuto e abra o link novamente.',
};

/**
 * Invite-specific copy for `status`, or `null` when the caller should fall back to the
 * shared extractor. Pure — claiming the error (so `errorInterceptor` does not also toast
 * it) stays the caller's job via `ApiErrorService`.
 */
export function inviteErrorCopy(error: unknown, context: InviteErrorContext): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const copy = context === 'accept' ? ACCEPT_COPY : MANAGE_COPY;
  return copy[error.status] ?? null;
}
