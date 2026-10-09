import { HttpErrorResponse } from '@angular/common/http';

/**
 * Copy for the `{code, message}` errors of the new invite flow.
 *
 * The screens decide by `code`, never by status or by the backend's message: the same status
 * carries several causes here (409 is used / requires sign-in / already member / identity
 * conflict / CPF not on file) and only the code tells them apart.
 */
export function inviteFlowErrorCode(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const body = error.error as { code?: unknown } | null | undefined;
  return typeof body?.code === 'string' ? body.code.trim().toUpperCase() : null;
}

/** `attemptsLeft` of an `INVITE_CPF_MISMATCH`; `null` when the body does not carry it. */
export function inviteAttemptsLeft(error: unknown): number | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const body = error.error as { attemptsLeft?: unknown } | null | undefined;
  return typeof body?.attemptsLeft === 'number' && body.attemptsLeft >= 0
    ? Math.floor(body.attemptsLeft)
    : null;
}

/** "Restam 3 tentativas." / "Resta 1 tentativa." */
export function attemptsLeftCopy(attemptsLeft: number): string {
  return attemptsLeft === 1 ? 'Resta 1 tentativa.' : `Restam ${attemptsLeft} tentativas.`;
}

export const INVITE_UNREACHABLE_COPY =
  'Não conseguimos falar com o servidor. Confira sua conexão e tente de novo.';

const GENERIC_COPY = 'Não foi possível concluir agora. Tente novamente em instantes.';

/**
 * Message for an error of `accept` / `accept-as-member` that ends the attempt. The causes
 * that keep the invitee on the CPF field (mismatch / invalid CPF) and the ones that change the
 * screen (expired / revoked / used / locked / sign-in) are handled by the page itself.
 */
export function inviteAcceptProblemCopy(error: unknown, companyName: string): string {
  switch (inviteFlowErrorCode(error)) {
    case 'INVITE_ACCOUNT_DISABLED':
      return 'Esta conta está desativada. Fale com o suporte do MyCarsHub.';
    case 'INVITE_CPF_NOT_ON_FILE':
      return `Não encontramos um CPF cadastrado para este convite. Peça a ${companyName} para conferir o cadastro e reenviar o convite.`;
    case 'INVITE_IDENTITY_CONFLICT':
      return 'Os dados deste convite entram em conflito com outro cadastro. Fale com quem te convidou.';
    case 'INVITE_ALREADY_MEMBER':
      return `Você já faz parte de ${companyName}. Entre na sua conta para continuar.`;
    case 'INVITE_DRIVER_NOT_REGISTERED':
      return `Você ainda não tem cadastro de motorista em ${companyName}. Peça ao gestor para cadastrar você e reenviar o convite.`;
    case 'INVITE_EMAIL_MISMATCH':
      return 'Este convite foi enviado para outro e-mail. Entre com a conta Google do e-mail que recebeu o convite.';
    case 'INVITE_GOOGLE_ACCOUNT_REQUIRED':
      return 'Para aceitar este convite, entre com uma conta Google.';
    default:
      if (error instanceof HttpErrorResponse && error.status === 0) return INVITE_UNREACHABLE_COPY;
      return error instanceof HttpErrorResponse && error.status === 429
        ? 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.'
        : GENERIC_COPY;
  }
}

/** Where a failed manager-onboarding call sends the screen. */
export type OnboardingFailure =
  | { kind: 'field'; field: 'name' | 'phone'; message: string }
  | { kind: 'terms'; message: string }
  | { kind: 'revoked'; message: string }
  | { kind: 'wrong-role'; message: string }
  | { kind: 'done'; message: string }
  | { kind: 'generic'; message: string };

export function onboardingFailure(error: unknown): OnboardingFailure {
  switch (inviteFlowErrorCode(error)) {
    case 'ONBOARDING_NAME_INVALID':
      return { kind: 'field', field: 'name', message: 'Confira seu nome completo.' };
    case 'ONBOARDING_PHONE_INVALID':
      return {
        kind: 'field',
        field: 'phone',
        message: 'Confira o telefone com o DDD, como (11) 91234-5678.',
      };
    case 'TERMS_VERSION_MISMATCH':
      return {
        kind: 'terms',
        message: 'Os termos foram atualizados. Recarregue a página para ler a versão atual.',
      };
    case 'ONBOARDING_TOKEN_REVOKED':
      return {
        kind: 'revoked',
        message:
          'Este cadastro não pode mais ser concluído por aqui. Entre na sua conta ou peça um novo convite.',
      };
    case 'ONBOARDING_ROLE_MISMATCH':
      return {
        kind: 'wrong-role',
        message: 'Este convite é para outro tipo de acesso. Abra o link do convite de novo.',
      };
    case 'ONBOARDING_ALREADY_DONE':
      return {
        kind: 'done',
        message: 'Seu cadastro já foi concluído. Entre na sua conta para continuar.',
      };
    default:
      return {
        kind: 'generic',
        message:
          error instanceof HttpErrorResponse && error.status === 0
            ? INVITE_UNREACHABLE_COPY
            : GENERIC_COPY,
      };
  }
}
