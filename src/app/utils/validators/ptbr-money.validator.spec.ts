import { FormControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { ptBrMoneyCents, ptBrMoneyValidator } from './ptbr-money.validator';

/**
 * O validador e o conversor dos campos de dinheiro mascarados (FIX-0261).
 *
 * O ponto do módulo é que os dois falam a MESMA gramática: o que o validador
 * aceita, `ptBrMoneyCents` converte, e nada que o validador recuse chega ao
 * payload. O defeito que isso mata é `Number('45.000,00')` → `NaN` → zero
 * silencioso na API.
 */
describe('ptbr-money.validator', () => {
  function errorsFor(value: string, options = {}): Record<string, unknown> | null {
    return ptBrMoneyValidator(options)(new FormControl(value)) as Record<string, unknown> | null;
  }

  it('aceita a gramatica pt-BR com agrupamento e devolve os centavos', () => {
    expect(errorsFor('45.000,00', { minCents: 1 })).toBeNull();
    expect(ptBrMoneyCents('45.000,00')).toBe(4_500_000);
    expect(ptBrMoneyCents('1.234.567,89')).toBe(123_456_789);
    expect(ptBrMoneyCents('195,23')).toBe(19_523);
  });

  it('vazio e `required` por padrao e valido quando o campo e opcional', () => {
    expect(errorsFor('')).toEqual({ required: true });
    expect(errorsFor('   ')).toEqual({ required: true });
    expect(errorsFor('', { optional: true })).toBeNull();
    expect(ptBrMoneyCents('')).toBeNull();
  });

  it('decimal en-US e recusado como formato, NUNCA coagido (seria erro de 100x)', () => {
    expect(errorsFor('45.99')).toEqual({ moneyFormat: true });
    expect(ptBrMoneyCents('45.99')).toBeNull();
    expect(errorsFor('1.23.456')).toEqual({ moneyFormat: true });
    expect(errorsFor('abc')).toEqual({ moneyFormat: true });
  });

  it('zero nao passa onde o minimo e "maior que zero"', () => {
    expect(errorsFor('0,00', { minCents: 1 })).toEqual({ min: { min: 0.01 } });
    expect(errorsFor('0,01', { minCents: 1 })).toBeNull();
    expect(errorsFor('0,00', { optional: true })).toBeNull();
  });

  it('a chave de erro do minimo e `min`, para os mapas de mensagem ja escritos', () => {
    const errors = errorsFor('5,00', { minCents: 1000 });
    expect(errors).toEqual({ min: { min: 10 } });
  });
});
