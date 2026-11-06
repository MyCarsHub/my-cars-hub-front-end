import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { map, startWith, switchMap } from 'rxjs';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';
import { formatPtBrMoney } from '../../../utils/ptbr-number';
import { FieldControl, FormField } from '../../form-field/form-field';
import { IpvaSeriesGroup, MAX_IPVA_SERIES, ipvaSeriesFromGroup } from './ipva-series';

/**
 * Série de parcelas de IPVA do formulário do veículo, no molde de Seguro e Financiamento:
 * Valor da parcela, Parcelas, Início e Vencimento. O formulário dono do grupo gera as
 * parcelas e as grava; aqui só há a apresentação e a prévia.
 *
 * Mobile-first: uma coluna em 375px, duas a partir de `sm`; alvos de toque de 44px+.
 */
@Component({
  selector: 'app-ipva-installments-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormField, FieldControl],
  templateUrl: './ipva-installments-fields.html',
})
export class IpvaInstallmentsFields {
  readonly group = input.required<IpvaSeriesGroup>();

  protected readonly maxInstallments = MAX_IPVA_SERIES;

  private readonly version = toSignal(
    toObservable(this.group).pipe(
      switchMap((g) => g.valueChanges.pipe(startWith(null), map(() => g.getRawValue()))),
    ),
    { initialValue: null },
  );

  /** Prévia "3x de R$ 333,33 — 10/03/2026 a 10/05/2026"; vazia enquanto algo não vale. */
  protected readonly preview = computed<string | null>(() => {
    this.version();
    const rows = ipvaSeriesFromGroup(this.group());
    if (!rows || rows.length === 0) return null;
    const cents = rows[0].amountCents;
    const total = formatPtBrMoney(cents * rows.length);
    const first = this.br(rows[0].dueDate);
    const last = this.br(rows[rows.length - 1].dueDate);
    const span = rows.length === 1 ? `vence em ${first}` : `de ${first} a ${last}`;
    return `${rows.length}x de R$ ${formatPtBrMoney(cents)} — ${span}. Total: R$ ${total}.`;
  });

  protected readonly amountMessages: Readonly<Record<string, string>> = {
    required: 'Informe o valor da parcela.',
    min: 'O valor precisa ser maior que zero.',
    moneyFormat: 'Informe um valor válido (ex.: 1.234,56).',
  };
  protected readonly installmentsMessages: Readonly<Record<string, string>> = {
    required: 'Informe quantas parcelas.',
    integer: 'Use um número inteiro.',
    range: `Informe de 1 a ${MAX_IPVA_SERIES} parcelas.`,
  };
  protected readonly startMessages: Readonly<Record<string, string>> = {
    required: 'Informe o mês de início.',
    monthFormat: 'Use o formato AAAA-MM (ex.: 2026-03).',
  };
  protected readonly dueDayMessages: Readonly<Record<string, string>> = {
    required: 'Informe o dia do vencimento.',
    integer: 'Use um número inteiro.',
    range: 'Informe um dia de 1 a 31.',
  };

  protected onMoneyInput(event: Event): void {
    applyPtBrMoneyMaskToControl(event, this.group().controls.amount);
  }

  private br(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
}
