import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AbstractControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FieldControl, FormField } from '../../form-field/form-field';
import { INSURANCE_COVERAGE_OPTIONS } from '../../../utils/status-maps';

/**
 * Campos da apólice de seguro, reaproveitados pelo cadastro dentro do
 * formulário de veículo e pela tela de edição da apólice.
 *
 * Os valores monetários são digitados em REAIS; a conversão para centavos
 * (contrato da API) é responsabilidade do formulário consumidor via `toCents`.
 */
@Component({
  selector: 'app-insurance-form-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormField, FieldControl],
  templateUrl: './insurance-form-fields.html',
})
export class InsuranceFormFields {
  readonly formGroup = input.required<FormGroup>();

  protected readonly coverageOptions = INSURANCE_COVERAGE_OPTIONS;

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly insurerMessages: Readonly<Record<string, string>> = {
    required: 'Informe a seguradora.',
  };
  protected readonly policyNumberMessages: Readonly<Record<string, string>> = {
    required: 'Informe o número da apólice.',
  };
  protected readonly coverageMessages: Readonly<Record<string, string>> = {
    required: 'Selecione o tipo de cobertura.',
  };
  protected readonly premiumMessages: Readonly<Record<string, string>> = {
    required: 'Informe o valor do prêmio.',
    min: 'Informe o valor do prêmio.',
  };
  protected readonly startDateMessages: Readonly<Record<string, string>> = {
    required: 'Informe o início da vigência.',
  };
  protected readonly endDateMessages: Readonly<Record<string, string>> = {
    required: 'Informe o fim da vigência.',
  };

  protected control(name: string): AbstractControl | null {
    return this.formGroup().get(name);
  }

  /** Erro de grupo: só aparece depois que o usuário mexeu em alguma das datas. */
  protected hasDateRangeError(): boolean {
    const group = this.formGroup();
    const start = group.get('startDate');
    const end = group.get('endDate');
    return (
      group.hasError('insuranceDateRange') && (start?.touched === true || end?.touched === true)
    );
  }
}
