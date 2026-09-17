/**
 * QUANTO JA ENTROU NO MES — `GET /v1/dashboard/cash-accumulation`.
 *
 * Dinheiro que ENTROU (cobranca paga), nao receita distribuida. NAO confundir
 * com `DashboardSummaryDto.finance.revenueDaily`, que reparte o total do aluguel
 * pelos dias: aquilo e competencia, e usar aquilo aqui mostraria ao dono dinheiro
 * que ele nao recebeu.
 *
 * O contrato ja entrega pronto quase tudo que a tela precisa. O que ele entrega,
 * a tela NAO recalcula:
 *  - `points` e indexado por DIA DO MES (1..31), nao por data — e o que permite
 *    sobrepor dia 17 contra dia 17 sem alinhar meses de tamanhos diferentes.
 *  - `cumulativeCents` JA VEM ACUMULADO. Acumular de novo no cliente criaria uma
 *    segunda implementacao da mesma soma, e duas implementacoes divergem com o
 *    tempo — o backend tem teste travando a igualdade com o card RECEBIDO.
 *  - `dayCents` existe para o tooltip nao precisar subtrair acumulados, que e
 *    onde nascem centavos de diferenca.
 *  - `previousSameDayCents` e `deltaCents` vem prontos.
 *  - `throughDay` diz ate onde CADA curva vai; nao se infere.
 *
 * Sem buracos: dia sem recebimento vem com `dayCents: 0` e a curva fica PLANA.
 * Empresa sem nada recebido devolve curva no chao COM pontos, nunca lista vazia.
 * Tudo em CENTAVOS inteiros.
 */
export interface CashAccumulationPoint {
  /** Dia do mes, 1..31. */
  day: number;
  /** Acumulado do mes ate este dia, inclusive. */
  cumulativeCents: number;
  /** Entrada do proprio dia — para o tooltip, sem subtrair acumulados. */
  dayCents: number;
}

export interface CashAccumulationMonth {
  /** "YYYY-MM". */
  month: string;
  daysInMonth: number;
  /**
   * Ultimo dia coberto. No mes CORRENTE e hoje — e hoje ainda esta acontecendo,
   * entao o ultimo ponto nao e queda, e so o ponto que ainda nao subiu.
   */
  throughDay: number;
  points: CashAccumulationPoint[];
  totalCents: number;
}

export interface CashAccumulationResponse {
  current: CashAccumulationMonth;
  /** Mes anterior INTEIRO (`throughDay === daysInMonth`), como referencia. */
  previous: CashAccumulationMonth;
  /** Quanto o mes passado tinha acumulado NO MESMO DIA do mes. Vem pronto. */
  previousSameDayCents: number;
  /** `current.totalCents - previousSameDayCents`. PODE SER NEGATIVO. */
  deltaCents: number;
}
