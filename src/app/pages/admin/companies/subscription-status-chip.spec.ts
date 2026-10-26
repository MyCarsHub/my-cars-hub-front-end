import { describe, expect, it } from 'vitest';

import { subscriptionChip } from './subscription-status-chip';

/** AUDIT 2026-10-25 D1 — teste vencido não pode aparecer como teste valendo. */
describe('subscriptionChip', () => {
  const NOW = Date.parse('2026-10-25T12:00:00');

  it('teste com data no passado aparece como "Teste vencido", em vermelho', () => {
    const chip = subscriptionChip('TRIALING', '2026-10-15T12:00:00', NOW);
    expect(chip?.label).toBe('Teste vencido');
    expect(chip?.chip).toContain('red');
  });

  it('vence no instante exato do fim, como o BillingAccessService', () => {
    expect(subscriptionChip('TRIALING', '2026-10-25T12:00:00', NOW)?.label).toBe('Teste vencido');
  });

  it('teste ainda valendo continua "Em teste"', () => {
    expect(subscriptionChip('TRIALING', '2026-11-01T12:00:00', NOW)?.label).toBe('Em teste');
  });

  it('sem data (backend antigo) não inventa vencimento', () => {
    expect(subscriptionChip('TRIALING', null, NOW)?.label).toBe('Em teste');
    expect(subscriptionChip('TRIALING', undefined, NOW)?.label).toBe('Em teste');
  });

  it('a data de teste não afeta assinatura paga', () => {
    expect(subscriptionChip('ACTIVE', '2026-10-01T12:00:00', NOW)?.label).toBe('Ativa');
  });

  it('sem assinatura, sem chip', () => {
    expect(subscriptionChip(null, null, NOW)).toBeNull();
  });
});
