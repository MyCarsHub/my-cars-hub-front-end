import { AdminCoupon } from '../../../types/admin-coupon.types';
import { couponStatus } from './coupon-copy';

/**
 * A situação da aba: Ativo (ainda funciona), Esgotado (código já usado até o limite) ou
 * Encerrado (venceu, foi desativado ou a janela do desconto direto acabou). O CHIP continua
 * dizendo o motivo exato (Desativado, Vencido...): a aba agrupa, o chip detalha.
 */
export type CouponSituation = 'ACTIVE' | 'EXHAUSTED' | 'ENDED';
export type SituationFilter = 'ALL' | CouponSituation;
export type TypeFilter = 'ALL' | AdminCoupon['mode'];

export interface CouponFilters {
  term: string;
  type: TypeFilter;
  situation: SituationFilter;
}

export function couponSituation(coupon: AdminCoupon, now: Date): CouponSituation {
  const status = couponStatus(coupon, now);
  if (status.live) return 'ACTIVE';
  if (status.label === 'Esgotado' || status.label === 'Usado') return 'EXHAUSTED';
  return 'ENDED';
}

export interface SituationCounts {
  ALL: number;
  ACTIVE: number;
  EXHAUSTED: number;
  ENDED: number;
}

interface Filterable {
  coupon: AdminCoupon;
  situation: CouponSituation;
  title: string;
  company: string;
}

const norm = (value: string): string => value.toLocaleLowerCase('pt-BR');

/** Busca (código ou empresa) e tipo; a situação fica de fora para as abas contarem cada uma. */
export function matchesSearchAndType(row: Filterable, { term, type }: Pick<CouponFilters, 'term' | 'type'>): boolean {
  const needle = norm(term.trim());
  return (
    (type === 'ALL' || row.coupon.mode === type) &&
    (needle === '' || norm(row.title).includes(needle) || norm(row.company).includes(needle))
  );
}

export function filterCoupons<T extends Filterable>(rows: readonly T[], filters: CouponFilters): T[] {
  return rows.filter(
    (row) =>
      matchesSearchAndType(row, filters) && (filters.situation === 'ALL' || row.situation === filters.situation),
  );
}

/** Contagem de cada aba, já respeitando a busca e o tipo. */
export function situationCounts(rows: readonly Filterable[], filters: Pick<CouponFilters, 'term' | 'type'>): SituationCounts {
  const counts: SituationCounts = { ALL: 0, ACTIVE: 0, EXHAUSTED: 0, ENDED: 0 };
  for (const row of rows) {
    if (!matchesSearchAndType(row, filters)) continue;
    counts.ALL++;
    counts[row.situation]++;
  }
  return counts;
}

/** Progresso de usos de 0 a 1; sem limite conhecido, o código vale 1 uso. */
export function usesProgress(coupon: Pick<AdminCoupon, 'timesRedeemed' | 'maxRedemptions'>): number {
  const max = Math.max(coupon.maxRedemptions ?? 1, 1);
  return Math.min(Math.max(coupon.timesRedeemed ?? 0, 0) / max, 1);
}

/** "4 / 20". */
export function usesSpaced(coupon: Pick<AdminCoupon, 'timesRedeemed' | 'maxRedemptions'>): string {
  return `${coupon.timesRedeemed ?? 0} / ${coupon.maxRedemptions ?? 1}`;
}

/** "09/11" a partir de "09/11/2026"; qualquer outra coisa volta como veio. */
export function shortDate(full: string): string {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(full) ? full.slice(0, 5) : full;
}
