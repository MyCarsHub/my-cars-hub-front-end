/**
 * IPVA por exercício com parcelas (FEAT-0422). Espelha `IpvaYearDto` e
 * `IpvaInstallmentDto` do backend; todos os valores em CENTAVOS.
 */
export type IpvaInstallmentStatus = 'PAID' | 'OVERDUE' | 'PENDING';

export interface IpvaInstallment {
  id: string;
  vehicleId: string;
  year: number;
  number: number;
  dueDate: string;
  /** Só é `null` em parcela migrada do IPVA plano sem valor informado. */
  amountCents: number | null;
  paidDate: string | null;
  paidAmountCents: number | null;
  paid: boolean;
  status: IpvaInstallmentStatus;
}

export interface IpvaYear {
  vehicleId: string;
  year: number;
  totalCents: number;
  paidCents: number;
  openCents: number;
  installmentsCount: number;
  paidCount: number;
  /** Menor vencimento em aberto; `null` sem parcela em aberto. */
  nextDueDate: string | null;
  /** `null` quando o ano não tem parcelas. */
  status: IpvaInstallmentStatus | null;
  installments: IpvaInstallment[];
}

export interface GenerateIpvaInstallmentsRequest {
  totalCents: number;
  /** 1..12 — o backend recusa fora da faixa. */
  installments: number;
  firstDueDate: string;
}

export interface IpvaInstallmentRequest {
  dueDate: string;
  amountCents: number;
}

export interface PayIpvaInstallmentRequest {
  /** `null` = hoje. */
  paidDate?: string | null;
  /** `null` = o valor da parcela. */
  paidAmountCents?: number | null;
}
