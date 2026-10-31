import { HttpErrorResponse } from '@angular/common/http';
import { parseApiError } from '../../services/api-error';
import { formatBRL } from '../../types/dashboard.types';
import { PlanChangePreview, PlanChangeReason, PlanPeriod } from '../../types/billing.types';
import { formatFullDate, parseServerTime } from '../../utils/server-time';

/** A recusa da descida traz a data no `message`: a frase do servidor é a que vale. */
export const DOWNGRADE_LOCKED_CODE = 'DOWNGRADE_LOCKED_UNTIL_PAID';

/** O checkout recusou: esta troca é na mesma assinatura. A página relê a decisão. */
export const USE_IN_PLACE_CODE = 'UPGRADE_USE_IN_PLACE';

/** O inverso: esta mudança é agendada para a renovação. */
export const USE_SCHEDULE_CODE = 'PLAN_CHANGE_USE_SCHEDULE';

/** Sem resposta o resultado é desconhecido: esta frase não afirma nada sobre a troca. */
export const UNKNOWN_OUTCOME_MESSAGE =
  'Não conseguimos confirmar a troca. Atualize a página para ver seu plano.';

/** A prévia nunca chega a cobrar: a falha dela só precisa dizer isso. */
export const PREVIEW_FAILED_MESSAGE =
  'Não conseguimos conferir esta mudança agora. Nada foi cobrado. Tente de novo.';

const UNDO_UNKNOWN_MESSAGE =
  'Não conseguimos confirmar se a mudança foi desfeita. Atualize a página para ver seu plano.';

const UPGRADE_REFUSALS: Record<string, string> = {
  UPGRADE_DOWNGRADE_SCHEDULED:
    'Há uma mudança de plano agendada. Desfaça o agendamento antes de mudar de novo.',
  UPGRADE_CANCELLATION_SCHEDULED:
    'Há um cancelamento agendado. Desfaça o cancelamento antes de mudar de plano.',
  UPGRADE_USE_CHECKOUT:
    'Esta mudança agora passa pelo checkout. Feche e escolha o plano de novo. Nada foi alterado.',
  UPGRADE_NOT_AVAILABLE: 'Este plano não está disponível no momento. Nada foi alterado.',
  UPGRADE_CHECKOUT_IN_PROGRESS:
    'Há um pagamento em andamento para esta assinatura. Conclua ou aguarde antes de mudar de plano. Nada foi alterado.',
  UPGRADE_PROVIDER_MISMATCH:
    'A Stripe mostra a assinatura diferente do que temos aqui. Nada foi alterado. Atualize a página ou fale com o suporte.',
};

const BLOCKED_TITLES: Partial<Record<PlanChangeReason, string>> = {
  ALREADY_ON_PLAN: 'Nada a mudar',
  PLAN_NOT_AVAILABLE: 'Plano indisponível',
  DOWNGRADE_SCHEDULED: 'Antes, desfaça o agendamento',
  CANCELLATION_SCHEDULED: 'Antes, desfaça o cancelamento',
  DOWNGRADE_LOCKED_UNTIL_PAID: 'Disponível depois do pagamento',
  PROVIDER_MISMATCH: 'Precisamos revisar sua assinatura',
};

/** Só para o caso de o servidor não mandar `message` num `BLOCKED`. */
const BLOCKED_MESSAGES: Partial<Record<PlanChangeReason, string>> = {
  ALREADY_ON_PLAN: 'Este já é o seu plano.',
  PLAN_NOT_AVAILABLE: 'Este plano não está disponível para assinatura.',
  DOWNGRADE_SCHEDULED: UPGRADE_REFUSALS['UPGRADE_DOWNGRADE_SCHEDULED'],
  CANCELLATION_SCHEDULED: UPGRADE_REFUSALS['UPGRADE_CANCELLATION_SCHEDULED'],
  DOWNGRADE_LOCKED_UNTIL_PAID: 'A volta para um plano menor fica disponível depois que a próxima fatura for paga.',
  PROVIDER_MISMATCH:
    'A Stripe mostra a assinatura diferente do que temos aqui. Nada foi alterado. Fale com o suporte.',
};

export const PREVIEW_FAILED_NOTICE: PlanNotice = {
  title: 'Não deu para conferir',
  message: PREVIEW_FAILED_MESSAGE,
};

export interface PlanNotice {
  title: string;
  message: string;
}

export interface PlanOfferCopy {
  planLabel: string;
  lead: string;
  rest: string;
  /** O desconto atual para de valer com esta troca. */
  discountNote: string | null;
  /** A frota passa do teto do plano de destino. */
  fleetNote: string | null;
}

const RECURRING_WORD: Record<PlanPeriod, string> = { MONTHLY: 'mensalidade', YEARLY: 'anuidade' };
const PERIOD_WORD: Record<PlanPeriod, string> = { MONTHLY: 'mensal', YEARLY: 'anual' };

/** O nome do plano como a tela escreve: "Pro", nunca "PRO". */
function planLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/** A resposta sustenta "nada hoje, tal valor em tal data"? Se não, a frase não sai. */
function promise(preview: PlanChangePreview): { date: string; next: number } | null {
  const at = parseServerTime(preview.nextChargeAt);
  if (!at || preview.nextAmountCents === null || preview.amountTodayCents !== 0) return null;
  return { date: formatFullDate(at), next: preview.nextAmountCents };
}

function offerNotes(preview: PlanChangePreview): Pick<PlanOfferCopy, 'discountNote' | 'fleetNote'> {
  const limit = preview.targetVehicleLimit;
  return {
    discountNote:
      preview.discountAfterChange === 'LOST' ? 'O desconto atual não continua no novo plano.' : null,
    fleetNote:
      preview.fleetOverLimit && limit !== null
        ? `Sua frota tem ${preview.vehicleCount} veículos e o ${planLabel(preview.planName)} vai até ${limit}. Nenhum veículo é removido e todos continuam editáveis. Só não dá para adicionar novos até a frota ficar abaixo de ${limit}.`
        : null,
  };
}

/** Upgrade na mesma assinatura. `null` quando a resposta não sustenta a promessa. */
export function upgradeCopy(preview: PlanChangePreview, period: PlanPeriod): PlanOfferCopy | null {
  const known = promise(preview);
  if (!known) return null;
  const { date } = known;
  const label = planLabel(preview.planName);
  const listed = formatBRL(preview.listAmountCents);
  // A próxima fatura pode vir com desconto: ela não é a mensalidade do plano.
  const rest =
    preview.nextAmountCents === preview.listAmountCents
      ? `Você não paga nada hoje. A partir de ${date} a ${RECURRING_WORD[period]} passa a ${listed}.`
      : `Você não paga nada hoje. A próxima fatura, em ${date}, vem em ${formatBRL(preview.nextAmountCents)}. O preço do plano é ${listed}.`;
  return { planLabel: label, lead: `O ${label} começa agora.`, rest, ...offerNotes(preview) };
}

/**
 * Mudança agendada para a renovação: plano menor ou troca de ciclo. O plano em
 * vigor segue igual até lá, e a frase diz isso antes de falar de valor.
 */
export function scheduledCopy(
  preview: PlanChangePreview,
  period: PlanPeriod,
  current: { name: string; period: PlanPeriod },
): PlanOfferCopy | null {
  const known = promise(preview);
  if (!known) return null;
  const { date, next } = known;
  const from = planLabel(current.name);
  const to = planLabel(preview.planName);
  const listed = formatBRL(preview.listAmountCents);
  const discounted = next !== preview.listAmountCents;
  const today = 'Você não paga nada hoje.';
  const notes = offerNotes(preview);

  if (preview.reasonCode === 'INTERVAL_CHANGE') {
    const target = `${to} ${PERIOD_WORD[period]}`;
    const rest = [
      `Nessa data começa o ${target}, com fatura de ${formatBRL(next)}.`,
      discounted ? `O preço do plano é ${listed}.` : null,
      from === to ? null : `Os limites do ${to} valem a partir dessa data.`,
      today,
    ];
    return {
      planLabel: target,
      lead: `Você continua no ${from} ${PERIOD_WORD[current.period]} até ${date}.`,
      rest: rest.filter(Boolean).join(' '),
      ...notes,
    };
  }

  return {
    planLabel: to,
    lead: `Você continua no ${from} até ${date}.`,
    rest: discounted
      ? `A próxima fatura, nessa data, vem em ${formatBRL(next)}. O preço do plano é ${listed}. ${today}`
      : `A partir daí a ${RECURRING_WORD[period]} passa a ${listed}. ${today}`,
    ...notes,
  };
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
  // Vale para qualquer outro `BLOCKED` do servidor: a frase aqui é a que não insinua cobrança.
  if (parsed.code === 'UPGRADE_NOT_AVAILABLE') {
    return {
      title: BLOCKED_TITLES.PLAN_NOT_AVAILABLE as string,
      message: 'Este plano não está disponível no momento. Nada foi cobrado.',
    };
  }
  const reason = parsed.code ? REFUSAL_REASONS[parsed.code] : undefined;
  if (!reason) return null;
  return {
    title: BLOCKED_TITLES[reason] as string,
    message: parsed.message ?? (BLOCKED_MESSAGES[reason] as string),
  };
}

/** O servidor mandou esta troca para o outro caminho: quem decide é uma nova prévia. */
export function isRerouted(err: unknown): boolean {
  const { code } = parseApiError(err);
  return code === USE_IN_PLACE_CODE || code === USE_SCHEDULE_CODE;
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
      return 'Só o dono da conta pode mudar o plano, e nunca em sessão somente leitura.';
    case 503:
      return 'A Stripe não respondeu. Nada mudou e nada foi cobrado. Tente de novo.';
    case 500:
      return 'Não conseguimos concluir a alteração do plano. Tente de novo em instantes.';
    default:
      return err.status === 0 || err.status >= 500
        ? UNKNOWN_OUTCOME_MESSAGE
        : 'Não foi possível mudar o plano. Nada foi alterado. Tente de novo.';
  }
}

export function undoErrorMessage(err: unknown): string {
  if (!(err instanceof HttpErrorResponse)) return UNDO_UNKNOWN_MESSAGE;
  if (parseApiError(err).code === 'PLAN_CHANGE_TOO_LATE') {
    return 'A renovação já aconteceu e o novo preço já está na fatura. Não dá mais para desfazer.';
  }
  switch (err.status) {
    case 403:
      return 'Só o dono da conta pode desfazer a mudança, e nunca em sessão somente leitura.';
    case 503:
      return 'A Stripe não respondeu. Nada mudou. Tente de novo.';
    case 500:
      return 'Não conseguimos concluir o desfazer. Tente de novo em instantes.';
    default:
      return err.status === 0 || err.status >= 500
        ? UNDO_UNKNOWN_MESSAGE
        : 'Não foi possível desfazer a mudança. Tente de novo.';
  }
}

/**
 * 503 em cancelar, voltar ao gratuito e reativar: o contrato garante que nada
 * mudou e que repetir é seguro. Os outros status não garantem, e ficam de fora.
 */
export function providerDownMessage(err: unknown): string | null {
  return err instanceof HttpErrorResponse && err.status === 503
    ? 'A Stripe não respondeu. Nada mudou e sua assinatura segue como estava. Tente de novo.'
    : null;
}

/** Cancelar com mudança agendada: nada é desfeito em silêncio. */
export function cancelRefusal(err: unknown): string | null {
  return parseApiError(err).code === 'CANCEL_PLAN_CHANGE_SCHEDULED'
    ? 'Há uma mudança de plano agendada. Desfaça a mudança antes de cancelar.'
    : null;
}
