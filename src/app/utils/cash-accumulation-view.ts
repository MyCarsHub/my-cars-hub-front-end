import { CashAccumulationResponse } from '../types/cash-accumulation.types';
import { formatBRL } from '../types/dashboard.types';
import { moneyAxisTopFor } from './money-axis';

/** Nome do mes em pt-BR a partir de "YYYY-MM", sem `Date` (mes nao tem dia nem fuso). */
const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function monthName(iso: string): string {
  const index = Number(iso.split('-')[1]) - 1;
  return MONTH_NAMES[index] ?? iso;
}

/** Uma curva pronta para desenhar: dia no eixo X, acumulado no eixo Y. */
export interface CashCurve {
  /** Pares [dia, centavos acumulados]. */
  points: ReadonlyArray<{ day: number; cents: number }>;
  /** Ultimo dia coberto — o eixo X da curva corrente para AQUI. */
  throughDay: number;
}

export interface CashAccumulationView {
  /** Total do mes corrente, o numero que puxa o cartao. */
  total: string;
  totalCents: number;
  /** Curva do mes corrente: SO ate hoje. */
  current: CashCurve;
  /** Curva do mes anterior INTEIRA, usada como referencia. */
  previous: CashCurve;
  /** Nome do mes anterior, para a frase de comparacao. */
  previousMonthLabel: string;
  /**
   * Rotulo da curva de REFERENCIA no grafico e na tabela.
   *
   * Diz "ate aqui" de proposito: o grafico desenha o mes anterior apenas ate o
   * dia de hoje, porque o eixo X sai da serie principal (`line-chart.ts:362`).
   * Rotular so "agosto" prometeria o mes inteiro e entregaria meio mes — e a
   * tela nao pode prometer mais do que o desenho mostra.
   */
  referenceLabel: string;
  /** Eixo X dos dois: o maior `daysInMonth`, para o dia 17 cair sobre o dia 17. */
  axisDays: number;
  /**
   * Topo do eixo Y, em centavos, calculado sobre AS DUAS series.
   *
   * O mes anterior vem INTEIRO e o corrente so ate hoje, entao o pico da
   * referencia e quase sempre o maior dos dois. Calcular o teto so sobre o mes
   * corrente faria a curva do mes passado estourar o topo do grafico — e ela e
   * justamente a linha de comparacao, a que precisa caber para o dono ver onde
   * ele chegou.
   */
  axisTopCents: number;
  /** Frase de comparacao, legivel em um segundo. */
  comparison: string;
  /** `up` = acima, `down` = abaixo, `flat` = exatamente igual. */
  trend: 'up' | 'down' | 'flat';
  /** Nada recebido no mes corrente: a curva fica no chao COM explicacao. */
  isEmpty: boolean;
}

/**
 * Traduz a resposta crua no que o cartao exibe. Funcao PURA: e a regra que
 * decide se o dono recebe boa ou ma noticia, e regra assim se testa sem montar
 * componente.
 *
 * TRES DECISOES DE DESENHO, que o contrato deixou para o front:
 *
 * 1. A CURVA CORRENTE PARA EM `throughDay`. Hoje ainda esta acontecendo: o
 *    ultimo ponto nao e queda, e so o ponto que ainda nao subiu. Desenhar o
 *    resto do mes faria "o faturamento despencou hoje" — o mesmo defeito de
 *    bucket parcial dos outros graficos. Como `cumulativeCents` nunca decresce,
 *    parar no fim dos dados e suficiente: nao ha o que zerar.
 *
 * 2. A CURVA ANTERIOR VEM INTEIRA e e REFERENCIA, nunca previsao. Ela mostra
 *    onde o mes passado chegou — informacao util — mas a parte dela que passa do
 *    dia de hoje NAO pode parecer projecao do mes corrente. Quem garante isso e
 *    a apresentacao (linha tracejada e esmaecida, rotulada com o nome do mes),
 *    e nao o corte dos dados: cortar no dia de hoje esconderia justamente o
 *    "onde ele chegou". Ver o `.spec` — a curva anterior mantem os 31 pontos.
 *
 * 3. `deltaCents` NEGATIVO E MA NOTICIA E APARECE COMO TAL. Forcar positivo
 *    esconderia mes ruim, e numero que so da boa noticia para de ser
 *    consultado — o cartao existe para ser aberto todo dia.
 */
export function cashAccumulationView(
  response: CashAccumulationResponse,
): CashAccumulationView {
  const { current, previous, previousSameDayCents, deltaCents } = response;

  const currentPoints = current.points
    // Defensivo: o contrato ja entrega so ate `throughDay`, mas desenhar um dia
    // a mais seria exatamente a queda falsa que a decisao 1 existe para impedir.
    .filter((p) => p.day <= current.throughDay)
    .map((p) => ({ day: p.day, cents: p.cumulativeCents }));

  const previousPoints = previous.points.map((p) => ({
    day: p.day,
    cents: p.cumulativeCents,
  }));

  const trend: 'up' | 'down' | 'flat' =
    deltaCents > 0 ? 'up' : deltaCents < 0 ? 'down' : 'flat';

  const previousMonthLabel = monthName(previous.month);

  return {
    total: formatBRL(current.totalCents),
    totalCents: current.totalCents,
    current: { points: currentPoints, throughDay: current.throughDay },
    previous: { points: previousPoints, throughDay: previous.throughDay },
    previousMonthLabel,
    referenceLabel: `${previousMonthLabel} até aqui`,
    // Os dois meses dividem o eixo: o maior numero de dias manda, senao o dia 31
    // do mes passado nao teria onde cair.
    axisDays: Math.max(current.daysInMonth, previous.daysInMonth),
    // As duas series no mesmo eixo: o teto tem de caber a maior das duas.
    axisTopCents: moneyAxisTopFor([
      ...currentPoints.map((p) => p.cents),
      ...previousPoints.map((p) => p.cents),
    ]),
    comparison: comparisonPhrase(deltaCents, previousSameDayCents, previousMonthLabel),
    trend,
    isEmpty: current.totalCents === 0,
  };
}

/**
 * A frase tem de ser lida em um segundo e tem de saber dar ma noticia.
 *
 * O percentual so existe quando ha base: com o mes passado zerado no mesmo dia,
 * "infinito por cento acima" nao diz nada — ali a frase cai no valor absoluto,
 * que e o que o dono consegue usar.
 */
function comparisonPhrase(
  deltaCents: number,
  previousSameDayCents: number,
  previousMonthLabel: string,
): string {
  if (deltaCents === 0) {
    return `igual a ${previousMonthLabel} até aqui`;
  }

  const direction = deltaCents > 0 ? 'acima de' : 'abaixo de';

  if (previousSameDayCents === 0) {
    return `${formatBRL(Math.abs(deltaCents))} ${direction} ${previousMonthLabel} até aqui`;
  }

  const percent = Math.abs(deltaCents / previousSameDayCents) * 100;
  const rounded = percent.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: percent < 10 ? 1 : 0,
  });

  return `${rounded}% ${direction} ${previousMonthLabel} até aqui`;
}
