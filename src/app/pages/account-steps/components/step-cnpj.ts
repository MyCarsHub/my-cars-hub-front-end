import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { AccountSetupStore } from '../account-setup.store';

@Component({
    selector: 'app-step-cnpj',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ReactiveFormsModule],
    template: `
    <h2 class="text-xl font-bold text-gray-900 mb-1">CNPJ da empresa</h2>
    <p class="text-sm text-primary-500 mb-6">
      Caso sua empresa possua CNPJ, informe abaixo. Não é obrigatório.
    </p>

    <form [formGroup]="form" class="space-y-4">
      <!-- Checkbox -->
      <label
        class="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-lg cursor-pointer
               border border-gray-200 hover:bg-gray-100 transition-colors"
      >
        <input
          type="checkbox"
          formControlName="hasCnpj"
          class="w-4 h-4 accent-primary-500 rounded"
        />
        <span class="text-sm font-medium text-gray-700">Minha empresa possui CNPJ</span>
      </label>

      <!-- CNPJ field (conditional) -->
      @if (form.get('hasCnpj')?.value) {
        <div>
          <label for="cnpj" class="block text-sm font-medium text-gray-700 mb-1">CNPJ</label>
          <input
            id="cnpj"
            formControlName="cnpj"
            type="text"
            class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm
                   focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                   transition-shadow"
            placeholder="00.000.000/0000-00"
            maxlength="18"
            (input)="onCnpjInput($event)"
          />
        </div>
      }
    </form>
  `,
})
export class StepCnpj implements OnInit {
    private readonly fb = inject(FormBuilder);
    private readonly store = inject(AccountSetupStore);

    readonly form: FormGroup = this.fb.group({
        hasCnpj: [false],
        cnpj: [''],
    });

    ngOnInit(): void {
        const data = this.store.formData();
        this.form.patchValue({
            hasCnpj: data.hasCnpj,
            cnpj: data.cnpj,
        });

        this.form.valueChanges.subscribe((val) => {
            this.store.updateFields({
                hasCnpj: val.hasCnpj ?? false,
                cnpj: val.cnpj ?? '',
            });
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
