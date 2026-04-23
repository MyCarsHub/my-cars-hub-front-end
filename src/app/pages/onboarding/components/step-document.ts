import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  output,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { OnboardingData } from '../onboarding.types';

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
            (input)="onCnpjInput($event)"
          />
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

    this.form.valueChanges.subscribe((val) => {
      this.formChange.emit({
        hasCnpj: val.hasCnpj ?? false,
        cnpj: val.hasCnpj ? (val.cnpj ?? '') : '',
      });
      this.isValid.emit(true); // CNPJ is always optional
    });

    setTimeout(() => {
      this.isValid.emit(true);
    });
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
