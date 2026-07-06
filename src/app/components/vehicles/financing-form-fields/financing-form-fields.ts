import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-financing-form-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  templateUrl: './financing-form-fields.html',
})
export class FinancingFormFields {
  readonly formGroup = input.required<FormGroup>();
  readonly showContractDate = input<boolean>(true);

  protected fieldInvalid(name: string): boolean {
    const ctrl = this.formGroup().get(name);
    return !!ctrl && ctrl.invalid && ctrl.touched;
  }
}
