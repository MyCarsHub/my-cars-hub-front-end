import { HttpErrorResponse } from '@angular/common/http';
import { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { parseApiError } from '../../../services/api-error';
import { NotificationService } from '../../../services/notification.service';
import {
  ALL_PLANS_CODE,
  AdminCoupon,
  AdminCouponMode,
  CouponDuration,
} from '../../../types/admin-coupon.types';
import { formatBRL } from '../../../types/dashboard.types';
import { planTierOf } from '../../../utils/plan-features';
import { PLAN_COPY } from '../../../utils/plan-grid-copy';
import { formatFullDate, parseServerTime } from '../../../utils/server-time';

export type CouponAction = 'load' | 'preview' | 'create' | 'deactivate' | 'detail';

export interface CouponStatusView {
  label: string;
  tone: StatusChipTone;
  /** Ainda dá para desativar: algo depende dele. */
  live: boolean;
}

const PERCENT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

const PERIOD_LABEL: Record<string, string> = { MONTHLY: 'mensal', YEARLY: 'anual' };

/** O texto que quem lê vê no lugar de um plano só. */
export const ALL_PLANS_LABEL = 'Todos os planos';
/** Os planos que "todos os planos" cobre, na ordem do preço. O ENTERPRISE fica de fora. */
export const ALL_PLANS_TIERS = ['STARTER', 'PRO', 'SCALE'] as const;
/** Onde quem recebe o código assina. */
export const SIGNUP_HOST = 'mycarshub.app.br';

const CODE_MESSAGES: Record<string, string> = {
  COUPON_ZEROES_PLAN:
    'Este desconto zera o plano. Reduza o valor: a fatura precisa ficar acima do mínimo da Stripe.',
  COUPON_PLAN_MISMATCH: 'O cupom precisa ser do plano atual da assinatura. Escolha o plano que a empresa já paga.',
  COUPON_ALREADY_APPLIED: 'Esta assinatura já tem um desconto. Desative o atual antes de criar outro.',
  COUPON_NO_OWNER: 'Esta empresa não tem dono com e-mail, e o código é preso ao cliente dele.',
  COUPON_CODE_TAKEN: 'Já existe um código com este texto. Escolha outro ou deixe vazio para gerar um.',
  COUPON_CODE_INVALID: 'O código aceita só letras, números e hífen, de 4 a 30 caracteres.',
  COUPON_INVALID: 'O desconto informado não é válido. Confira os valores.',
  COUPON_NO_INVOICE_IN_WINDOW:
    'Nenhuma fatura cai dentro destes meses: o desconto nunca seria usado. Aumente a duração.',
  COUPON_AMOUNT_NOT_BELOW_CHEAPEST_PLAN:
    'Em todos os planos, o desconto em R$ precisa ser menor que o plano mais barato. Use um valor menor ou escolha um plano só.',
  COUPON_ALL_PLANS_SHARED_PRODUCT:
    'Na Stripe, o Enterprise usa o mesmo produto de um dos planos, e o cupom valeria nele também. Separe os produtos na Stripe antes de criar um cupom para todos os planos.',
  COUPON_NO_PLAN_ON_SALE: 'Nenhum plano pago está à venda agora, então não há plano para o cupom valer.',
  COUPON_BELOW_MIN_CHARGE:
    'Com este desconto, alguma fatura fica abaixo do mínimo que a Stripe cobra. Use um desconto menor ou de 100%.',
};

/** Mesmo código, outra causa: o campo diz qual. */
const FIELD_MESSAGES: Record<string, string> = {
  'COUPON_PLAN_MISMATCH:allPlans':
    'O plano que esta empresa paga não entra em Todos os planos. Escolha o plano dela.',
};

const STRIPE_DOWN: Record<CouponAction, string> = {
  load: 'A Stripe não respondeu, e a lista de cupons mora lá. Tente de novo.',
  preview: 'A Stripe não respondeu. Tente de novo para ver a prévia.',
  create: 'A Stripe não respondeu. Confira a lista de cupons antes de tentar de novo.',
  deactivate: 'A Stripe não respondeu. O cupom continua como estava. Tente de novo.',
  detail: 'A Stripe não respondeu, e os usos do cupom moram lá. Tente de novo.',
};

const GENERIC: Record<CouponAction, string> = {
  load: 'Não foi possível carregar os cupons. Tente de novo.',
  preview: 'Não foi possível calcular a prévia. Tente de novo.',
  create: 'Não foi possível criar o cupom. Tente de novo.',
  deactivate: 'Não foi possível desativar o cupom. Tente de novo.',
  detail: 'Não foi possível carregar os usos do cupom. Tente de novo.',
};

export function discountLabel(coupon: Pick<AdminCoupon, 'amountOffCents' | 'percentOff'>): string {
  if (coupon.amountOffCents !== null) return formatBRL(coupon.amountOffCents).replace(/\u00A0/g, ' ');
  if (coupon.percentOff !== null) return `${PERCENT.format(coupon.percentOff)}%`;
  return '—';
}

export function durationLabel(months: number | null): string {
  if (months === null) return '—';
  return months === 1 ? '1 mês' : `${months} meses`;
}

type DurationFields = Partial<Pick<AdminCoupon, 'duration' | 'durationMonths'>>;

/** Cupom antigo não traz `duration`: era sempre por meses. */
export function couponDuration(coupon: DurationFields): CouponDuration {
  return coupon.duration ?? 'REPEATING';
}

/** "3 meses", "uma vez" ou "para sempre": a coluna da tabela. */
export function durationShort(coupon: DurationFields): string {
  switch (couponDuration(coupon)) {
    case 'ONCE':
      return 'uma vez';
    case 'FOREVER':
      return 'para sempre';
    default:
      return durationLabel(coupon.durationMonths ?? null);
  }
}

/** "por 3 meses", "uma vez" ou "para sempre": ao lado do desconto. */
export function durationText(coupon: DurationFields): string {
  return couponDuration(coupon) === 'REPEATING' ? `por ${durationShort(coupon)}` : durationShort(coupon);
}

/** "nos primeiros 3 meses", "na próxima fatura" ou "em todas as faturas": o que o cliente ganha. */
export function durationBenefit(coupon: DurationFields): string {
  switch (couponDuration(coupon)) {
    case 'ONCE':
      return 'na próxima fatura';
    case 'FOREVER':
      return 'em todas as faturas';
    default: {
      const months = coupon.durationMonths ?? 1;
      return months === 1 ? 'no primeiro mês' : `nos primeiros ${months} meses`;
    }
  }
}

/** Quando o desconto começa e até quando vale: a nota abaixo dos valores por plano. */
export function durationNote(coupon: DurationFields): string {
  switch (couponDuration(coupon)) {
    case 'ONCE':
      return 'Vale só na próxima fatura, no mensal ou no anual. O cliente escolhe o plano na hora de assinar.';
    case 'FOREVER':
      return 'Começa na próxima fatura e vale em todas, até você desativar o cupom.';
    default: {
      const months = coupon.durationMonths ?? 1;
      const monthly = months === 1 ? 'vale na próxima fatura' : `vale nas ${months} próximas faturas`;
      return `Começa na próxima fatura do cliente. No mensal, ${monthly}. No anual, a próxima fatura do ano já sai com o desconto.`;
    }
  }
}

/** "20% de desconto por 3 meses.", "10% de desconto na próxima fatura.", "100% de desconto, para sempre." */
export function offerHeadline(
  coupon: Pick<AdminCoupon, 'amountOffCents' | 'percentOff'> & DurationFields,
): string {
  const off = `${discountLabel(coupon)} de desconto`;
  switch (couponDuration(coupon)) {
    case 'ONCE':
      return `${off} na próxima fatura.`;
    case 'FOREVER':
      return `${off}, para sempre.`;
    default:
      return `${off} ${durationText(coupon)}.`;
  }
}

/** Vale em STARTER, PRO e SCALE. O `planCode` `"ALL"` também diz isso. */
export function isAllPlans(coupon: Partial<Pick<AdminCoupon, 'planCode' | 'allPlans'>>): boolean {
  return coupon.allPlans === true || coupon.planCode === ALL_PLANS_CODE;
}

/** "Starter, Pro e Scale" (ou "Starter, Pro ou Scale"). */
export function allPlansNames(joiner: 'e' | 'ou' = 'e'): string {
  const names = ALL_PLANS_TIERS.map((tier) => PLAN_COPY[tier].name);
  return `${names.slice(0, -1).join(', ')} ${joiner} ${names[names.length - 1]}`;
}

export function couponDate(value: string | null): string {
  return formatFullDate(parseServerTime(value));
}

export function validityLabel(coupon: Pick<AdminCoupon, 'mode' | 'expiresAt'>): string {
  if (coupon.mode === 'APPLIED_TO_SUBSCRIPTION') return 'Nas próximas faturas';
  return coupon.expiresAt ? `Até ${couponDate(coupon.expiresAt)}` : '—';
}

/** "Pro mensal", a partir de `PRO_MONTHLY_STRIPE`. */
export function couponPlanLabel(planCode: string | null): string {
  if (!planCode) return '—';
  if (planCode === ALL_PLANS_CODE) return ALL_PLANS_LABEL;
  const [name, period] = planCode.split('_');
  const tier = planTierOf(name);
  const label = tier ? PLAN_COPY[tier].name : name;
  return PERIOD_LABEL[period] ? `${label} ${PERIOD_LABEL[period]}` : label;
}

/**
 * A situação que importa a quem lê. O servidor só distingue ativo de desativado,
 * mas um código de uso único já usado, ou vencido, não serve mais para nada.
 */
export function couponStatus(
  coupon: Pick<AdminCoupon, 'mode' | 'status' | 'expiresAt' | 'timesRedeemed'> &
    Partial<Pick<AdminCoupon, 'createdAt' | 'durationMonths' | 'maxRedemptions'>>,
  now: Date,
): CouponStatusView {
  if (coupon.status === 'DEACTIVATED') return { label: 'Desativado', tone: 'neutral', live: false };
  if (coupon.mode === 'APPLIED_TO_SUBSCRIPTION' && windowEnded(coupon, now)) {
    return { label: 'Encerrado', tone: 'neutral', live: false };
  }
  if (coupon.mode === 'OPEN_CODE') {
    const max = coupon.maxRedemptions ?? 1;
    if ((coupon.timesRedeemed ?? 0) >= max) return { label: 'Esgotado', tone: 'blue', live: false };
    const expires = parseServerTime(coupon.expiresAt);
    if (expires && expires.getTime() < now.getTime()) return { label: 'Vencido', tone: 'amber', live: false };
  }
  if (coupon.mode === 'PROMOTION_CODE') {
    if ((coupon.timesRedeemed ?? 0) > 0) return { label: 'Usado', tone: 'blue', live: false };
    const expires = parseServerTime(coupon.expiresAt);
    if (expires && expires.getTime() < now.getTime()) return { label: 'Vencido', tone: 'amber', live: false };
  }
  return { label: 'Ativo', tone: 'green', live: true };
}

/** Na assinatura o desconto começa ao criar: a janela conta daí. */
function windowEnded(coupon: Partial<Pick<AdminCoupon, 'createdAt' | 'durationMonths'>>, now: Date): boolean {
  const start = parseServerTime(coupon.createdAt);
  if (!start || !coupon.durationMonths) return false;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + coupon.durationMonths);
  return end.getTime() < now.getTime();
}

export function modeCopy(mode: AdminCouponMode): { title: string; detail: string } {
  if (mode === 'OPEN_CODE') {
    return {
      title: 'Código para qualquer pessoa',
      detail: 'Quem receber digita no checkout. Vale até o prazo ou o limite de usos.',
    };
  }
  return mode === 'APPLIED_TO_SUBSCRIPTION'
    ? {
        title: 'Aplicado direto na assinatura',
        detail: 'Ninguém digita nada. O desconto entra nas próximas faturas.',
      }
    : {
        title: 'Código para enviar ao cliente',
        detail: 'Uso único, só para este cliente, válido por 30 dias. O prazo do desconto começa quando ele usar.',
      };
}

/**
 * Sem resposta a criação pode ter acontecido, e até um 503 deixa o cupom na Stripe
 * quando a resposta da aplicação se perde. Só a lista sabe.
 */
export function createOutcomeUnknown(err: unknown): boolean {
  return !(err instanceof HttpErrorResponse) || err.status === 0 || err.status >= 500;
}

/** Cada recusa do contrato tem texto próprio; status sem código dizem o que aconteceu. */
export function couponErrorMessage(err: unknown, action: CouponAction): string {
  const parsed = parseApiError(err);
  for (const field of Object.keys(parsed.fieldErrors)) {
    const text = FIELD_MESSAGES[`${parsed.code}:${field}`];
    if (text) return text;
  }
  if (parsed.code === 'COUPON_INVALID' && parsed.message) return parsed.message;
  if (parsed.code && CODE_MESSAGES[parsed.code]) return CODE_MESSAGES[parsed.code];
  if (action === 'create' && createOutcomeUnknown(err)) return STRIPE_DOWN.create;
  if (err instanceof HttpErrorResponse) {
    switch (err.status) {
      case 0:
        return 'Sem conexão com o servidor. Tente de novo.';
      case 403:
        return action === 'load' || action === 'preview' || action === 'detail'
          ? 'Seu papel não acessa os cupons.'
          : 'Só o papel Dono cria e desativa cupons.';
      case 404:
        return action === 'deactivate' || action === 'detail'
          ? 'Cupom não encontrado na Stripe.'
          : 'Empresa ou plano não encontrado, ou a empresa ainda não tem assinatura.';
      case 503:
        return STRIPE_DOWN[action];
    }
  }
  return GENERIC[action];
}

/** Nunca finge que copiou: sem área de transferência, entrega o código por escrito. */
export async function copyCouponCode(view: Window | null, notify: NotificationService, code: string): Promise<boolean> {
  const clipboard = view?.navigator?.clipboard;
  try {
    if (!clipboard?.writeText) throw new Error('sem clipboard');
    await clipboard.writeText(code);
    notify.success('Código copiado.');
    return true;
  } catch {
    notify.warning(`Não foi possível copiar. O código é ${code}.`);
    return false;
  }
}

/**
 * O texto curto da folha depois de gerar: "Use o código X na hora de assinar qualquer
 * plano (Starter, Pro ou Scale) e ganhe 20% de desconto nos primeiros 3 meses."
 */
export function openCodeMessage(
  code: string,
  coupon: Pick<AdminCoupon, 'planCode' | 'amountOffCents' | 'percentOff'> &
    Partial<Pick<AdminCoupon, 'allPlans'>> &
    DurationFields,
  /** Um plano só: o preço com desconto da prévia, para dizer quanto o cliente paga. */
  discountedAmountCents: number | null = null,
): string {
  if (isAllPlans(coupon)) {
    return `Use o código ${code} na hora de assinar qualquer plano (${allPlansNames('ou')}) e ganhe ${discountLabel(coupon)} de desconto ${durationBenefit(coupon)}.`;
  }
  const plan = `o plano ${couponPlanName(coupon.planCode)}`;
  if (discountedAmountCents !== null) {
    const price = formatBRL(discountedAmountCents).replace(/ /g, ' ');
    return `Use o código ${code} na hora de assinar ${plan} e pague ${price} ${durationBenefit(coupon)}.`;
  }
  return `Use o código ${code} na hora de assinar ${plan} e ganhe ${discountLabel(coupon)} de desconto ${durationBenefit(coupon)}.`;
}

export interface ShareMessageInput {
  code: string;
  coupon: Pick<AdminCoupon, 'mode' | 'planCode' | 'amountOffCents' | 'percentOff' | 'expiresAt'> &
    Partial<Pick<AdminCoupon, 'allPlans'>> &
    DurationFields;
  /** Nome da empresa do código de empresa; ausente no código aberto. */
  company?: string | null;
}

/**
 * A mensagem que vai junto com a imagem, ou sozinha em "Copiar mensagem". Curta, com o
 * código sozinho numa linha e o endereço para assinar.
 */
export function shareMessage({ code, coupon, company }: ShareMessageInput): string {
  const all = isAllPlans(coupon);
  const companyName = coupon.mode === 'PROMOTION_CODE' ? (company ?? '').trim() : '';
  const plan = `no plano ${couponPlanName(coupon.planCode)}`;
  const where = companyName
    ? all
      ? 'no plano que vocês escolherem'
      : plan
    : all
      ? `em qualquer plano: ${allPlansNames('ou')}`
      : plan;
  const opening = companyName
    ? `Oi! Separei um desconto só para a ${companyName} no MyCarsHub.`
    : 'Oi! Tem desconto para você assinar o MyCarsHub.';
  const date = coupon.expiresAt ? couponDate(coupon.expiresAt) : '—';
  const until = date !== '—' ? date : null;
  const signup = `Assine em ${SIGNUP_HOST}`;
  let closing: string;
  if (coupon.mode === 'PROMOTION_CODE') {
    closing = until ? `É de uso único e vale até ${until}. ${signup}` : `É de uso único. ${signup}`;
  } else {
    closing = until ? `Vale até ${until}. ${signup}` : signup;
  }
  return [
    opening,
    `${discountLabel(coupon)} de desconto ${durationBenefit(coupon)}, ${where}.`,
    `Use o código:\n${code}`,
    closing,
  ].join('\n\n');
}

/** "usos 0/5" na lista. */
export function usesLabel(coupon: Pick<AdminCoupon, 'timesRedeemed' | 'maxRedemptions'>): string {
  return `${coupon.timesRedeemed ?? 0}/${coupon.maxRedemptions ?? 1}`;
}

export function kindLabel(mode: AdminCouponMode): string {
  switch (mode) {
    case 'OPEN_CODE':
      return 'Qualquer pessoa';
    case 'PROMOTION_CODE':
      return 'Código de empresa';
    default:
      return 'Direto na assinatura';
  }
}

/** "Scale", sem o período: o que o cliente lê na mensagem e na linha da lista. */
export function couponPlanName(planCode: string | null): string {
  if (!planCode) return '—';
  if (planCode === ALL_PLANS_CODE) return ALL_PLANS_LABEL;
  const [name] = planCode.split('_');
  const tier = planTierOf(name);
  return tier ? PLAN_COPY[tier].name : name;
}

/** "R$ 100,00 de desconto por 1 mês", "10% de desconto uma vez". */
export function discountSummary(
  coupon: Pick<AdminCoupon, 'amountOffCents' | 'percentOff' | 'durationMonths'> & DurationFields,
): string {
  return `${discountLabel(coupon)} de desconto ${durationText(coupon)}`;
}

/** Mensagem pronta copiada pelo dono; mesma regra do código: sem clipboard, entrega por escrito. */
export async function copyCouponMessage(view: Window | null, notify: NotificationService, text: string): Promise<void> {
  const clipboard = view?.navigator?.clipboard;
  try {
    if (!clipboard?.writeText) throw new Error('sem clipboard');
    await clipboard.writeText(text);
    notify.success('Mensagem copiada.');
  } catch {
    notify.warning(`Não foi possível copiar. A mensagem é: ${text}`);
  }
}
