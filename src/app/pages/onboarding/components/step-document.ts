import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  output,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { OnboardingData } from '../onboarding.types';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import {
  applyMaskedDocumentInput,
  cnpjShapeValidator,
  maskCnpj,
  normalizeDocument,
} from '../../../utils/document-mask';
import { cnpjValidator } from '../../../utils/validators/cnpj.validator';

/**
 * CNPJ has been alphanumeric since July 2026 (12 alphanumeric positions + 2 numeric
 * check digits), so the mask and the shape check must not be digits-only. The value is
 * a STRING end to end — never coerced to a number, which would break letters and drop
 * leading zeros. Shape and mod-11 check digits are both validated locally, mirroring
 * the backend's `CnpjValidator`.
 */
@Component({
  selector: 'app-step-document',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormField, FieldControl],
  template: `
    <h2 class="text-xl font-bold text-gray-900 mb-1 focus:outline-none" tabindex="-1">
      CNPJ da empresa
    </h2>
    <p class="text-sm text-primary-700 mb-6">
      Caso sua empresa possua CNPJ, informe abaixo. Não é obrigatório.
    </p>

    <form [formGroup]="form" class="space-y-4" (ngSubmit)="$event.preventDefault()">
      <!-- Toggle checkbox -->
      <label
        class="flex min-h-11 items-center gap-3 px-4 py-3 rounded-lg cursor-pointer border transition-colors"
        [class.bg-primary-low]="form.get('hasCnpj')?.value"
        [class.border-primary-500]="form.get('hasCnpj')?.value"
        [class.bg-gray-50]="!form.get('hasCnpj')?.value"
        [class.border-gray-200]="!form.get('hasCnpj')?.value"
        for="ob-has-cnpj"
      >
        <input
          id="ob-has-cnpj"
          type="checkbox"
          formControlName="hasCnpj"
          class="w-5 h-5 shrink-0 accent-primary-500 rounded"
        />
        <span class="text-sm font-medium text-gray-700">Minha empresa possui CNPJ</span>
      </label>

      <!-- Conditional CNPJ field -->
      @if (form.get('hasCnpj')?.value) {
        <app-form-field
          label="CNPJ"
          controlId="ob-cnpj"
          [required]="true"
          [control]="form.get('cnpj')"
          [messages]="cnpjMessages"
        >
          <input
            appFieldControl
            formControlName="cnpj"
            type="text"
            inputmode="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            class="w-full min-h-11 px-4 py-2.5 border rounded-lg text-sm transition-shadow uppercase
                   placeholder:normal-case
                   focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="00.000.000/0000-00"
            maxlength="18"
            (input)="onCnpjInput($event)"
          />
        </app-form-field>
      }
    </form>
  `,
})
export class StepDocument implements OnInit {
  readonly initialData = input<OnboardingData>({});
  readonly formChange = output<Partial<OnboardingData>>();
  readonly isValid = output<boolean>();

  private readonly fb = inject(FormBuilder);

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly cnpjMessages: Readonly<Record<string, string>> = {
    required: 'Informe o CNPJ.',
    cnpjShape: 'CNPJ inválido. Use 14 caracteres, como 00.000.000/0000-00.',
    cnpjInvalid: 'CNPJ inválido. Confira os caracteres digitados.',
  };

  readonly form: FormGroup = this.fb.group({
    hasCnpj: [false],
    cnpj: [''],
  });

  ngOnInit(): void {
    const data = this.initialData();
    // Backend returns the RAW document — re-mask on hydration so Back shows
    // `00.000.000/0000-00`. Validators normalize first, so the masked value stays valid.
    this.form.patchValue({
      hasCnpj: data.hasCnpj ?? false,
      cnpj: maskCnpj(data.cnpj ?? ''),
    });

    this.applyCnpjValidators(!!this.form.get('hasCnpj')?.value);

    this.form.valueChanges.subscribe((val) => {
      this.applyCnpjValidators(!!val.hasCnpj);
      this.formChange.emit({
        hasCnpj: val.hasCnpj ?? false,
        // Unmasked STRING to the backend — mask is UX only, letters kept in upper case.
        cnpj: val.hasCnpj ? normalizeDocument(val.cnpj) : '',
      });
      // Valid when CNPJ is disabled OR when the (masked/raw) value matches the shape
      this.isValid.emit(!val.hasCnpj || this.form.get('cnpj')?.valid === true);
    });

    setTimeout(() => {
      const val = this.form.value;
      this.isValid.emit(!val.hasCnpj || this.form.get('cnpj')?.valid === true);
    });
  }

  private applyCnpjValidators(hasCnpj: boolean): void {
    const ctrl = this.form.get('cnpj');
    if (!ctrl) return;
    if (hasCnpj) {
      ctrl.setValidators([Validators.required, cnpjShapeValidator(), cnpjValidator()]);
    } else {
      ctrl.clearValidators();
    }
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  /** Mark all fields touched so validation messages appear */
  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  /** Progressive alphanumeric CNPJ mask, caret preserved. */
  protected onCnpjInput(event: Event): void {
    applyMaskedDocumentInput(event, this.form.get('cnpj'), maskCnpj);
  }
}
