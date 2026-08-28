import { describe, it, expect } from 'vitest';

import {
  formatPtBrMoney,
  formatPtBrNumber,
  parsePtBrMoneyCents,
  parsePtBrNumber,
} from './ptbr-number';

const MONEY = 2;
const QUANTITY = 3;

describe('parsePtBrNumber — a gramática aceita', () => {
  it('lê inteiro sem separador', () => {
    expect(parsePtBrNumber('1500', MONEY).scaled).toBe(150_000);
  });

  it('lê vírgula decimal', () => {
    expect(parsePtBrNumber('1500,50', MONEY).scaled).toBe(150_050);
    expect(parsePtBrNumber('45,99', MONEY).scaled).toBe(4599);
  });

  it('lê ponto como separador de MILHAR — este é o defeito consertado', () => {
    // Antes: `1.500` passava por parseFloat e virava 1.5 → R$ 1,50.
    expect(parsePtBrNumber('1.500', MONEY).scaled).toBe(150_000);
    expect(parsePtBrNumber('1.500,50', MONEY).scaled).toBe(150_050);
    expect(parsePtBrNumber('1.234.567,89', MONEY).scaled).toBe(123_456_789);
    expect(parsePtBrNumber('12.345', MONEY).scaled).toBe(1_234_500);
  });

  it('completa as casas decimais que faltam', () => {
    expect(parsePtBrNumber('1500,5', MONEY).scaled).toBe(150_050);
    expect(parsePtBrNumber('3,5', QUANTITY).scaled).toBe(3500);
  });

  it('aceita parte inteira vazia — `,50` é meio real', () => {
    expect(parsePtBrNumber(',50', MONEY).scaled).toBe(50);
  });

  it('ignora o prefixo R$ e os espaços que o Intl insere ao copiar da tela', () => {
    expect(parsePtBrMoneyCents('R$ 1.500,50').scaled).toBe(150_050);
    // NBSP (U+00A0) e narrow NBSP (U+202F): e um destes que o Intl usa, e um replace
    // de espaco comum nao pegaria nenhum dos dois.
    expect(parsePtBrMoneyCents('R$\u00A01.500,50').scaled).toBe(150_050);
    expect(parsePtBrMoneyCents('R$\u202F1.500,50').scaled).toBe(150_050);
    expect(parsePtBrMoneyCents('  1.500,50  ').scaled).toBe(150_050);
  });
});

describe('parsePtBrNumber — a gramática recusada, sempre com motivo', () => {
  it('recusa ponto que não forma grupo de 3 — a ambiguidade decidida', () => {
    // `45.99` não é agrupamento pt-BR válido. A decisão é recusar, nunca adivinhar.
    expect(parsePtBrNumber('45.99', MONEY)).toEqual({ scaled: null, error: 'format' });
    expect(parsePtBrNumber('3.5', QUANTITY)).toEqual({ scaled: null, error: 'format' });
    expect(parsePtBrNumber('1500.50', MONEY)).toEqual({ scaled: null, error: 'format' });
    expect(parsePtBrNumber('1.23.456', MONEY)).toEqual({ scaled: null, error: 'format' });
  });

  it('recusa zero à esquerda de um grupo — é o que impede um milésimo virar milhar', () => {
    // A regra permissiva leria `0.001` como agrupamento e devolveria 1: erro de 1000x
    // e silencioso, exatamente o defeito. Aqui é recusa explícita.
    expect(parsePtBrNumber('0.001', QUANTITY)).toEqual({ scaled: null, error: 'format' });
    expect(parsePtBrNumber('01.234', QUANTITY)).toEqual({ scaled: null, error: 'format' });
    // …e o milésimo de verdade, escrito com vírgula, passa.
    expect(parsePtBrNumber('0,001', QUANTITY).scaled).toBe(1);
  });

  it('recusa casa decimal a mais — recusa, nunca arredondamento silencioso', () => {
    expect(parsePtBrNumber('1500,555', MONEY)).toEqual({ scaled: null, error: 'decimals' });
    expect(parsePtBrNumber('3,5555', QUANTITY)).toEqual({ scaled: null, error: 'decimals' });
  });

  it('recusa negativo, texto, vazio e vírgula solta', () => {
    for (const bad of ['-1', 'abc', '', '   ', ',', '1500,', '1,2,3', 'R$']) {
      expect(parsePtBrNumber(bad, MONEY).scaled).toBeNull();
    }
    expect(parsePtBrNumber(null, MONEY).scaled).toBeNull();
    expect(parsePtBrNumber(undefined, MONEY).scaled).toBeNull();
  });
});

describe('formatPtBrNumber é o inverso EXATO de parsePtBrNumber', () => {
  it('imprime dinheiro com as duas casas e o ponto de milhar', () => {
    expect(formatPtBrMoney(150_050)).toBe('1.500,50');
    expect(formatPtBrMoney(150_000)).toBe('1.500,00');
    expect(formatPtBrMoney(4599)).toBe('45,99');
    expect(formatPtBrMoney(0)).toBe('0,00');
    expect(formatPtBrMoney(123_456_789)).toBe('1.234.567,89');
  });

  it('imprime quantidade sem zeros à direita', () => {
    expect(formatPtBrNumber(3500, QUANTITY, { trailingZeros: false })).toBe('3,5');
    expect(formatPtBrNumber(2000, QUANTITY, { trailingZeros: false })).toBe('2');
    expect(formatPtBrNumber(1_000_000, QUANTITY, { trailingZeros: false })).toBe('1.000');
    expect(formatPtBrNumber(1, QUANTITY, { trailingZeros: false })).toBe('0,001');
  });

  /**
   * ESTE é o critério de aceite do conserto: tudo que a tela imprime, o campo lê de
   * volta como o mesmo número. Enquanto não era assim, ler-copiar-colar errava 1000x.
   */
  it('fecha o round-trip para toda a faixa, nas duas precisões', () => {
    const moneyCases = [0, 1, 50, 4599, 150_000, 150_050, 100_000_000, 123_456_789];
    for (const cents of moneyCases) {
      expect(parsePtBrMoneyCents(formatPtBrMoney(cents)).scaled).toBe(cents);
    }

    const quantityCases = [1, 500, 1000, 3500, 1_000_000, 10_000_000, 1234];
    for (const milli of quantityCases) {
      const shown = formatPtBrNumber(milli, QUANTITY, { trailingZeros: false });
      expect(parsePtBrNumber(shown, QUANTITY).scaled).toBe(milli);
    }
  });

  it('o que o formatBRL da tela de detalhe imprime também volta', () => {
    // formatBRL usa Intl; o parser tem de aceitar a saída dele, prefixo e NBSP inclusos.
    const shown = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      1500.5,
    );
    expect(parsePtBrMoneyCents(shown).scaled).toBe(150_050);
  });
});
