import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AccountSetupStore } from '../account-setup.store';

@Component({
    selector: 'app-step-personal-data',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ReactiveFormsModule],
    template: `
    <h2 class="text-xl font-bold text-gray-900 mb-1">Seus dados pessoais</h2>
    <p class="text-sm text-primary-500 mb-6">
      Precisamos de algumas informações para configurar sua conta.
    </p>

    <form [formGroup]="form" class="space-y-4">
      <div>
        <label for="fullName" class="block text-sm font-medium text-gray-700 mb-1">Nome completo</label>
        <input
          id="fullName"
          formControlName="fullName"
          type="text"
          class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm
                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                 transition-shadow"
          placeholder="Seu nome completo"
        />
      </div>

      <div>
        <label for="cpf" class="block text-sm font-medium text-gray-700 mb-1">CPF</label>
        <input
          id="cpf"
          formControlName="cpf"
          type="text"
          class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm
                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                 transition-shadow"
          placeholder="000.000.000-00"
          maxlength="14"
          (input)="onCpfInput($event)"
        />
      </div>

      <div>
        <label for="phone" class="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
        <input
          id="phone"
          formControlName="phone"
          type="text"
          class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm
                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                 transition-shadow"
          placeholder="(00) 00000-0000"
          maxlength="15"
          (input)="onPhoneInput($event)"
        />
      </div>
    </form>
  `,
})
export class StepPersonalData implements OnInit {
    private readonly fb = inject(FormBuilder);
    private readonly store = inject(AccountSetupStore);

    readonly form: FormGroup = this.fb.group({
        fullName: ['', Validators.required],
        cpf: ['', Validators.required],
        phone: ['', Validators.required],
    });

    ngOnInit(): void {
        const data = this.store.formData();
        this.form.patchValue({
            fullName: data.fullName,
            cpf: data.cpf,
            phone: data.phone,
        });

        this.form.valueChanges.subscribe((val) => {
            this.store.updateFields({
                fullName: val.fullName ?? '',
                cpf: val.cpf ?? '',
                phone: val.phone ?? '',
            });
        });
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

        this.form.get('phone')?.setValue(formatted, { emitEvent: true });
    }
}
