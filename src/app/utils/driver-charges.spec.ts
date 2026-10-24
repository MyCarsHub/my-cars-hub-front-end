import { describe, expect, it } from 'vitest';
import { DriverCharge } from '../types/driver-charges.types';
import { paidDayOf, driverChargeKindLabel, groupDriverCharges } from './driver-charges';

const TODAY = '2026-10-21';

const c = (over: Partial<DriverCharge> = {}): DriverCharge => ({
  id: 'c',
  kind: 'RENTAL_PERIOD',
  amount: 1000,
  status: 'PENDING',
  dueDate: '2026-11-01',
  periodIndex: 1,
  paidAt: null,
  checkoutUrl: null,
  ...over,
});

describe('groupDriverCharges', () => {
  it('separa atrasadas, a próxima, as demais abertas e o histórico', () => {
    const g = groupDriverCharges(
      [
        c({ id: 'paid', status: 'PAID', paidAt: '2026-09-01T10:00:00' }),
        c({ id: 'n2', dueDate: '2026-12-01' }),
        c({ id: 'late', status: 'PAST_DUE', dueDate: '2026-10-01' }),
        c({ id: 'n1', dueDate: '2026-11-01' }),
      ],
      TODAY,
    );

    expect(g.overdue.map((x) => x.id)).toEqual(['late']);
    expect(g.next?.id).toBe('n1');
    expect(g.upcoming.map((x) => x.id)).toEqual(['n2']);
    expect(g.history.map((x) => x.id)).toEqual(['paid']);
  });

  it('PENDING vencida ontem é atrasada; vencendo hoje ainda não é', () => {
    const g = groupDriverCharges(
      [c({ id: 'ontem', dueDate: '2026-10-20' }), c({ id: 'hoje', dueDate: TODAY })],
      TODAY,
    );

    expect(g.overdue.map((x) => x.id)).toEqual(['ontem']);
    expect(g.next?.id).toBe('hoje');
  });

  it('sem data de vencimento vem primeiro entre as abertas (a caução)', () => {
    const g = groupDriverCharges(
      [c({ id: 'a', dueDate: '2026-10-25' }), c({ id: 'cau', kind: 'CAUCAO', dueDate: null })],
      TODAY,
    );

    expect(g.next?.id).toBe('cau');
    expect(g.upcoming.map((x) => x.id)).toEqual(['a']);
  });

  it('atrasadas: a mais antiga primeiro', () => {
    const g = groupDriverCharges(
      [
        c({ id: 'b', status: 'PAST_DUE', dueDate: '2026-10-10' }),
        c({ id: 'a', status: 'PAST_DUE', dueDate: '2026-09-10' }),
      ],
      TODAY,
    );

    expect(g.overdue.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('histórico: a paga mais recente primeiro, e a devolvida entra', () => {
    const g = groupDriverCharges(
      [
        c({ id: 'old', status: 'PAID', paidAt: '2026-08-01T10:00:00' }),
        c({ id: 'new', status: 'PAID', paidAt: '2026-10-01T10:00:00' }),
        c({ id: 'ref', status: 'REFUNDED', paidAt: '2026-09-01T10:00:00' }),
      ],
      TODAY,
    );

    expect(g.history.map((x) => x.id)).toEqual(['new', 'ref', 'old']);
  });

  it('FAILED, CANCELED, RELEASED e DISPUTED não são desenhadas', () => {
    const g = groupDriverCharges(
      (['FAILED', 'CANCELED', 'RELEASED', 'DISPUTED'] as const).map((status) => c({ status })),
      TODAY,
    );

    expect(g).toEqual({ overdue: [], next: null, upcoming: [], history: [] });
  });

  it('V118 — FAILED vencida e com link (morto) nunca vira "atrasada" nem "a pagar" para o motorista', () => {
    const g = groupDriverCharges(
      [c({ status: 'FAILED', dueDate: '2026-10-16', checkoutUrl: 'https://www.asaas.com/i/morto' })],
      TODAY,
    );

    expect(g).toEqual({ overdue: [], next: null, upcoming: [], history: [] });
  });
});

describe('driverChargeKindLabel', () => {
  it('usa palavras do dia a dia', () => {
    expect(driverChargeKindLabel('RENTAL_PERIOD')).toBe('Aluguel');
    expect(driverChargeKindLabel('RENTAL_TOTAL')).toBe('Aluguel');
    expect(driverChargeKindLabel('CAUCAO')).toBe('Caução');
    expect(driverChargeKindLabel('OVERDUE_FEE')).toBe('Multa por atraso');
  });
});

describe('paidDayOf', () => {
  it('usa a parte da data como veio, sem converter fuso (o backend manda sem offset)', () => {
    expect(paidDayOf('2026-09-12T23:30:00')).toBe('2026-09-12');
    expect(paidDayOf('2026-09-13T00:10:00')).toBe('2026-09-13');
  });

  it('vazio ou inválido vira null', () => {
    expect(paidDayOf(null)).toBeNull();
    expect(paidDayOf('não é data')).toBeNull();
  });
});
