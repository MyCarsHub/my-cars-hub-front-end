/**
 * Topo do eixo Y para uma serie em DINHEIRO (centavos).
 *
 * O DEFEITO QUE ISTO CORRIGE: o grafico normalizava pelo proprio maximo da
 * serie (`Math.max(1, ...valores)`), entao a barra mais alta encostava SEMPRE no
 * teto. R$ 150 e R$ 150.000 desenhavam exatamente a mesma montanha, e uma serie
 * inteira zerada virava `max = 1` — linha colada no chao contra uma escala que
 * nao significava nada.
 *
 * As tres regras, na ordem em que importam:
 *  1. COMECA NO ZERO. Numa serie de dinheiro, comparabilidade vale mais que
 *     compacidade: eixo truncado transforma variacao pequena em precipicio.
 *  2. PISO de R$ 100,00. Escolhido para ESTE produto: a menor grandeza mensal
 *     que significa alguma coisa numa locadora de 1 a 15 carros e da ordem de
 *     dezenas de reais. Com o piso, um mes de R$ 5 desenha um risco no chao em
 *     vez de encher o grafico, e a serie zerada ganha um eixo de verdade
 *     (0 → R$ 100) em vez de um eixo inventado. O piso de 5 unidades que serve
 *     para CONTAGEM nao serve aqui: cinco centavos nao e escala de nada.
 *  3. ARREDONDA PARA CIMA num valor redondo (1, 2 ou 5 vezes potencia de 10).
 *     E o que faz o pico PARAR de encostar no teto: com pico de R$ 1.500 o topo
 *     vira R$ 2.000, a barra desenha 75% e o rotulo do eixo diz um numero que
 *     uma pessoa le sem traduzir.
 *
 * Funcao PURA e exportada de proposito: e a regra que o dono precisa confiar, e
 * regra que se confia e regra que se testa sem montar componente.
 *
 * @param valuesCents valores da serie, em centavos. Negativo nao existe aqui
 *        (faturamento e recebimento nao sao negativos) e e tratado como zero.
 * @returns topo do eixo em centavos, sempre >= `MONEY_AXIS_FLOOR_CENTS`.
 */
export const MONEY_AXIS_FLOOR_CENTS = 100_00;

export function moneyAxisTopFor(valuesCents: readonly number[]): number {
  const peak = valuesCents.reduce((max, v) => Math.max(max, v > 0 ? v : 0), 0);

  if (peak <= MONEY_AXIS_FLOOR_CENTS) {
    return MONEY_AXIS_FLOOR_CENTS;
  }

  return niceCeil(peak);
}

/**
 * Menor valor "redondo" >= `value`: 1, 2 ou 5 vezes uma potencia de 10.
 *
 * Os tres passos (1/2/5) sao os mesmos que qualquer eixo legivel usa, porque
 * sao os que dividem bem por 2 e por 4 — e o eixo aqui desenha marcas em 100%,
 * 50% e 0%.
 */
function niceCeil(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;

  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;

  return step * magnitude;
}
