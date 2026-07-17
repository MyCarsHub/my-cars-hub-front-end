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

const CPF_PATTERN = /^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{11}$/;
const PHONE_PATTERN = /^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$|^\d{10,11}$/;

@Component({
  selector: 'app-step-personal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <h2 class="text-xl font-bold text-gray-900 mb-1">Seus dados pessoais</h2>
    <p class="text-sm text-primary-500 mb-6">
      Precisamos de algumas informações para configurar sua conta.
    </p>

    <form [formGroup]="form" class="space-y-4" (ngSubmit)="$event.preventDefault()">
      <div>
        <label for="ob-name" class="block text-sm font-medium text-gray-700 mb-1">
          Nome completo <span class="text-primary-500" aria-hidden="true">*</span>
        </label>
        <input
          id="ob-name"
          formControlName="name"
          type="text"
          autocomplete="name"
          class="w-full px-4 py-2.5 border rounded-lg text-sm transition-shadow
                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          [class.border-gray-300]="!nameInvalid()"
          [class.border-red-400]="nameInvalid()"
          placeholder="Seu nome completo"
          aria-required="true"
          [attr.aria-invalid]="nameInvalid()"
        />
        @if (nameInvalid()) {
          <p class="mt-1 text-xs text-red-500" role="alert">Nome é obrigatório.</p>
        }
      </div>

      <div>
        <label for="ob-cpf" class="block text-sm font-medium text-gray-700 mb-1">
          CPF <span class="text-primary-500" aria-hidden="true">*</span>
        </label>
        <input
          id="ob-cpf"
          formControlName="cpf"
          type="text"
          autocomplete="off"
          inputmode="numeric"
          class="w-full px-4 py-2.5 border rounded-lg text-sm transition-shadow
                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          [class.border-gray-300]="!cpfInvalid()"
          [class.border-red-400]="cpfInvalid()"
          placeholder="000.000.000-00"
          maxlength="14"
          aria-required="true"
          [attr.aria-invalid]="cpfInvalid()"
          (input)="onCpfInput($event)"
        />
        @if (cpfInvalid()) {
          <p class="mt-1 text-xs text-red-500" role="alert">{{ cpfErrorMessage() }}</p>
        }
      </div>

      <div>
        <label for="ob-phone" class="block text-sm font-medium text-gray-700 mb-1">
          Telefone <span class="text-primary-500" aria-hidden="true">*</span>
        </label>
        <input
          id="ob-phone"
          formControlName="phoneNumber"
          type="tel"
          autocomplete="tel"
          inputmode="tel"
          class="w-full px-4 py-2.5 border rounded-lg text-sm transition-shadow
                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          [class.border-gray-300]="!phoneInvalid()"
          [class.border-red-400]="phoneInvalid()"
          placeholder="(00) 00000-0000"
          maxlength="15"
          aria-required="true"
          [attr.aria-invalid]="phoneInvalid()"
          (input)="onPhoneInput($event)"
        />
        @if (phoneInvalid()) {
          <p class="mt-1 text-xs text-red-500" role="alert">{{ phoneErrorMessage() }}</p>
        }
      </div>
    </form>
  `,
})
export class StepPersonal implements OnInit {
  readonly initialData = input<OnboardingData>({});
  readonly formChange = output<Partial<OnboardingData>>();
  readonly isValid = output<boolean>();

  private readonly fb = inject(FormBuilder);

  readonly form: FormGroup = this.fb.group({
    name: ['', Validators.required],
    cpf: ['', [Validators.required, Validators.pattern(CPF_PATTERN)]],
    phoneNumber: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
  });

  ngOnInit(): void {
    const data = this.initialData();
    this.form.patchValue({
      name: data.name ?? '',
      cpf: data.cpf ?? '',
      phoneNumber: data.phoneNumber ?? '',
    });

    this.form.valueChanges.subscribe((val) => {
      // Emit RAW (digits-only) values so the container/service can POST them
      // straight to the backend without further normalization.
      this.formChange.emit({
        name: val.name ?? '',
        cpf: stripDigits(val.cpf),
        phoneNumber: stripDigits(val.phoneNumber),
      });
      this.isValid.emit(this.form.valid);
    });

    // Emit initial validity after a tiny delay to ensure container is ready
    setTimeout(() => {
      this.isValid.emit(this.form.valid);
    });
  }

  protected nameInvalid(): boolean {
    const ctrl = this.form.get('name');
    return !!(ctrl?.invalid && ctrl.touched);
  }

  protected cpfInvalid(): boolean {
    const ctrl = this.form.get('cpf');
    return !!(ctrl?.invalid && ctrl.touched);
  }

  protected phoneInvalid(): boolean {
    const ctrl = this.form.get('phoneNumber');
    return !!(ctrl?.invalid && ctrl.touched);
  }

  protected cpfErrorMessage(): string {
    const ctrl = this.form.get('cpf');
    if (ctrl?.hasError('required')) return 'CPF é obrigatório.';
    if (ctrl?.hasError('pattern')) return 'CPF inválido. Use o formato 000.000.000-00.';
    return '';
  }

  protected phoneErrorMessage(): string {
    const ctrl = this.form.get('phoneNumber');
    if (ctrl?.hasError('required')) return 'Telefone é obrigatório.';
    if (ctrl?.hasError('pattern')) return 'Telefone inválido. Use DDD + número.';
    return '';
  }

  /** Mark all fields touched so validation messages appear */
  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  protected onCpfInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/\D/g, '');
    if (value.length > 11) value = value.slice(0, 11);

    let formatted = '';
    if (value.length > 9) {
      formatted = `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`;
    } else if (value.length > 6) {
      formatted = `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6)}`;
    } else if (value.length > 3) {
      formatted = `${value.slice(0, 3)}.${value.slice(3)}`;
    } else {
      formatted = value;
    }

    this.form.get('cpf')?.setValue(formatted, { emitEvent: true });
  }

  protected onPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/\D/g, '');
    if (value.length > 11) value = value.slice(0, 11);

    let formatted = '';
    if (value.length > 6) {
      formatted = `(${value.slice(0, 2)}) ${value.slice(2, 7)}-${value.slice(7)}`;
    } else if (value.length > 2) {
      formatted = `(${value.slice(0, 2)}) ${value.slice(2)}`;
    } else if (value.length > 0) {
      formatted = `(${value}`;
    } else {
      formatted = value;
    }

    this.form.get('phoneNumber')?.setValue(formatted, { emitEvent: true });
  }
}
