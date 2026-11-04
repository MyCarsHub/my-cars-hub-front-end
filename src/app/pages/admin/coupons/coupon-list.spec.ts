import { describe, expect, it } from 'vitest';
import { AdminCoupon } from '../../../types/admin-coupon.types';
import {
  couponSituation,
  filterCoupons,
  shortDate,
  situationCounts,
  usesProgress,
  usesSpaced,
} from './coupon-list';

const NOW = new Date('2026-11-04T12:00:00Z');

const BASE: AdminCoupon = {
  couponId: 'c',
  mode: 'OPEN_CODE',
  status: 'ACTIVE',
  companyId: null,
  planCode: 'PRO_MONTHLY_STRIPE',
  amountOffCents: 5000,
  percentOff: null,
  durationMonths: 3,
  timesRedeemed: 4,
  maxRedemptions: 20,
  promotionCode: 'MANOLO100OFF',
  expiresAt: '2099-01-01T00:00:00',
  createdAt: '2026-10-01T00:00:00',
};

const row = (coupon: AdminCoupon, company = '—') => ({
  coupon,
  situation: couponSituation(coupon, NOW),
  title: coupon.promotionCode ?? company,
  company,
});

describe('couponSituation', () => {
  it('ativo enquanto funciona', () => {
    expect(couponSituation(BASE, NOW)).toBe('ACTIVE');
  });

  it('esgotado quando os usos chegam ao limite', () => {
    expect(couponSituation({ ...BASE, timesRedeemed: 20 }, NOW)).toBe('EXHAUSTED');
  });

  it('código de empresa já usado também é esgotado', () => {
    expect(couponSituation({ ...BASE, mode: 'PROMOTION_CODE', timesRedeemed: 1 }, NOW)).toBe('EXHAUSTED');
  });

  it('desativado e vencido são encerrados', () => {
    expect(couponSituation({ ...BASE, status: 'DEACTIVATED' }, NOW)).toBe('ENDED');
    expect(couponSituation({ ...BASE, expiresAt: '2026-01-01T00:00:00' }, NOW)).toBe('ENDED');
  });

  it('desconto direto com a janela acabada é encerrado', () => {
    const direct: AdminCoupon = {
      ...BASE,
      mode: 'APPLIED_TO_SUBSCRIPTION',
      promotionCode: null,
      expiresAt: null,
      durationMonths: 1,
      createdAt: '2026-01-01T00:00:00',
    };
    expect(couponSituation(direct, NOW)).toBe('ENDED');
    expect(couponSituation({ ...direct, createdAt: '2026-11-01T00:00:00' }, NOW)).toBe('ACTIVE');
  });
});

describe('filtros', () => {
  const active = row(BASE);
  const exhausted = row({ ...BASE, couponId: 'e', promotionCode: 'BLACK15', timesRedeemed: 20 });
  const ended = row({ ...BASE, couponId: 'x', promotionCode: 'OLD', status: 'DEACTIVATED' });
  const company = row(
    { ...BASE, couponId: 'p', mode: 'PROMOTION_CODE', companyId: 'co', promotionCode: 'MCH-1', timesRedeemed: 0 },
    'Locadora Teste',
  );
  const all = [active, exhausted, ended, company];
  const none = { term: '', type: 'ALL', situation: 'ALL' } as const;

  it('sem filtro devolve tudo, na mesma ordem', () => {
    expect(filterCoupons(all, none)).toEqual(all);
  });

  it('a aba escolhe a situação', () => {
    expect(filterCoupons(all, { ...none, situation: 'EXHAUSTED' })).toEqual([exhausted]);
    expect(filterCoupons(all, { ...none, situation: 'ENDED' })).toEqual([ended]);
    expect(filterCoupons(all, { ...none, situation: 'ACTIVE' })).toEqual([active, company]);
  });

  it('busca por código ou empresa, sem ligar para maiúsculas', () => {
    expect(filterCoupons(all, { ...none, term: ' black' })).toEqual([exhausted]);
    expect(filterCoupons(all, { ...none, term: 'LOCADORA' })).toEqual([company]);
  });

  it('tipo e situação se somam', () => {
    expect(filterCoupons(all, { ...none, type: 'PROMOTION_CODE', situation: 'ENDED' })).toEqual([]);
    expect(filterCoupons(all, { ...none, type: 'OPEN_CODE', situation: 'ACTIVE' })).toEqual([active]);
  });

  it('as contagens das abas seguem a busca e o tipo, não a própria aba', () => {
    expect(situationCounts(all, { term: '', type: 'ALL' })).toEqual({ ALL: 4, ACTIVE: 2, EXHAUSTED: 1, ENDED: 1 });
    expect(situationCounts(all, { term: '', type: 'OPEN_CODE' })).toEqual({ ALL: 3, ACTIVE: 1, EXHAUSTED: 1, ENDED: 1 });
    expect(situationCounts(all, { term: 'mch', type: 'ALL' })).toEqual({ ALL: 1, ACTIVE: 1, EXHAUSTED: 0, ENDED: 0 });
  });
});

describe('usos e datas', () => {
  it('progresso vai de 0 a 1 e nunca passa do limite', () => {
    expect(usesProgress(BASE)).toBeCloseTo(0.2);
    expect(usesProgress({ timesRedeemed: 9, maxRedemptions: 5 })).toBe(1);
    expect(usesProgress({ timesRedeemed: null, maxRedemptions: undefined })).toBe(0);
  });

  it('sem limite conhecido o código vale 1 uso', () => {
    expect(usesSpaced({ timesRedeemed: 0, maxRedemptions: undefined })).toBe('0 / 1');
    expect(usesSpaced(BASE)).toBe('4 / 20');
  });

  it('data curta corta o ano; texto estranho volta como veio', () => {
    expect(shortDate('09/11/2026')).toBe('09/11');
    expect(shortDate('—')).toBe('—');
  });
});
