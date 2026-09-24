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

/**
 * FIX-0538 — AUSENTE nao e TIPO ERRADO, e a diferenca so aparece no campo OPCIONAL.
 *
 * Antes, todo nao-texto era coagido para '' e caia no ramo do campo vazio. Em campo
 * obrigatorio ainda saia `required`, que ao menos recusa. Em campo OPCIONAL saia
 * `null`: o formulario ACEITAVA, e no submit `ptBrMoneyCents` fazia a mesma coercao
 * e devolvia `null` — o valor sumia sem uma linha de aviso.
 *
 * Os quatro casos abaixo sao a tabela inteira: {ausente, nao-texto} x {obrigatorio,
 * opcional}. So uma celula mudou, e e justamente a que ninguem olhava.
 */
describe('ptbr-money.validator — ausente x tipo errado (FIX-0538)', () => {
  function errorsForRaw(value: unknown, options = {}): Record<string, unknown> | null {
    return ptBrMoneyValidator(options)(new FormControl(value)) as Record<string, unknown> | null;
  }

  it('AUSENTE: obrigatorio pede o campo, opcional aceita', () => {
    for (const absent of [null, undefined, '', '   ']) {
      expect(errorsForRaw(absent), `obrigatorio com ${JSON.stringify(absent)}`).toEqual({
        required: true,
      });
      expect(
        errorsForRaw(absent, { optional: true }),
        `opcional com ${JSON.stringify(absent)}`,
      ).toBeNull();
    }
  });

  it('NAO-TEXTO e recusado como FORMATO, mesmo quando o campo e opcional', () => {
    for (const wrong of [45, 1500, 0, true, {}, []]) {
      expect(errorsForRaw(wrong), `obrigatorio com ${JSON.stringify(wrong)}`).toEqual({
        moneyFormat: true,
      });
      // A celula que mudou: opcional vale para AUSENTE, nao para valor de tipo errado.
      expect(
        errorsForRaw(wrong, { optional: true }),
        `opcional com ${JSON.stringify(wrong)}`,
      ).toEqual({ moneyFormat: true });
    }
  });

  /**
   * O numero e o caso caro: `String(45)` e `'45'`, que a gramatica pt-BR aceitaria.
   * Recusar no validador e o que impede 45 de virar R$ 45,00 por acidente.
   */
  it('um numero nao vira dinheiro por coercao em nenhum dos dois modos', () => {
    expect(errorsForRaw(45)).toEqual({ moneyFormat: true });
    expect(errorsForRaw(45, { optional: true })).toEqual({ moneyFormat: true });
    expect(ptBrMoneyCents(45 as unknown as string)).toBeNull();
  });
});
