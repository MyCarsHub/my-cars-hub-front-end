import { HttpErrorResponse } from '@angular/common/http';
import { parseApiError } from '../../services/api-error';
import { formatBRL } from '../../types/dashboard.types';
import { PlanChangePreview, PlanChangeReason } from '../../types/billing.types';
import { formatFullDate, parseServerTime } from '../../utils/server-time';

/** A recusa da descida traz a data no `message`: a frase do servidor é a que vale. */
export const DOWNGRADE_LOCKED_CODE = 'DOWNGRADE_LOCKED_UNTIL_PAID';

/** O checkout recusou: esta troca é na mesma assinatura. A página relê a decisão. */
export const USE_IN_PLACE_CODE = 'UPGRADE_USE_IN_PLACE';

/** Sem resposta o resultado é desconhecido: esta frase não afirma nada sobre a troca. */
export const UNKNOWN_OUTCOME_MESSAGE =
  'Não conseguimos confirmar a troca. Atualize a página para ver seu plano.';

/** A prévia nunca chega a cobrar: a falha dela só precisa dizer isso. */
export const PREVIEW_FAILED_MESSAGE =
  'Não conseguimos conferir esta mudança agora. Nada foi cobrado. Tente de novo.';

const UPGRADE_REFUSALS: Record<string, string> = {
  UPGRADE_DOWNGRADE_SCHEDULED:
    'Há uma mudança de plano agendada. Desfaça o agendamento antes de fazer o upgrade.',
  UPGRADE_CANCELLATION_SCHEDULED:
    'Há um cancelamento agendado. Desfaça o cancelamento antes de fazer o upgrade.',
  UPGRADE_USE_CHECKOUT:
    'Esta mudança agora passa pelo checkout. Feche e escolha o plano de novo. Nada foi alterado.',
  UPGRADE_NOT_AVAILABLE: 'Este plano não está disponível no momento. Nada foi alterado.',
  UPGRADE_CHECKOUT_IN_PROGRESS:
    'Há um pagamento em andamento para esta assinatura. Conclua ou aguarde antes de fazer o upgrade. Nada foi alterado.',
  UPGRADE_PROVIDER_MISMATCH:
    'A Stripe mostra a assinatura diferente do que temos aqui. Nada foi alterado. Atualize a página ou fale com o suporte.',
};

const BLOCKED_TITLES: Partial<Record<PlanChangeReason, string>> = {
  ALREADY_ON_PLAN: 'Nada a mudar',
  PLAN_NOT_AVAILABLE: 'Plano indisponível',
  DOWNGRADE_SCHEDULED: 'Antes, desfaça o agendamento',
  CANCELLATION_SCHEDULED: 'Antes, desfaça o cancelamento',
  DOWNGRADE_LOCKED_UNTIL_PAID: 'Disponível depois do pagamento',
};

/** Só para o caso de o servidor não mandar `message` num `BLOCKED`. */
const BLOCKED_MESSAGES: Partial<Record<PlanChangeReason, string>> = {
  ALREADY_ON_PLAN: 'Este já é o seu plano.',
  PLAN_NOT_AVAILABLE: 'Este plano não está disponível para assinatura.',
  DOWNGRADE_SCHEDULED: UPGRADE_REFUSALS['UPGRADE_DOWNGRADE_SCHEDULED'],
  CANCELLATION_SCHEDULED: UPGRADE_REFUSALS['UPGRADE_CANCELLATION_SCHEDULED'],
  DOWNGRADE_LOCKED_UNTIL_PAID: 'A volta para um plano menor fica disponível depois que a próxima fatura for paga.',
};

export const PREVIEW_FAILED_NOTICE: PlanNotice = {
  title: 'Não deu para conferir',
  message: PREVIEW_FAILED_MESSAGE,
};

export interface PlanNotice {
  title: string;
  message: string;
}

export interface UpgradeCopy {
  planLabel: string;
  lead: string;
  rest: string;
}

/** O nome do plano como a tela escreve: "Pro", nunca "PRO". */
function planLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/**
 * A frase do diálogo, com data e valor da API. `null` quando a resposta não
 * sustenta a promessa: sem data, sem valor, ou com cobrança hoje.
 */
export function upgradeCopy(preview: PlanChangePreview): UpgradeCopy | null {
  const next = parseServerTime(preview.nextChargeAt);
  if (!next || preview.nextAmountCents === null || preview.amountTodayCents !== 0) return null;
  const label = planLabel(preview.planName);
  const date = formatFullDate(next);
  const listed = formatBRL(preview.listAmountCents);
  // A próxima fatura pode vir com desconto: ela não é a mensalidade do plano.
  const rest =
    preview.nextAmountCents === preview.listAmountCents
      ? `Você não paga nada hoje. A partir de ${date} a mensalidade passa a ${listed}.`
      : `Você não paga nada hoje. A próxima fatura, em ${date}, vem em ${formatBRL(preview.nextAmountCents)}. O preço do plano é ${listed}.`;
  return { planLabel: label, lead: `O ${label} começa agora.`, rest };
}

export function blockedNotice(preview: PlanChangePreview): PlanNotice {
  const reason = preview.reasonCode;
  const fallback = 'Esta mudança de plano não está disponível agora.';
  return {
    title: (reason && BLOCKED_TITLES[reason]) || 'Não dá para mudar agora',
    message: preview.message || (reason && BLOCKED_MESSAGES[reason]) || fallback,
  };
}

/** Recusa de checkout ou de descida que corresponde a um `BLOCKED` da prévia. */
const REFUSAL_REASONS: Record<string, PlanChangeReason> = {
  [DOWNGRADE_LOCKED_CODE]: 'DOWNGRADE_LOCKED_UNTIL_PAID',
  UPGRADE_DOWNGRADE_SCHEDULED: 'DOWNGRADE_SCHEDULED',
  UPGRADE_CANCELLATION_SCHEDULED: 'CANCELLATION_SCHEDULED',
};

export function refusalNotice(err: unknown): PlanNotice | null {
  const parsed = parseApiError(err);
  const reason = parsed.code ? REFUSAL_REASONS[parsed.code] : undefined;
  if (!reason) return null;
  return {
    title: BLOCKED_TITLES[reason] as string,
    message: parsed.message ?? (BLOCKED_MESSAGES[reason] as string),
  };
}

export function isUseInPlace(err: unknown): boolean {
  return parseApiError(err).code === USE_IN_PLACE_CODE;
}

/**
 * 503 e 500 são os dois que o contrato garante poder repetir. Sem resposta, quem
 * decide é a releitura: a prévia seguinte diz onde a assinatura ficou.
 */
export function upgradeCanRetry(err: unknown): boolean {
  return err instanceof HttpErrorResponse && (err.status === 500 || err.status === 503);
}

export function upgradeErrorMessage(err: unknown): string {
  if (!(err instanceof HttpErrorResponse)) return UNKNOWN_OUTCOME_MESSAGE;
  const parsed = parseApiError(err);
  if (parsed.code === DOWNGRADE_LOCKED_CODE && parsed.message) return parsed.message;
  const refusal = parsed.code ? UPGRADE_REFUSALS[parsed.code] : undefined;
  if (refusal) return refusal;
  switch (err.status) {
    case 403:
      return 'Só o dono da conta pode fazer o upgrade, e nunca em sessão somente leitura.';
    case 503:
      return 'A Stripe não respondeu. Nada mudou e nada foi cobrado. Tente de novo.';
    case 500:
      return 'Não conseguimos concluir a alteração do plano. Tente de novo em instantes.';
    default:
      return err.status === 0 || err.status >= 500
        ? UNKNOWN_OUTCOME_MESSAGE
        : 'Não foi possível fazer o upgrade. Nada foi alterado. Tente de novo.';
  }
}
