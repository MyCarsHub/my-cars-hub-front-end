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
import { stripDigits } from '../../../utils/format';
import {
  applyMaskedDocumentInput,
  cpfShapeValidator,
  maskCpf,
  normalizeCpf,
} from '../../../utils/document-mask';
import { cpfValidator } from '../../../utils/validators/cpf.validator';

const PHONE_PATTERN = /^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$|^\d{10,11}$/;

/**
 * Progressive `(00) 00000-0000` mask. Shared by the input handler and the hydration
 * `patchValue` so a value coming back from the backend (raw digits) renders exactly
 * like one the user typed — Back used to rehydrate `52998224725` unmasked.
 */
function maskPhone(value: string | null | undefined): string {
  let digits = (value ?? '').replace(/\D/g, '');
  if (digits.length > 11) digits = digits.slice(0, 11);
  if (digits.length > 6) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length > 2) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length > 0) return `(${digits}`;
  return digits;
}

@Component({
  selector: 'app-step-personal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormField, FieldControl],
  template: `
    <h2 class="text-xl font-bold text-gray-900 mb-1 focus:outline-none" tabindex="-1">
      Seus dados pessoais
    </h2>
    <p class="text-sm text-primary-700 mb-6">
      Precisamos de algumas informações para configurar sua conta.
    </p>

    <form [formGroup]="form" class="space-y-4" (ngSubmit)="$event.preventDefault()">
      <app-form-field
        label="Nome completo"
        controlId="ob-name"
        [required]="true"
        [control]="form.get('name')"
        [messages]="nameMessages"
      >
        <input
          appFieldControl
          formControlName="name"
          type="text"
          autocomplete="name"
          class="w-full min-h-11 px-4 py-2.5 border rounded-lg text-sm transition-shadow
                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          placeholder="Seu nome completo"
        />
      </app-form-field>

      <app-form-field
        label="CPF"
        controlId="ob-cpf"
        [required]="true"
        [control]="form.get('cpf')"
        [messages]="cpfMessages"
      >
        <input
          appFieldControl
          formControlName="cpf"
          type="text"
          autocomplete="off"
          inputmode="numeric"
          class="w-full min-h-11 px-4 py-2.5 border rounded-lg text-sm transition-shadow
                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          placeholder="000.000.000-00"
          maxlength="14"
          (input)="onCpfInput($event)"
        />
      </app-form-field>

      <app-form-field
        label="Telefone"
        controlId="ob-phone"
        [required]="true"
        [control]="form.get('phoneNumber')"
        [messages]="phoneMessages"
      >
        <input
          appFieldControl
          formControlName="phoneNumber"
          type="tel"
          autocomplete="tel"
          inputmode="tel"
          class="w-full min-h-11 px-4 py-2.5 border rounded-lg text-sm transition-shadow
                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          placeholder="(00) 00000-0000"
          maxlength="15"
          (input)="onPhoneInput($event)"
        />
      </app-form-field>
    </form>
  `,
})
export class StepPersonal implements OnInit {
  readonly initialData = input<OnboardingData>({});
  readonly formChange = output<Partial<OnboardingData>>();
  readonly isValid = output<boolean>();

  private readonly fb = inject(FormBuilder);

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly nameMessages: Readonly<Record<string, string>> = {
    required: 'Nome é obrigatório.',
  };
  protected readonly cpfMessages: Readonly<Record<string, string>> = {
    required: 'CPF é obrigatório.',
    cpfShape: 'CPF inválido. Use o formato 000.000.000-00.',
    cpfInvalid: 'CPF inválido.',
  };
  protected readonly phoneMessages: Readonly<Record<string, string>> = {
    required: 'Telefone é obrigatório.',
    pattern: 'Telefone inválido. Use DDD + número.',
  };

  readonly form: FormGroup = this.fb.group({
    name: ['', Validators.required],
    cpf: ['', [Validators.required, cpfShapeValidator(), cpfValidator()]],
    phoneNumber: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
  });

  ngOnInit(): void {
    const data = this.initialData();
    // Backend returns RAW digits — re-mask on hydration so Back shows `000.000.000-00`
    // and `(00) 00000-0000`, not the raw value. Validators normalize, so masked is valid.
    this.form.patchValue({
      name: data.name ?? '',
      cpf: maskCpf(data.cpf ?? ''),
      phoneNumber: maskPhone(data.phoneNumber ?? ''),
    });

    this.form.valueChanges.subscribe((val) => {
      // Emit RAW (digits-only) values so the container/service can POST them
      // straight to the backend without further normalization. The CPF stays a
      // STRING throughout — a leading zero must survive to the request body.
      this.formChange.emit({
        name: val.name ?? '',
        cpf: normalizeCpf(val.cpf),
        phoneNumber: stripDigits(val.phoneNumber),
      });
      this.isValid.emit(this.form.valid);
    });

    // Emit initial validity after a tiny delay to ensure container is ready
    setTimeout(() => {
      this.isValid.emit(this.form.valid);
    });
  }

  /** Mark all fields touched so validation messages appear */
  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  /** Progressive CPF mask, caret preserved. */
  protected onCpfInput(event: Event): void {
    applyMaskedDocumentInput(event, this.form.get('cpf'), maskCpf);
  }

  protected onPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.form.get('phoneNumber')?.setValue(maskPhone(input.value), { emitEvent: true });
  }
}
