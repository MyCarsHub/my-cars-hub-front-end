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

const EMAIL_MISMATCH_COPY =
  'Este convite foi enviado para outro e-mail. ' +
  'Saia da conta atual e entre com o e-mail que recebeu o convite.';

const ACCEPT_COPY: Readonly<Record<number, string>> = {
  // `validate` answers 400 when the invite is in a terminal state AND past its deadline.
  400: 'Este convite não é mais válido. Peça à empresa para enviar um novo convite.',
  // Sem `code`, um 403 continua significando divergência — como sempre significou aqui.
  403: EMAIL_MISMATCH_COPY,
  404: 'Convite não encontrado. Confira se você abriu o link mais recente que recebeu por e-mail.',
  409: 'Este convite já foi utilizado. Se a conta já é sua, é só entrar normalmente.',
  410: 'Este convite expirou. Peça à empresa para enviar um novo convite.',
  429: 'Muitas tentativas em pouco tempo. Aguarde um minuto e abra o link novamente.',
};

/**
 * FIX-0555 — o 403 do aceite tem DUAS causas, e a tela afirmava sempre a mesma.
 *
 * A copy de divergência de e-mail estava sendo mostrada também para quem simplesmente não
 * tem cadastro de motorista na empresa. Isso não é imprecisão de texto: a frase acusa o
 * usuário de um erro que ele não cometeu, manda ele trocar de conta, e a troca falha
 * igual — o dono repetiu a tentativa duas vezes em produção por causa dela. Pior: a
 * mensagem virou a hipótese de quem foi investigar, e a apuração saiu atrás da conta do
 * Google errada. Mensagem de erro é entrada de diagnóstico, não enfeite.
 *
 * O backend distingue as duas pelo campo `code` do corpo, em MAIÚSCULAS. E os STATUS são
 * DIFERENTES: a falta de cadastro é 403, a divergência de e-mail é 400 (`InvalidDataException`).
 * Por isso a classificação é pelo CÓDIGO e não pelo status — um código estável não deveria
 * precisar do status para ser lido, e foi exatamente supor o status que deixou a divergência
 * de e-mail caindo na copy de "convite não é mais válido".
 */
const DRIVER_IDENTITY_NOT_RESOLVED = 'DRIVER_IDENTITY_NOT_RESOLVED';
const INVITE_EMAIL_MISMATCH = 'INVITE_EMAIL_MISMATCH';


/** Ação é do GESTOR, não do convidado — por isso não oferece trocar de conta. */
const DRIVER_IDENTITY_MISSING_COPY =
  'Você ainda não tem cadastro de motorista nesta empresa. ' +
  'Peça ao gestor para cadastrar você antes de aceitar o convite.';

export type InviteAcceptCause = 'driver-identity-missing' | 'email-mismatch';

function errorCode(error: HttpErrorResponse): string | null {
  const body = error.error as { code?: unknown } | null | undefined;
  return typeof body?.code === 'string' ? body.code.trim().toUpperCase() : null;
}

/**
 * Qual das duas causas produziu o 403 do aceite; `null` se o erro não é um 403 de aceite.
 *
 * DELIBERADAMENTE TOLERANTE À AUSÊNCIA DO CAMPO: enquanto o backend não emitir `code`, ou
 * se emitir um código desconhecido, cai em `'email-mismatch'` — que é exatamente o
 * comportamento de hoje. A tela não pode quebrar por um campo que ainda não existe, e o
 * caso novo só se ativa quando o servidor de fato o afirma.
 */
export function inviteAcceptCause(error: unknown): InviteAcceptCause | null {
  if (!(error instanceof HttpErrorResponse)) return null;

  const code = errorCode(error);
  if (code === DRIVER_IDENTITY_NOT_RESOLVED) return 'driver-identity-missing';
  if (code === INVITE_EMAIL_MISMATCH) return 'email-mismatch';

  // Sem código (ou com um desconhecido) só o 403 continua significando divergência, que é o
  // comportamento de hoje. Os outros status seguem com o mapa por status, intocados: o mesmo
  // 400 mudo ainda é lançado por token em branco e por convite não-PENDING, e inventar uma
  // causa para ele aqui só trocaria uma afirmação errada por outra.
  return error.status === 403 ? 'email-mismatch' : null;
}

/**
 * Invite-specific copy for `status`, or `null` when the caller should fall back to the
 * shared extractor. Pure — claiming the error (so `errorInterceptor` does not also toast
 * it) stays the caller's job via `ApiErrorService`.
 */
export function inviteErrorCopy(error: unknown, context: InviteErrorContext): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  if (context === 'accept') {
    const cause = inviteAcceptCause(error);
    if (cause === 'driver-identity-missing') return DRIVER_IDENTITY_MISSING_COPY;
    if (cause === 'email-mismatch') return EMAIL_MISMATCH_COPY;
  }
  const copy = context === 'accept' ? ACCEPT_COPY : MANAGE_COPY;
  return copy[error.status] ?? null;
}
