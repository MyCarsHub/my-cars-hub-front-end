import { DriverInviteSummary } from '../types/driver.types';

/**
 * What "Cadastrar motorista" tells the operator about the invite that left with it.
 *
 * `POST /v1/drivers` always saves the driver first; the invite is a second effect that can be
 * refused by a domain rule without undoing the save. So a refusal is a WARNING about a saved
 * driver, never an error of the form.
 */
export type DriverInviteOutcome =
  | { kind: 'sent'; message: string }
  | { kind: 'refused'; message: string; inviteId: string | null }
  | { kind: 'not-sent'; message: string }
  /** Older backend, or a response without the part: nothing to say about the invite. */
  | { kind: 'none'; message: string };

const REASONS: Readonly<Record<string, string>> = {
  INVITE_DUPLICATE: 'já existe um convite pendente para este e-mail',
  INVITE_ALREADY_MEMBER: 'esta pessoa já faz parte da empresa',
  INVITE_PENDING_LIMIT_REACHED: 'o limite de convites pendentes da empresa foi atingido',
  INVITE_SUPPORT_SESSION: 'convites não são enviados durante uma sessão de suporte',
  INVITE_RATE_LIMITED: 'muitos convites em pouco tempo, aguarde um minuto',
  INVITE_NOT_CREATED: 'não foi possível criar o convite agora',
};

const UNKNOWN_REASON = 'motivo não identificado';

/** The friendly reason for a refused-invite `code` (lower case, to sit inside a sentence). */
export function driverInviteReason(code: string | null | undefined): string {
  const key = (code ?? '').trim().toUpperCase();
  return REASONS[key] ?? UNKNOWN_REASON;
}

export const DRIVER_INVITE_FROM_MEMBERS_HINT =
  'Envie o convite pela tela Membros, em Configurações da empresa.';

export function driverInviteOutcome(
  invite: DriverInviteSummary | undefined | null,
  email: string,
): DriverInviteOutcome {
  if (!invite) return { kind: 'none', message: 'Motorista cadastrado.' };
  switch (invite.status) {
    case 'PENDING':
      return { kind: 'sent', message: `Motorista cadastrado. Convite enviado para ${email}.` };
    case 'FAILED':
      return {
        kind: 'refused',
        message: `Motorista cadastrado, mas o convite não foi enviado (${driverInviteReason(invite.code)}).`,
        inviteId: invite.inviteId ?? null,
      };
    case 'NOT_SENT':
      return {
        kind: 'not-sent',
        message: 'Motorista cadastrado. Nenhum convite foi enviado: ele já tem acesso a esta empresa.',
      };
    default:
      return { kind: 'none', message: 'Motorista cadastrado.' };
  }
}

/** Friendly copy for the 409 a rental answers when the driver has not completed the registration. */
export const DRIVER_REGISTRATION_INCOMPLETE_COPY =
  'Este motorista ainda não completou o cadastro (CNH e endereço). Ele conclui isso pelo convite que recebeu por e-mail; depois disso o aluguel pode ser criado.';

export function isDriverRegistrationIncomplete(error: unknown): boolean {
  const body = (error as { error?: { code?: unknown } } | null)?.error;
  return typeof body?.code === 'string' && body.code.trim().toUpperCase() === 'DRIVER_REGISTRATION_INCOMPLETE';
}
