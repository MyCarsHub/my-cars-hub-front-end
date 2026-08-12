import { describe, expect, it } from 'vitest';
import { ENTERPRISE_YEARLY_TOTAL, PLAN_PRICES } from './landing-plans';

/**
 * A landing é pública e `GET /v1/billing/plans` exige autenticação, então estes
 * preços são uma CÓPIA da tabela `plans`. Este spec é o único ponto em que a
 * cópia é confrontada com a migration — `landing-structured-data.spec.ts` deriva
 * de `PLAN_PRICES` e por isso continuaria verde com o catálogo inteiro errado.
 */
describe('PLAN_PRICES', () => {
  it('espelha o estado-alvo de preço da V59', () => {
    // Valores conferidos contra a asserção final da própria migration
    // (V59:479-485), que derruba o boot do backend se o banco divergir.
    expect(PLAN_PRICES.trialMonthly).toBe(0); // V59:479
    expect(PLAN_PRICES.starterMonthly).toBe(79.9); // V59:480
    expect(PLAN_PRICES.starterYearlyTotal).toBe(799); // V59:481
    expect(PLAN_PRICES.proMonthly).toBe(149.9); // V59:482
    expect(PLAN_PRICES.proYearlyTotal).toBe(1499); // V59:483
    expect(PLAN_PRICES.enterpriseMonthly).toBe(299); // V59:484
    expect(PLAN_PRICES.enterpriseYearlyTotal).toBe(2990); // V59:485
  });

  /** Só o TRIAL concede dias; os planos pagos entram cobrando — V59:333-337. */
  it('mantém o trial em 14 dias', () => {
    expect(PLAN_PRICES.trialDays).toBe(14);
  });

  /**
   * O total anual é TABELADO, não calculado. `ENTERPRISE_YEARLY_TOTAL` era
   * `enterpriseMonthly * 12 * 0.85` = 3049,80 e a V59 fixou 2990,00 — a fórmula
   * batia por coincidência e passou a mentir. Se alguém a reintroduzir, este
   * teste é o que quebra.
   */
  it('não deriva o total anual do mensal', () => {
    expect(ENTERPRISE_YEARLY_TOTAL).toBe(PLAN_PRICES.enterpriseYearlyTotal);
    expect(ENTERPRISE_YEARLY_TOTAL).not.toBe(PLAN_PRICES.enterpriseMonthly * 12 * 0.85);
    expect(PLAN_PRICES.proYearlyTotal).not.toBe(PLAN_PRICES.proMonthly * 12 * 0.8);
  });

  /**
   * O STARTER ocupa a faixa de entrada paga que o PRO ocupava (79,90) e o PRO
   * subiu para 149,90 — V59:31-34. Se os dois voltarem a coincidir, alguém
   * copiou o preço errado de uma família para a outra.
   */
  it('mantém a escada de preço STARTER < PRO < ENTERPRISE', () => {
    expect(PLAN_PRICES.starterMonthly).toBeLessThan(PLAN_PRICES.proMonthly);
    expect(PLAN_PRICES.proMonthly).toBeLessThan(PLAN_PRICES.enterpriseMonthly);
    expect(PLAN_PRICES.starterYearlyTotal).toBeLessThan(PLAN_PRICES.proYearlyTotal);
    expect(PLAN_PRICES.proYearlyTotal).toBeLessThan(PLAN_PRICES.enterpriseYearlyTotal);
  });
});
