import { describe, expect, it } from 'vitest';

import {
  graceHoursLabel,
  multiplierBpsFromInput,
  multiplierLabel,
  overdueGraceExample,
} from './overdue.types';

/**
 * Rótulo do multiplicador. O backend aceita QUALQUER inteiro de basis-points
 * entre 10000 e 50000 (`UpdateOverdueSettingsRequestDto`), então o rótulo tem
 * de saber exibir 1,05x e 1,0525x — arredondar para duas casas mostraria um
 * multiplicador que não é o cobrado.
 */
describe('multiplierLabel', () => {
  it('não inventa casas decimais para valores redondos', () => {
    expect(multiplierLabel(10_000)).toBe('1x');
    expect(multiplierLabel(20_000)).toBe('2x');
    expect(multiplierLabel(50_000)).toBe('5x');
  });

  it('usa vírgula e corta zeros à direita', () => {
    expect(multiplierLabel(15_000)).toBe('1,5x');
    expect(multiplierLabel(12_500)).toBe('1,25x');
  });

  it('exibe basis-points que não cabem em duas casas, sem arredondar', () => {
    expect(multiplierLabel(10_500)).toBe('1,05x');
    expect(multiplierLabel(10_525)).toBe('1,0525x');
    expect(multiplierLabel(10_001)).toBe('1,0001x');
  });
});

/** A conversão de entrada é a mesma que vai para o servidor. */
describe('multiplierBpsFromInput', () => {
  it('aceita vírgula e ponto, com mais de uma casa', () => {
    expect(multiplierBpsFromInput('1,05')).toBe(10_500);
    expect(multiplierBpsFromInput('1.05')).toBe(10_500);
    expect(multiplierBpsFromInput('1,0525')).toBe(10_525);
  });

  it('devolve null para o que não é número', () => {
    expect(multiplierBpsFromInput('')).toBeNull();
    expect(multiplierBpsFromInput('abc')).toBeNull();
    expect(multiplierBpsFromInput(null)).toBeNull();
  });
});

/**
 * O DEGRAU da tolerância — a razão de este helper existir.
 *
 * A tolerância decide SE cobra, mas não é descontada da contagem de dias
 * (`OverdueFeeCalculator`: `overdueDays = data da devolução − end_date`). Logo,
 * aumentar a tolerância adia a primeira cobrança E a torna maior. Quem mexe no
 * número na tela de configuração precisa ver isso.
 */
describe('overdueGraceExample', () => {
  it('sem tolerância, o prazo é a meia-noite que abre o dia seguinte', () => {
    const example = overdueGraceExample(15_000, 0);

    expect(example.dueAt).toBe('2026-07-21T00:00:00');
    expect(example.firstChargeDays).toBe(1);
    // 1 diária × R$ 100,00 × 1,5x = R$ 150,00.
    expect(example.firstChargeAmount).toBe(15_000);
  });

  it('72 horas de tolerância adiam o prazo para 24/07 às 00:00 — e a 1ª multa vira 4 diárias', () => {
    const example = overdueGraceExample(15_000, 72);

    expect(example.dueAt).toBe('2026-07-24T00:00:00');
    expect(example.firstChargeDays).toBe(4);
    // Este é o degrau do achado: R$ 0,00 às 23:59 de 23/07, R$ 600,00 às 00:01
    // de 24/07 — numa diária de R$ 100,00.
    expect(example.firstChargeAmount).toBe(60_000);
  });

  it('tolerância quebrada cai no mesmo dia do prazo', () => {
    // 21/07 00:00 + 30h = 22/07 06:00; devolver 22/07 06:01 são 2 diárias.
    const example = overdueGraceExample(15_000, 30);

    expect(example.dueAt).toBe('2026-07-22T06:00:00');
    expect(example.firstChargeDays).toBe(2);
  });

  it('cada 24 horas a mais de tolerância somam exatamente uma diária à primeira multa', () => {
    const days = [0, 24, 48, 72].map((h) => overdueGraceExample(20_000, h).firstChargeDays);

    expect(days).toEqual([1, 2, 3, 4]);
  });

  it('arredonda o valor como o backend: diária inteira antes de multiplicar', () => {
    // 1 diária × R$ 99,99 × 1,05x = 10498,95 → 10499 centavos (HALF_UP).
    const example = overdueGraceExample(10_500, 0, 9_999);

    expect(example.firstChargeAmount).toBe(10_499);
  });
});

describe('graceHoursLabel', () => {
  it('distingue nenhuma, uma e várias horas', () => {
    expect(graceHoursLabel(0)).toBe('sem tolerância');
    expect(graceHoursLabel(1)).toBe('1 hora');
    expect(graceHoursLabel(72)).toBe('72 horas');
  });
});
