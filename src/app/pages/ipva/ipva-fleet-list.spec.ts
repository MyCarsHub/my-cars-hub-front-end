import { describe, expect, it } from 'vitest';

import { ipvaSplitPreview } from '../vehicles/components/vehicle-ipva/ipva-split';
import { ipvaYearFromQuery } from '../vehicles/vehicle-detail';
import type { IpvaFleetRow } from '../../types/fleet-finance.types';
import { ipvaYearOptions, plateLabel, ptDate, ptDayMonth, toViewRow } from './ipva-fleet-list';

const money = (c: number) => `R$${c}`;

function row(over: Partial<IpvaFleetRow> = {}): IpvaFleetRow {
  return {
    vehicleId: 'v1',
    vehiclePlate: 'abc1d23',
    vehicleBrand: 'Fiat',
    vehicleModel: 'Argo',
    year: 2026,
    totalCents: 300_000,
    paidCents: 100_000,
    openCents: 200_000,
    installmentsCount: 3,
    paidCount: 1,
    overdueCount: 0,
    nextDueDate: '2026-11-20',
    status: 'PENDING',
    ...over,
  };
}

describe('ipva-fleet-list helpers', () => {
  it('offers next year, the current one and two before, newest first', () => {
    expect(ipvaYearOptions(2026)).toEqual([2027, 2026, 2025, 2024]);
  });

  it('formats dates without Date, so the timezone never moves the day', () => {
    expect(ptDate('2026-03-01')).toBe('01/03/2026');
    expect(ptDayMonth('2026-03-01')).toBe('01/03');
    expect(ptDate(null)).toBe('—');
  });

  it('formats Mercosul and old plates with the hyphen', () => {
    expect(plateLabel('abc1d23')).toBe('ABC-1D23');
    expect(plateLabel('')).toBe('—');
  });

  it('maps a row: progress, next due and the status chip', () => {
    const v = toViewRow(row());
    expect(v.plate).toBe('ABC-1D23');
    expect(v.installments).toBe('1/3');
    expect(v.progress).toBeCloseTo(1 / 3);
    expect(v.nextDue).toBe('20/11/2026');
    expect(v.chip).toEqual({ label: 'Em aberto', tone: 'neutral' });
    expect(v.overdueNote).toBeNull();
  });

  it('a fully paid year reads "Tudo pago" and an overdue one counts the late installments', () => {
    expect(toViewRow(row({ paidCount: 3, nextDueDate: null, status: 'PAID' })).nextDue).toBe(
      'Tudo pago',
    );
    const late = toViewRow(row({ overdueCount: 2, status: 'OVERDUE' }));
    expect(late.overdueNote).toBe('2 parcelas vencidas');
    expect(late.chip.tone).toBe('orange');
  });

  it('a year with no installments has an empty bar, not NaN', () => {
    expect(toViewRow(row({ installmentsCount: 0, paidCount: 0 })).progress).toBe(0);
  });
});

describe('ipvaSplitPreview (shared with the vehicle Gerência)', () => {
  it('puts the leftover cents in the first installments, like the backend', () => {
    expect(ipvaSplitPreview(100_000, 3, money)).toBe(
      '1x de R$33334 e 2x de R$33333 — os centavos que sobram entram nas primeiras.',
    );
    expect(ipvaSplitPreview(90_000, 3, money)).toBe('3x de R$30000.');
    expect(ipvaSplitPreview(90_000, 1, money)).toBe('Cota única de R$90000.');
  });

  it('stays quiet while the input is not valid', () => {
    expect(ipvaSplitPreview(null, 3, money)).toBeNull();
    expect(ipvaSplitPreview(90_000, 13, money)).toBeNull();
    expect(ipvaSplitPreview(90_000, 1.5, money)).toBeNull();
  });
});

describe('ipvaYearFromQuery', () => {
  it('accepts only a four-digit year', () => {
    expect(ipvaYearFromQuery('2026')).toBe(2026);
    expect(ipvaYearFromQuery('26')).toBeNull();
    expect(ipvaYearFromQuery('2026x')).toBeNull();
    expect(ipvaYearFromQuery(null)).toBeNull();
  });
});
