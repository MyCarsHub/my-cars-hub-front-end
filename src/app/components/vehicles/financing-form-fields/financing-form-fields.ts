import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AbstractControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FieldControl, FormField } from '../../form-field/form-field';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';

@Component({
  selector: 'app-financing-form-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormField, FieldControl],
  templateUrl: './financing-form-fields.html',
})
export class FinancingFormFields {
  readonly formGroup = input.required<FormGroup>();
  readonly showContractDate = input<boolean>(true);

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly contractDateMessages: Readonly<Record<string, string>> = {
    required: 'Informe a data do contrato.',
  };
  protected readonly purchasePriceMessages: Readonly<Record<string, string>> = {
    required: 'Informe o valor de compra.',
    min: 'Informe o valor de compra.',
    moneyFormat: 'Informe um valor válido (ex.: 45.000,00).',
  };
  /** Opcionais: sem `required`, só a gramática do valor. */
  protected readonly downPaymentMessages: Readonly<Record<string, string>> = {
    moneyFormat: 'Informe um valor válido (ex.: 10.000,00).',
  };
  protected readonly installmentAmountMessages: Readonly<Record<string, string>> = {
    moneyFormat: 'Informe um valor válido (ex.: 1.200,00).',
  };

  protected control(name: string): AbstractControl | null {
    return this.formGroup().get(name);
  }

  /**
   * Máscara de milhar DURANTE a digitação (FIX-0261), no mesmo padrão do
   * diálogo de venda. O controle guarda TEXTO pt-BR; quem converte para
   * centavos é o formulário consumidor, com `ptBrMoneyCents`.
   */
  protected onMoneyInput(event: Event, name: string): void {
    applyPtBrMoneyMaskToControl(event, this.control(name));
  }
}
