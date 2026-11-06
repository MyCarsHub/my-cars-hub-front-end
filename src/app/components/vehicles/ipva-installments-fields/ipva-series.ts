import { AbstractControl, FormControl, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { IpvaInstallment } from '../../../types/vehicle-ipva.types';
import { ptBrMoneyCents, ptBrMoneyValidator } from '../../../utils/validators/ptbr-money.validator';

/** Teto de parcelas de uma série (o mesmo de `IpvaInstallmentService.MAX_INSTALLMENTS`). */
export const MAX_IPVA_SERIES = 12;

/**
 * Série de IPVA do formulário do veículo, no molde de Seguro e Financiamento: quatro campos
 * que o dono nomeia — Valor da parcela, Parcelas, Início e Vencimento. `amount` é TEXTO pt-BR
 * mascarado (contrato dos campos de dinheiro); `start` é o mês (`AAAA-MM`) da 1ª parcela;
 * `installments` e `dueDay` são texto numérico (nada de `type="number"`).
 */
export type IpvaSeriesGroup = FormGroup<{
  amount: FormControl<string>;
  installments: FormControl<string>;
  start: FormControl<string>;
  dueDay: FormControl<string>;
}>;

function integerInRange(min: number, max: number) {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = String(control.value ?? '').trim();
    if (raw === '') return { required: true };
    if (!/^\d+$/.test(raw)) return { integer: true };
    const n = Number(raw);
    return n < min || n > max ? { range: true } : null;
  };
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthValidator(control: AbstractControl): ValidationErrors | null {
  const raw = String(control.value ?? '').trim();
  if (raw === '') return { required: true };
  return MONTH.test(raw) ? null : { monthFormat: true };
}

export function createIpvaSeriesGroup(): IpvaSeriesGroup {
  return new FormGroup({
    amount: new FormControl('', {
      nonNullable: true,
      validators: [ptBrMoneyValidator({ minCents: 1 })],
    }),
    installments: new FormControl('1', {
      nonNullable: true,
      validators: [integerInRange(1, MAX_IPVA_SERIES)],
    }),
    start: new FormControl('', { nonNullable: true, validators: [monthValidator] }),
    dueDay: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, integerInRange(1, 31)],
    }),
  });
}

export interface IpvaSeriesInput {
  amountCents: number;
  count: number;
  /** `AAAA-MM`. */
  start: string;
  /** 1..31; em mês mais curto vale o último dia. */
  dueDay: number;
}

/** Uma parcela a gravar. `id`/`year` nascem quando o servidor confirma (base do retry). */
export interface IpvaDraft {
  dueDate: string;
  amountCents: number;
  id: string | null;
  year: number | null;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * As N parcelas: todas com o mesmo valor (o dono informa o valor da PARCELA, então não há
 * resto a repartir — os centavos digitados chegam intactos) e vencimentos mensais a partir do
 * mês de início, no dia pedido. Cada data é calculada do início (nunca da anterior), então
 * "dia 31" vira 28/29 em fevereiro e volta a 31 em março, sem arrastar.
 */
export function buildIpvaSeries(input: IpvaSeriesInput): IpvaDraft[] {
  const [startYear, startMonth] = input.start.split('-').map(Number);
  const out: IpvaDraft[] = [];
  for (let k = 0; k < input.count; k++) {
    const zero = startMonth - 1 + k;
    const year = startYear + Math.floor(zero / 12);
    const month = (zero % 12) + 1;
    const lastDay = new Date(year, month, 0).getDate();
    const day = Math.min(input.dueDay, lastDay);
    out.push({
      dueDate: `${year}-${pad(month)}-${pad(day)}`,
      amountCents: input.amountCents,
      id: null,
      year: null,
    });
  }
  return out;
}

/** Lê o grupo (já válido) e monta a série; `null` se algo não fechar. */
export function ipvaSeriesFromGroup(group: IpvaSeriesGroup): IpvaDraft[] | null {
  const v = group.getRawValue();
  const amountCents = ptBrMoneyCents(v.amount);
  if (group.invalid || amountCents == null || amountCents < 1) return null;
  return buildIpvaSeries({
    amountCents,
    count: Number(v.installments),
    start: v.start,
    dueDay: Number(v.dueDay),
  });
}

/** Exercício de um vencimento ISO (`AAAA-MM-DD`). */
export function ipvaYearOf(dueDate: string): number {
  return Number(dueDate.slice(0, 4));
}

export interface IpvaExistingSummary {
  count: number;
  paidCount: number;
  totalCents: number;
}

/** Resumo compacto do que já existe no servidor: "n de m pagas" e o total. */
export function summarizeIpva(installments: readonly IpvaInstallment[]): IpvaExistingSummary {
  return {
    count: installments.length,
    paidCount: installments.filter((i) => i.paid).length,
    totalCents: installments.reduce((acc, i) => acc + (i.amountCents ?? 0), 0),
  };
}
