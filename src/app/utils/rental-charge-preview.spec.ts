import { describe, expect, it } from 'vitest';
import { normalizeChargePreview, summarizeChargePreview } from './rental-charge-preview';
import type { RentalChargePreviewDto } from '../types/rental.types';

const period = (index: number, dueDate: string, amountCents: number, destination: 'ASAAS' | 'LOCAL' = 'ASAAS') =>
  ({ kind: 'RENTAL_PERIOD', index, dueDate, amountCents, destination }) as const;

describe('normalizeChargePreview — o adaptador do contrato cru', () => {
  it('repassa um corpo completo como veio', () => {
    const raw: RentalChargePreviewDto = {
      automaticCharge: true,
      willCreateInGateway: true,
      charges: [period(0, '2026-08-05', 250_000), period(1, '2026-09-05', 250_000)],
      totalCents: 500_000,
      gatewayCount: 2,
      localCount: 0,
      firstDueDate: '2026-08-05',
      blocker: null,
    };
    expect(normalizeChargePreview(raw)).toEqual(raw);
  });

  it('deriva contagens, total e 1º vencimento das linhas quando o corpo não os traz', () => {
    const out = normalizeChargePreview({
      charges: [
        period(1, '2026-09-05', 100_000),
        period(0, '2026-08-05', 100_000, 'LOCAL'),
        { kind: 'CAUCAO', index: 0, dueDate: '2026-08-01', amountCents: 50_000, destination: 'ASAAS' },
      ],
    });
    expect(out.gatewayCount).toBe(2);
    expect(out.localCount).toBe(1);
    expect(out.totalCents).toBe(250_000);
    expect(out.firstDueDate).toBe('2026-08-01');
    expect(out.willCreateInGateway).toBe(true);
  });

  it('sem linha nenhuma no gateway, willCreateInGateway derivado é falso', () => {
    const out = normalizeChargePreview({ charges: [period(0, '2020-01-05', 100_000, 'LOCAL')] });
    expect(out.willCreateInGateway).toBe(false);
  });

  it('o que o backend declarou vence a derivação', () => {
    const out = normalizeChargePreview({
      willCreateInGateway: false,
      gatewayCount: 0,
      localCount: 7,
      totalCents: 1,
      firstDueDate: '2026-01-02',
      charges: [period(0, '2026-08-05', 100_000)],
    });
    expect(out.willCreateInGateway).toBe(false);
    expect(out.gatewayCount).toBe(0);
    expect(out.localCount).toBe(7);
    expect(out.totalCents).toBe(1);
    expect(out.firstDueDate).toBe('2026-01-02');
  });

  it('descarta linha malformada em vez de estourar e tolera corpo vazio/nulo', () => {
    const out = normalizeChargePreview({
      charges: [
        { kind: 'OVERDUE_FEE' } as never,
        { kind: 'RENTAL_PERIOD', dueDate: 'ontem' } as never,
        period(0, '2026-08-05', 100_000),
      ],
    });
    expect(out.charges).toHaveLength(1);
    expect(normalizeChargePreview(null).charges).toEqual([]);
    expect(normalizeChargePreview(undefined).blocker).toBeNull();
  });

  it('impeditivo vira {code, message}; sem mensagem ganha texto de reserva', () => {
    expect(
      normalizeChargePreview({ blocker: { code: 'ASAAS_DISCONNECTED', message: ' Reconecte o Asaas. ' } })
        .blocker,
    ).toEqual({ code: 'ASAAS_DISCONNECTED', message: 'Reconecte o Asaas.' });
    expect(normalizeChargePreview({ blocker: { code: 'X', message: '' } }).blocker?.message).toBe(
      'Não é possível criar o aluguel com estes dados.',
    );
    expect(normalizeChargePreview({ blocker: null }).blocker).toBeNull();
  });
});

describe('summarizeChargePreview — o que o diálogo mostra', () => {
  const base = normalizeChargePreview({
    automaticCharge: true,
    charges: [
      period(0, '2026-08-05', 250_000),
      period(1, '2026-09-05', 250_000),
      { kind: 'CAUCAO', index: 0, dueDate: '2026-08-01', amountCents: 80_000, destination: 'ASAAS' },
    ],
  });

  it('valor único quando todas as parcelas do período são iguais (a caução não conta)', () => {
    const s = summarizeChargePreview(base);
    expect(s.uniformPeriodCents).toBe(250_000);
    expect(s.periodCount).toBe(2);
    expect(s.caucao).toEqual({ amountCents: 80_000, dueDate: '2026-08-01', destination: 'ASAAS' });
    expect(s.totalCents).toBe(580_000);
  });

  it('valores diferentes viram null ("valores variam")', () => {
    const s = summarizeChargePreview(
      normalizeChargePreview({
        charges: [period(0, '2026-08-05', 250_000), period(1, '2026-09-05', 90_000)],
      }),
    );
    expect(s.uniformPeriodCents).toBeNull();
  });

  it('sem parcela do período não há valor por cobrança', () => {
    const s = summarizeChargePreview(normalizeChargePreview({ charges: [] }));
    expect(s.periodCount).toBe(0);
    expect(s.uniformPeriodCents).toBeNull();
    expect(s.caucao).toBeNull();
  });

  it('propaga o impeditivo e as contagens local/gateway', () => {
    const s = summarizeChargePreview(
      normalizeChargePreview({
        gatewayCount: 3,
        localCount: 2,
        blocker: { code: 'B', message: 'Não dá.' },
      }),
    );
    expect(s.blocker).toEqual({ code: 'B', message: 'Não dá.' });
    expect(s.gatewayCount).toBe(3);
    expect(s.localCount).toBe(2);
  });
});
