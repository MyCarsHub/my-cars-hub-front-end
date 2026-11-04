import { CouponRedemption } from '../../../types/admin-coupon.types';
import { formatBRL } from '../../../types/dashboard.types';
import { formatFullDate, formatTime, parseServerTime } from '../../../utils/server-time';
import { couponPlanName } from './coupon-copy';

export const UNKNOWN_COMPANY = 'Empresa não identificada';
export const PENDING_INVOICE = 'Aplicado · aguardando 1ª fatura paga';
export const REFUND_NOTE = 'Pagamentos estornados ainda contam como uso.';
export const TRUNCATED_NOTE = 'Mostrando os usos mais recentes; os mais antigos podem não aparecer.';
export const EMPTY_TITLE = 'Ninguém usou este cupom ainda.';

/** Quantas linhas entram em cascata; o resto aparece junto, para a lista nunca "escorrer". */
export const STAGGER_CAP = 8;

const brl = (cents: number): string => formatBRL(cents).replace(/\u00A0/g, ' ');

export interface RedemptionView {
  key: string;
  company: string;
  /** "Pro", ou `null` quando o plano não veio. */
  plan: string | null;
  /** "31/10/2026 às 21:34", no fuso do negócio. */
  when: string;
  pending: boolean;
  paid: string;
  /** Preço cheio, riscado; `null` quando não houve desconto a mostrar. */
  original: string | null;
  /** "− R$ 50,00" */
  discount: string | null;
}

export function redemptionView(item: CouponRedemption, index: number): RedemptionView {
  const date = parseServerTime(item.redeemedAt);
  const pending = item.source === 'APPLIED_NO_INVOICE_YET';
  const plan = couponPlanName(item.planCode);
  const showPrices = !pending && item.discountCents > 0;
  return {
    key: `${item.subscriptionId ?? 'sem-assinatura'}-${item.redeemedAt}-${index}`,
    company: item.companyName?.trim() || UNKNOWN_COMPANY,
    plan: plan === '—' ? null : plan,
    when: date ? `${formatFullDate(date)} às ${formatTime(date)}` : '—',
    pending,
    paid: brl(item.amountPaidCents),
    original: showPrices ? brl(item.amountWithoutDiscountCents) : null,
    discount: showPrices ? `− ${brl(item.discountCents)}` : null,
  };
}

/** A dica muda com o tipo: o código aberto é de qualquer pessoa, o de empresa é de uma só. */
export function emptyHint(isOpenCode: boolean): string {
  return isOpenCode
    ? 'Quando alguém usar o código, aparece aqui.'
    : 'Quando a empresa usar o código, o uso aparece aqui.';
}
