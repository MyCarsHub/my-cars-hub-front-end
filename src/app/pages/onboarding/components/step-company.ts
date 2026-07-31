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

@Component({
  selector: 'app-step-company',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormField, FieldControl],
  template: `
    <h2 class="text-xl font-bold text-gray-900 mb-1 focus:outline-none" tabindex="-1">
      Sua empresa
    </h2>
    <p class="text-sm text-primary-700 mb-6">Informe o nome da organização que será criada.</p>

    <form [formGroup]="form" class="space-y-4" (ngSubmit)="$event.preventDefault()">
      <app-form-field
        label="Nome da empresa"
        controlId="ob-company-name"
        [required]="true"
        [control]="form.get('companyName')"
        [messages]="companyNameMessages"
      >
        <input
          appFieldControl
          formControlName="companyName"
          type="text"
          autocomplete="organization"
          class="w-full min-h-11 px-4 py-2.5 border rounded-lg text-sm transition-shadow
                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          placeholder="Ex: Transportadora São Paulo"
        />
      </app-form-field>

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

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly companyNameMessages: Readonly<Record<string, string>> = {
    required: 'Nome da empresa é obrigatório.',
  };

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

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }
}
