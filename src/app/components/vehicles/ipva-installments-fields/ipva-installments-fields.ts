import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, ReactiveFormsModule } from '@angular/forms';
import { map, startWith, switchMap } from 'rxjs';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';
import { FieldControl, FormField } from '../../form-field/form-field';
import { IpvaRowGroup } from './ipva-installments-plan';

/**
 * Parcelas de IPVA do formulário do veículo (cadastro e edição): adicionar, editar e
 * remover. O formulário dono do `FormArray` decide quando e o que enviar; aqui só há a
 * apresentação, no molde dos cards opcionais (Financiamento, Seguro).
 *
 * Mobile-first: cada parcela é um bloco próprio; vencimento e valor lado a lado em duas
 * colunas, alvos de toque de 44px. Parcela paga aparece travada, só para leitura.
 */
@Component({
  selector: 'app-ipva-installments-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormField, FieldControl],
  templateUrl: './ipva-installments-fields.html',
})
export class IpvaInstallmentsFields {
  readonly rows = input.required<FormArray<IpvaRowGroup>>();
  /** Veículo vendido: o backend recusa mexer no IPVA (409); a tela trava antes. */
  readonly locked = input(false);

  /**
   * As linhas mudam DENTRO do mesmo FormArray (push/remove), então a referência do input não
   * muda e um filho OnPush não repintaria. O `valueChanges` do array vira a lista que o
   * template lê.
   */
  protected readonly controls = toSignal(
    toObservable(this.rows).pipe(
      switchMap((array) =>
        array.valueChanges.pipe(
          startWith(null),
          map(() => [...array.controls]),
        ),
      ),
    ),
    { initialValue: [] as IpvaRowGroup[] },
  );

  readonly addRow = output<void>();
  readonly removeRow = output<number>();

  protected readonly dateMessages: Readonly<Record<string, string>> = {
    required: 'Informe o vencimento.',
  };
  protected readonly amountMessages: Readonly<Record<string, string>> = {
    required: 'Informe o valor.',
    min: 'O valor precisa ser maior que zero.',
    moneyFormat: 'Informe um valor válido (ex.: 1.234,56).',
  };

  protected onMoneyInput(event: Event, row: IpvaRowGroup): void {
    applyPtBrMoneyMaskToControl(event, row.controls.amount);
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
}
