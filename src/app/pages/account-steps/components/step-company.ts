import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AccountSetupStore } from '../account-setup.store';

@Component({
    selector: 'app-step-company',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ReactiveFormsModule],
    template: `
    <h2 class="text-xl font-bold text-gray-900 mb-1">Sua empresa</h2>
    <p class="text-sm text-primary-500 mb-6">
      Informe o nome da organização que será criada.
    </p>

    <form [formGroup]="form" class="space-y-4">
      <div>
        <label for="companyName" class="block text-sm font-medium text-gray-700 mb-1">Nome da empresa</label>
        <input
          id="companyName"
          formControlName="companyName"
          type="text"
          class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm
                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                 transition-shadow"
          placeholder="Nome da sua empresa"
        />
      </div>
    </form>
  `,
})
export class StepCompany implements OnInit {
    private readonly fb = inject(FormBuilder);
    private readonly store = inject(AccountSetupStore);

    readonly form: FormGroup = this.fb.group({
        companyName: ['', Validators.required],
    });

    ngOnInit(): void {
        const data = this.store.formData();
        this.form.patchValue({ companyName: data.companyName });

        this.form.valueChanges.subscribe((val) => {
            this.store.updateField('companyName', val.companyName ?? '');
        });
    }
}
