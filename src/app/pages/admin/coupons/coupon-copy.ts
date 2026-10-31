import { HttpErrorResponse } from '@angular/common/http';
import { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { parseApiError } from '../../../services/api-error';
import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon, AdminCouponMode } from '../../../types/admin-coupon.types';
import { formatBRL } from '../../../types/dashboard.types';
import { planTierOf } from '../../../utils/plan-features';
import { PLAN_COPY } from '../../../utils/plan-grid-copy';
import { formatFullDate, parseServerTime } from '../../../utils/server-time';

export type CouponAction = 'load' | 'preview' | 'create' | 'deactivate';

export interface CouponStatusView {
  label: string;
  tone: StatusChipTone;
  /** Ainda dá para desativar: algo depende dele. */
  live: boolean;
}

const PERCENT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

const PERIOD_LABEL: Record<string, string> = { MONTHLY: 'mensal', YEARLY: 'anual' };

const CODE_MESSAGES: Record<string, string> = {
  COUPON_ZEROES_PLAN:
    'Este desconto zera o plano. Reduza o valor: a fatura precisa ficar acima do mínimo da Stripe.',
  COUPON_PLAN_MISMATCH: 'O cupom precisa ser do plano atual da assinatura. Escolha o plano que a empresa já paga.',
  COUPON_ALREADY_APPLIED: 'Esta assinatura já tem um desconto. Desative o atual antes de criar outro.',
  COUPON_NO_OWNER: 'Esta empresa não tem dono com e-mail, e o código é preso ao cliente dele.',
};

const STRIPE_DOWN: Record<CouponAction, string> = {
  load: 'A Stripe não respondeu, e a lista de cupons mora lá. Tente de novo.',
  preview: 'A Stripe não respondeu. Tente de novo para ver a prévia.',
  create: 'A Stripe não respondeu. Confira a lista de cupons antes de tentar de novo.',
  deactivate: 'A Stripe não respondeu. O cupom continua como estava. Tente de novo.',
};

const GENERIC: Record<CouponAction, string> = {
  load: 'Não foi possível carregar os cupons. Tente de novo.',
  preview: 'Não foi possível calcular a prévia. Tente de novo.',
  create: 'Não foi possível criar o cupom. Tente de novo.',
  deactivate: 'Não foi possível desativar o cupom. Tente de novo.',
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
    Partial<Pick<AdminCoupon, 'createdAt' | 'durationMonths'>>,
  now: Date,
): CouponStatusView {
  if (coupon.status === 'DEACTIVATED') return { label: 'Desativado', tone: 'neutral', live: false };
  if (coupon.mode === 'APPLIED_TO_SUBSCRIPTION' && windowEnded(coupon, now)) {
    return { label: 'Encerrado', tone: 'neutral', live: false };
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
  if (parsed.code && CODE_MESSAGES[parsed.code]) return CODE_MESSAGES[parsed.code];
  if (parsed.code === 'COUPON_INVALID' && parsed.message) return parsed.message;
  if (action === 'create' && createOutcomeUnknown(err)) return STRIPE_DOWN.create;
  if (err instanceof HttpErrorResponse) {
    switch (err.status) {
      case 0:
        return 'Sem conexão com o servidor. Tente de novo.';
      case 403:
        return action === 'load' || action === 'preview'
          ? 'Seu papel não acessa os cupons.'
          : 'Só o papel Dono cria e desativa cupons.';
      case 404:
        return action === 'deactivate'
          ? 'Cupom não encontrado na Stripe.'
          : 'Empresa ou plano não encontrado, ou a empresa ainda não tem assinatura.';
      case 503:
        return STRIPE_DOWN[action];
    }
  }
  return GENERIC[action];
}

/** Nunca finge que copiou: sem área de transferência, entrega o código por escrito. */
export async function copyCouponCode(view: Window | null, notify: NotificationService, code: string): Promise<void> {
  const clipboard = view?.navigator?.clipboard;
  try {
    if (!clipboard?.writeText) throw new Error('sem clipboard');
    await clipboard.writeText(code);
    notify.success('Código copiado.');
  } catch {
    notify.warning(`Não foi possível copiar. O código é ${code}.`);
  }
}
