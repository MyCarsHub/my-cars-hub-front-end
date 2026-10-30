/**
 * Uma linha de `GET /v1/vehicles/{id}/gerencia/pendencias`, já na ordem de urgência.
 * Contrato: `VehiclePendenciaDto` no backend. A tela lê `urgency`, nunca a recalcula.
 */
export type VehiclePendenciaType =
  | 'FINE'
  | 'MAINTENANCE'
  | 'INSURANCE'
  | 'LICENSING'
  | 'IPVA'
  | 'FINANCING_INSTALLMENT'
  | 'INSURANCE_INSTALLMENT'
  | 'INSPECTION';

export type VehiclePendenciaUrgency = 'OVERDUE' | 'DUE_SOON' | 'LATER' | 'NO_DATE';

export interface VehiclePendencia {
  type: VehiclePendenciaType;
  /** Id da própria linha. Único na lista: é o `track`. */
  id: string;
  /** Onde a linha se resolve. Nulo só em INSPECTION ainda sem vistoria. */
  targetId: string | null;
  /** O que é, pronto para mostrar: "Excesso de velocidade", "Financiamento, 9 de 48". */
  description: string;
  /** `yyyy-MM-dd`. Nulo em multa sem vencimento ou em plano só por km. */
  dueDate: string | null;
  /** Centavos. Nulo quando a origem não tem valor. Nunca 0. */
  amountCents: number | null;
  /** Negativo = dias de atraso, 0 = hoje, positivo = dias restantes. Nulo sem `dueDate`. */
  daysUntilDue: number | null;
  /** O chip e o quadro leem isto. Não recalcular. */
  urgency: VehiclePendenciaUrgency;
  /** Só MAINTENANCE: km do serviço planejado, quando houver. */
  dueHodometer: number | null;
}
