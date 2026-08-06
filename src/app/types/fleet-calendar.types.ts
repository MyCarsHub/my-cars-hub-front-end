/**
 * Contrato de `GET /v1/fleet/calendar` — ocupação da frota no período.
 *
 * O payload é **por evento**, não por célula-dia: o backend devolve a lista de
 * aluguéis/manutenções que intersectam a janela e o front monta a grade. Não
 * peça uma grade dia a dia — existe teste no backend travando esse formato,
 * porque o payload cresceria com `frota × dias` em vez de com o número de
 * eventos reais.
 */

/**
 * Discriminador da origem da indisponibilidade. É **aberto** no backend
 * (`FleetOccupancyKindEnum`): uma origem nova entra como valor novo, e por isso
 * o campo da resposta é `string` e a normalização acontece na montagem da
 * grade. Ver `fleet-calendar.grid.ts:normalizeKind()`.
 */
export type FleetOccupancyKind = 'RENTAL' | 'MAINTENANCE';

/**
 * Bloco ocupado, **fechado nas duas pontas** (um aluguel de 10/08 a 10/08 ocupa
 * o dia inteiro).
 *
 * `start`/`end` são as datas REAIS do registro, **não recortadas na janela**:
 * um aluguel iniciado antes de `from` chega com a data original, e é isso que
 * permite desenhar a barra "entrando pela esquerda" em vez de fingir que ela
 * nasce na borda da tela.
 */
export interface FleetCalendarBlock {
  /** `RENTAL` | `MAINTENANCE` — discriminador aberto, ver {@link FleetOccupancyKind}. */
  readonly kind: string;
  /** Id do aluguel/manutenção. Com `kind`, é o par que abre o registro. */
  readonly sourceId: string;
  /** Status cru da origem: RESERVED/ACTIVE/COMPLETED ou SCHEDULED/IN_PROGRESS/DONE. */
  readonly status: string;
  /** `YYYY-MM-DD`, inclusivo. */
  readonly start: string;
  /** `YYYY-MM-DD`, inclusivo. Igual a `start` em manutenção (V19 não tem término). */
  readonly end: string;
  readonly label: string | null;
}

/** Uma linha da grade — o veículo já vem com TODOS os seus blocos. */
export interface FleetCalendarVehicle {
  readonly vehicleId: string;
  readonly plate: string;
  /** `"Marca Modelo · PLACA"`, montado pelo backend. */
  readonly label: string;
  /**
   * Valor cru de `vehicles.status`. É metadado de CADASTRO e não a fonte da
   * ocupação — existe defeito conhecido de ele não acompanhar o status do
   * aluguel. Quem manda na grade é {@link blocks}.
   */
  readonly vehicleStatus: string;
  readonly blocks: readonly FleetCalendarBlock[];
}

export interface FleetCalendarResponse {
  /** `YYYY-MM-DD` — início efetivo da janela, já com o default aplicado. */
  readonly from: string;
  /** `YYYY-MM-DD` — fim efetivo da janela. */
  readonly to: string;
  /** Fuso de negócio em que `from`/`to` são dias-calendário (`America/Sao_Paulo`). */
  readonly timezone: string;
  readonly vehicles: readonly FleetCalendarVehicle[];
}

/** Os três parâmetros são opcionais; sem `from`/`to` o backend usa o mês corrente. */
export interface FleetCalendarQuery {
  readonly from?: string;
  readonly to?: string;
  readonly vehicleId?: string;
}
