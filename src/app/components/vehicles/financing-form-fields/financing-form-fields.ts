import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AbstractControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FieldControl, FormField } from '../../form-field/form-field';

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
  };

  protected control(name: string): AbstractControl | null {
    return this.formGroup().get(name);
  }
}
