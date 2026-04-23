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

@Component({
  selector: 'app-step-company',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <h2 class="text-xl font-bold text-gray-900 mb-1">Sua empresa</h2>
    <p class="text-sm text-primary-500 mb-6">Informe o nome da organização que será criada.</p>

    <form [formGroup]="form" class="space-y-4" (ngSubmit)="$event.preventDefault()">
      <div>
        <label for="ob-company-name" class="block text-sm font-medium text-gray-700 mb-1">
          Nome da empresa <span class="text-primary-500" aria-hidden="true">*</span>
        </label>
        <input
          id="ob-company-name"
          formControlName="companyName"
          type="text"
          autocomplete="organization"
          class="w-full px-4 py-2.5 border rounded-lg text-sm transition-shadow
                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          [class.border-gray-300]="!companyInvalid()"
          [class.border-red-400]="companyInvalid()"
          placeholder="Ex: Transportadora São Paulo"
          aria-required="true"
          [attr.aria-invalid]="companyInvalid()"
        />
        @if (companyInvalid()) {
          <p class="mt-1 text-xs text-red-500" role="alert">Nome da empresa é obrigatório.</p>
        }
      </div>

      <p class="text-xs text-gray-400 leading-relaxed">
        Este será o nome da sua organização na plataforma. Você poderá alterá-lo depois nas
        configurações.
      </p>
    </form>
  `,
})
export class StepCompany implements OnInit {
  readonly initialData = input<OnboardingData>({});
  readonly formChange = output<Partial<OnboardingData>>();
  readonly isValid = output<boolean>();

  private readonly fb = inject(FormBuilder);

  readonly form: FormGroup = this.fb.group({
    companyName: ['', Validators.required],
  });

  ngOnInit(): void {
    const data = this.initialData();
    this.form.patchValue({ companyName: data.companyName ?? '' });

    this.form.valueChanges.subscribe((val) => {
      this.formChange.emit({ companyName: val.companyName ?? '' });
      this.isValid.emit(this.form.valid);
    });

    setTimeout(() => {
      this.isValid.emit(this.form.valid);
    });
  }

  protected companyInvalid(): boolean {
    const ctrl = this.form.get('companyName');
    return !!(ctrl?.invalid && ctrl.touched);
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }
}
