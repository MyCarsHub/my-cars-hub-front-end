import { describe, expect, it } from 'vitest';
import {
  addDays,
  brl,
  brl0,
  brlShort,
  goalTargets,
  mondayOf,
  monthEnd,
  presetRange,
  relativeDay,
  totals,
} from './driver-finance.calc';
import { toItem, toRentalContext } from './driver-finance.source';
import { TODAY, expense, income } from './driver-finance.testing';
import { RentalChargeDto } from '../../types/rental.types';

describe('driver-finance.calc', () => {
  it('formats money in pt-BR from cents', () => {
    expect(brl(123456)).toBe('R$ 1.234,56');
    expect(brl(-1200)).toBe('-R$ 12,00');
    expect(brl0(180000)).toBe('R$ 1.800');
    expect(brlShort(26060)).toBe('R$261');
    expect(brlShort(181690)).toBe('R$1,8k');
  });

  it('does date math on ISO strings', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(mondayOf('2026-10-10')).toBe('2026-10-05');
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(relativeDay(TODAY, TODAY)).toBe('Hoje');
    expect(relativeDay('2026-10-09', TODAY)).toBe('Ontem');
    expect(relativeDay('2026-10-07', TODAY)).toBe('qua, 07/10');
  });

  it('resolves the dashboard presets', () => {
    const custom = { from: '2026-10-01', to: '2026-10-05' };
    expect(presetRange('7d', TODAY, custom)).toEqual({ from: '2026-10-04', to: TODAY });
    expect(presetRange('monthPast', TODAY, custom)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('custom', TODAY, { from: '2026-10-05', to: '2026-10-01' })).toEqual(custom);
  });

  it('sums a window and counts only the days that already happened', () => {
    const t = totals(
      [income(), income({ id: 'g2', date: '2026-10-09', amount: 1000, rides: 1 }), expense()],
      '2026-10-09',
      '2026-10-31',
      TODAY,
    );
    expect(t).toMatchObject({ gross: 19640, expenses: 12000, rides: 10, days: 2 });
  });

  it('derives week and month goals as the prototype does', () => {
    expect(goalTargets(30000, 6)).toEqual({ day: 30000, week: 180000, month: 720000 });
  });
});

describe('driver-finance.source adapters', () => {
  it('reads the target contract', () => {
    expect(
      toItem({ id: 7, date: TODAY, type: 'INCOME', category: 'RIDES', amount: 100, app: '99', rides: 2 }),
    ).toMatchObject({ id: '7', amount: 100, app: '99', rides: 2, hours: null });
  });

  it('falls back to the ledger keys in production today', () => {
    expect(
      toItem({ id: 'x', kind: 'EXPENSE', category: 'FUEL', amountCents: 5000, occurredOn: TODAY, description: 'Posto' }),
    ).toMatchObject({ type: 'EXPENSE', amount: 5000, date: TODAY, notes: 'Posto' });
  });

  it('drops rows it cannot read', () => {
    expect(toItem({ id: 1, type: 'OTHER', amount: 1, date: TODAY })).toBeNull();
    expect(toItem({ id: 1, type: 'INCOME', amount: 1, date: '10/10/2026' })).toBeNull();
  });

  it('infers the rent period and the next charge from the charges', () => {
    const charge = (dueDate: string, status: RentalChargeDto['status']): RentalChargeDto => ({
      id: dueDate,
      kind: 'RENTAL_PERIOD',
      amount: 65000,
      status,
      provider: 'ASAAS',
      externalId: null,
      checkoutUrl: null,
      paidAt: null,
      dueDate,
      periodIndex: null,
    });
    const ctx = toRentalContext(
      'Fiat Mobi',
      'SJH-2B17',
      [charge('2026-09-29', 'PAID'), charge('2026-10-06', 'PAID'), charge('2026-10-13', 'PENDING')],
      TODAY,
    );
    expect(ctx).toMatchObject({ periodDays: 7, periodAmount: 65000, nextCharge: { dueDate: '2026-10-13' } });
  });
});
