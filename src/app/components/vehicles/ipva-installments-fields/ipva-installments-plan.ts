import { FormControl, FormGroup, Validators } from '@angular/forms';
import { IpvaInstallment } from '../../../types/vehicle-ipva.types';
import { formatPtBrMoney } from '../../../utils/ptbr-number';
import { ptBrMoneyCents, ptBrMoneyValidator } from '../../../utils/validators/ptbr-money.validator';

/**
 * Uma parcela de IPVA no formulário do veículo. `amount` é TEXTO pt-BR mascarado
 * (contrato dos campos de dinheiro); os centavos só nascem no submit.
 *
 * `id` nulo = parcela nova. `origDue`/`origCents` guardam o que o servidor tem, para
 * o submit só mandar PUT do que mudou — e para um retry depois de falha parcial não
 * repetir o que já gravou.
 */
export type IpvaRowGroup = FormGroup<{
  id: FormControl<string | null>;
  year: FormControl<number | null>;
  paid: FormControl<boolean>;
  paidDate: FormControl<string | null>;
  origDue: FormControl<string>;
  origCents: FormControl<number | null>;
  dueDate: FormControl<string>;
  amount: FormControl<string>;
}>;

export interface IpvaRowSeed {
  id?: string | null;
  year?: number | null;
  paid?: boolean;
  paidDate?: string | null;
  dueDate?: string;
  amountCents?: number | null;
}

export function createIpvaRow(seed: IpvaRowSeed = {}): IpvaRowGroup {
  const dueDate = seed.dueDate ?? '';
  const amountCents = seed.amountCents ?? null;
  const group: IpvaRowGroup = new FormGroup({
    id: new FormControl<string | null>(seed.id ?? null),
    year: new FormControl<number | null>(seed.year ?? null),
    paid: new FormControl(seed.paid ?? false, { nonNullable: true }),
    paidDate: new FormControl<string | null>(seed.paidDate ?? null),
    origDue: new FormControl(dueDate, { nonNullable: true }),
    origCents: new FormControl<number | null>(amountCents),
    dueDate: new FormControl(dueDate, { nonNullable: true, validators: [Validators.required] }),
    amount: new FormControl(amountCents == null ? '' : formatPtBrMoney(amountCents), {
      nonNullable: true,
      validators: [ptBrMoneyValidator({ minCents: 1 })],
    }),
  });
  // Parcela paga é prova de pagamento: o backend recusa editar e excluir; o formulário nem oferece.
  if (seed.paid) group.disable({ emitEvent: false });
  return group;
}

export function ipvaRowFromInstallment(i: IpvaInstallment): IpvaRowGroup {
  return createIpvaRow({
    id: i.id,
    year: i.year,
    paid: i.paid,
    paidDate: i.paidDate,
    dueDate: i.dueDate,
    amountCents: i.amountCents,
  });
}

export interface RemovedIpvaRow {
  id: string;
  year: number;
}

export type IpvaOp =
  | { kind: 'remove'; id: string; year: number; row: null }
  | {
      kind: 'update';
      id: string;
      year: number;
      row: IpvaRowGroup;
      dueDate: string;
      amountCents: number;
    }
  | { kind: 'add'; year: number; row: IpvaRowGroup; dueDate: string; amountCents: number };

/** Exercício de um vencimento ISO (`AAAA-MM-DD`). */
export function ipvaYearOf(dueDate: string): number {
  return Number(dueDate.slice(0, 4));
}

/**
 * O que o submit precisa mandar: exclusões, depois edições (só do que mudou), depois
 * inclusões. O ano de uma parcela existente é o do exercício em que ela mora no servidor;
 * o de uma nova é o do vencimento digitado.
 */
export function planIpvaOps(
  rows: readonly IpvaRowGroup[],
  removed: readonly RemovedIpvaRow[],
): IpvaOp[] {
  const ops: IpvaOp[] = removed.map((r) => ({
    kind: 'remove',
    id: r.id,
    year: r.year,
    row: null,
  }));
  for (const row of rows) {
    const v = row.getRawValue();
    if (v.paid) continue;
    const amountCents = ptBrMoneyCents(v.amount) ?? 0;
    if (v.id && v.year != null) {
      if (v.dueDate !== v.origDue || amountCents !== v.origCents) {
        ops.push({ kind: 'update', id: v.id, year: v.year, row, dueDate: v.dueDate, amountCents });
      }
    } else {
      ops.push({ kind: 'add', year: ipvaYearOf(v.dueDate), row, dueDate: v.dueDate, amountCents });
    }
  }
  return ops;
}
