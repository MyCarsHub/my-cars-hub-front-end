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
import { stripDigits } from '../../../utils/format';

const CNPJ_PATTERN = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{14}$/;

@Component({
  selector: 'app-step-document',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <h2 class="text-xl font-bold text-gray-900 mb-1">CNPJ da empresa</h2>
    <p class="text-sm text-primary-500 mb-6">
      Caso sua empresa possua CNPJ, informe abaixo. Não é obrigatório.
    </p>

    <form [formGroup]="form" class="space-y-4" (ngSubmit)="$event.preventDefault()">
      <!-- Toggle checkbox -->
      <label
        class="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer border transition-colors"
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
          class="w-4 h-4 accent-primary-500 rounded"
        />
        <span class="text-sm font-medium text-gray-700">Minha empresa possui CNPJ</span>
      </label>

      <!-- Conditional CNPJ field -->
      @if (form.get('hasCnpj')?.value) {
        <div>
          <label for="ob-cnpj" class="block text-sm font-medium text-gray-700 mb-1">CNPJ</label>
          <input
            id="ob-cnpj"
            formControlName="cnpj"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm transition-shadow
                   focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="00.000.000/0000-00"
            maxlength="18"
            [attr.aria-invalid]="cnpjInvalid()"
            (input)="onCnpjInput($event)"
          />
          @if (cnpjInvalid()) {
            <p class="mt-1 text-xs text-red-500" role="alert">
              CNPJ inválido. Use o formato 00.000.000/0000-00.
            </p>
          }
        </div>
      }
    </form>
  `,
})
export class StepDocument implements OnInit {
  readonly initialData = input<OnboardingData>({});
  readonly formChange = output<Partial<OnboardingData>>();
  readonly isValid = output<boolean>();

  private readonly fb = inject(FormBuilder);

  readonly form: FormGroup = this.fb.group({
    hasCnpj: [false],
    cnpj: [''],
  });

  ngOnInit(): void {
    const data = this.initialData();
    this.form.patchValue({
      hasCnpj: data.hasCnpj ?? false,
      cnpj: data.cnpj ?? '',
    });

    this.applyCnpjValidators(!!this.form.get('hasCnpj')?.value);

    this.form.valueChanges.subscribe((val) => {
      this.applyCnpjValidators(!!val.hasCnpj);
      this.formChange.emit({
        hasCnpj: val.hasCnpj ?? false,
        // Send digits-only to backend — mask is UX only
        cnpj: val.hasCnpj ? stripDigits(val.cnpj) : '',
      });
      // Valid when CNPJ is disabled OR when the (masked/raw) value matches the pattern
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
      ctrl.setValidators([Validators.required, Validators.pattern(CNPJ_PATTERN)]);
    } else {
      ctrl.clearValidators();
    }
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  protected cnpjInvalid(): boolean {
    const ctrl = this.form.get('cnpj');
    return !!(ctrl?.invalid && ctrl.touched);
  }

  protected onCnpjInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/\D/g, '');
    if (value.length > 14) value = value.slice(0, 14);

    let formatted = '';
    if (value.length > 12) {
      formatted = `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
    } else if (value.length > 8) {
      formatted = `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8)}`;
    } else if (value.length > 5) {
      formatted = `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5)}`;
    } else if (value.length > 2) {
      formatted = `${value.slice(0, 2)}.${value.slice(2)}`;
    } else {
      formatted = value;
    }

    this.form.get('cnpj')?.setValue(formatted, { emitEvent: true });
  }
}
