import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { CepService } from '../../services/cep.service';
import { InviteFlowService } from '../../services/invite-flow.service';
import { driverOnboardingFailure } from '../../services/invite-flow-errors';
import { InviteOnboardingTokenStore } from '../../services/invite-onboarding-token.store';
import {
  DriverLicenseCategory,
  DriverOnboardingRequest,
  InviteOnboardingContext,
} from '../../types/invite-flow.types';
import { BR_UFS } from '../../utils/br-ufs';

type StepId = 'personal' | 'license' | 'address' | 'confirm' | 'done';

const CATEGORIES: readonly DriverLicenseCategory[] = ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'];

const STEP_TITLES: Readonly<Record<StepId, string>> = {
  personal: 'Dados pessoais',
  license: 'CNH',
  address: 'Endereço',
  confirm: 'Confirmação',
  done: 'Tudo pronto',
};

/** Local `yyyy-MM-dd` of today, to compare with the `<input type="date">` value. */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function notExpired(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '');
  return value !== '' && value < todayIso() ? { expired: true } : null;
}

/**
 * Driver onboarding behind an invite (`/convite/cadastro` with role DRIVER).
 *
 * 1. Dados pessoais - name (read-only: the company registered it) and an optional RG.
 * 2. CNH - number, category, expiry.
 * 3. Endereço - CEP with the same auto-fill as the driver form. Concluding calls
 *    `POST /invite-onboarding/driver`.
 * 4. Tudo pronto - the ACCESS token is already stored through the normal login path.
 *
 * `needsLicense === false` (the company completed CNH and address while the invite was open)
 * collapses it to a confirmation step. If the backend still wants the data, the full steps open.
 */
@Component({
  selector: 'app-driver-onboarding',
  host: { class: 'flex flex-1 flex-col' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage, AlertBanner, ReactiveFormsModule, FormField, FieldControl],
  templateUrl: './driver-onboarding.html',
})
export class DriverOnboarding {
  private readonly flow = inject(InviteFlowService);
  private readonly cep = inject(CepService);
  private readonly onboardingToken = inject(InviteOnboardingTokenStore);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly context = input.required<InviteOnboardingContext>();
  /** The call can no longer succeed from here (revoked token, already done, other role). */
  readonly blocked = output<string>();

  protected readonly categories = CATEGORIES;
  protected readonly ufs = BR_UFS;

  protected readonly forceFull = signal(false);
  protected readonly submitting = signal(false);
  protected readonly cepLoading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly finished = signal(false);
  protected readonly stepIndex = signal(0);

  protected readonly confirmOnly = computed(
    () => this.context().needsLicense === false && !this.forceFull(),
  );
  protected readonly steps = computed<readonly StepId[]>(() =>
    this.confirmOnly() ? ['confirm', 'done'] : ['personal', 'license', 'address', 'done'],
  );
  protected readonly step = computed<StepId>(() => this.steps()[this.stepIndex()]);
  protected readonly stepNumbers = computed(() => this.steps().map((_, i) => i + 1));
  protected readonly totalSteps = computed(() => this.steps().length);
  protected readonly title = computed(() => STEP_TITLES[this.step()]);
  protected readonly companyName = computed(() => this.context().companyName);
  protected readonly roleLabel = computed(() => this.context().roleLabel);
  protected readonly fullName = computed(() => this.context().prefill.name ?? '');
  protected readonly firstName = computed(() => (this.context().prefill.name ?? '').split(/\s+/)[0] ?? '');

  protected readonly form = this.fb.nonNullable.group({
    rg: ['', [Validators.maxLength(15)]],
    licenseNumber: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{11}$/)]],
    licenseCategory: ['' as DriverLicenseCategory | '', [Validators.required]],
    licenseExpiry: ['', [Validators.required, notExpired]],
    address: this.fb.nonNullable.group({
      cep: ['', [Validators.required, Validators.pattern(/^\d{5}-?\d{3}$/)]],
      street: ['', [Validators.required, Validators.maxLength(180)]],
      number: ['', [Validators.maxLength(20)]],
      complement: ['', [Validators.maxLength(120)]],
      district: ['', [Validators.required, Validators.maxLength(120)]],
      city: ['', [Validators.required, Validators.maxLength(120)]],
      uf: ['', [Validators.required, Validators.pattern(/^[A-Z]{2}$/)]],
    }),
  });

  protected readonly rgMessages = { maxlength: 'Confira o RG (até 15 caracteres).', server: 'Confira o RG (até 15 caracteres).' };
  protected readonly licenseMessages = {
    required: 'Informe o número da CNH.',
    pattern: 'A CNH deve ter 11 letras ou números.',
    server: 'Confira o número da CNH.',
  };
  protected readonly categoryMessages = {
    required: 'Escolha a categoria.',
    server: 'Escolha a categoria da CNH.',
  };
  protected readonly expiryMessages = {
    required: 'Informe a validade da CNH.',
    expired: 'Informe uma validade que não esteja vencida.',
    server: 'Informe uma validade que não esteja vencida.',
  };
  protected readonly cepMessages = {
    required: 'Informe o CEP.',
    pattern: 'CEP inválido (00000-000).',
  };
  protected readonly streetMessages = { required: 'Informe a rua.' };
  protected readonly districtMessages = { required: 'Informe o bairro.' };
  protected readonly cityMessages = { required: 'Informe a cidade.' };
  protected readonly ufMessages = { required: 'Selecione a UF.', pattern: 'Selecione a UF.' };

  protected onLicenseInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 11);
    (event.target as HTMLInputElement).value = raw;
    this.form.controls.licenseNumber.setValue(raw);
  }

  /** Same auto-fill as the driver form: CEP lookup fills street, district, city and UF. */
  protected onCepBlur(): void {
    const address = this.form.controls.address;
    const digits = address.controls.cep.value.replace(/\D/g, '');
    if (digits.length !== 8) return;
    this.cepLoading.set(true);
    this.cep.lookup(digits).subscribe({
      next: (res) => {
        this.cepLoading.set(false);
        if (!res) return;
        address.patchValue({
          street: res.street || address.controls.street.value,
          district: res.district || address.controls.district.value,
          city: res.city || address.controls.city.value,
          uf: res.uf || address.controls.uf.value,
        });
      },
      error: () => this.cepLoading.set(false),
    });
  }

  protected next(): void {
    const step = this.step();
    this.errorMessage.set(null);
    if (step === 'personal') {
      if (this.form.controls.rg.invalid) {
        this.form.controls.rg.markAsTouched();
        return;
      }
      this.stepIndex.set(1);
    } else if (step === 'license') {
      const { licenseNumber, licenseCategory, licenseExpiry } = this.form.controls;
      if (licenseNumber.invalid || licenseCategory.invalid || licenseExpiry.invalid) {
        [licenseNumber, licenseCategory, licenseExpiry].forEach((c) => c.markAsTouched());
        return;
      }
      this.stepIndex.set(2);
    }
  }

  protected back(): void {
    if (this.submitting()) return;
    if (this.stepIndex() > 0 && this.step() !== 'done') this.stepIndex.update((i) => i - 1);
  }

  /** Last step: sends the data (or an empty body when the company already completed it). */
  protected submit(): void {
    if (this.submitting()) return;
    this.errorMessage.set(null);
    let payload: DriverOnboardingRequest = {};
    if (!this.confirmOnly()) {
      const { address } = this.form.controls;
      if (address.invalid) {
        address.markAllAsTouched();
        return;
      }
      const raw = this.form.getRawValue();
      payload = {
        licenseNumber: raw.licenseNumber.trim(),
        licenseCategory: raw.licenseCategory as DriverLicenseCategory,
        licenseExpiry: raw.licenseExpiry,
        address: {
          street: raw.address.street.trim(),
          number: raw.address.number.trim() || null,
          complement: raw.address.complement.trim() || null,
          district: raw.address.district.trim(),
          cep: raw.address.cep.trim(),
          city: raw.address.city.trim(),
          uf: raw.address.uf.toUpperCase(),
        },
        ...(raw.rg.trim() ? { rg: raw.rg.trim() } : {}),
      };
    }

    this.submitting.set(true);
    this.flow.submitDriver(payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        const context = this.context();
        this.flow.signIn(
          response.accessToken,
          { name: context.companyName, role: context.role || 'DRIVER' },
          context.prefill.name || undefined,
        );
        this.onboardingToken.clear();
        this.finished.set(true);
        this.stepIndex.set(this.steps().length - 1);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.fail(err);
      },
    });
  }

  protected goHome(): void {
    void this.router.navigate(['/alugueis'], { replaceUrl: true });
  }

  private fail(err: unknown): void {
    const failure = driverOnboardingFailure(err);
    switch (failure.kind) {
      case 'field': {
        // Confirmation-only but the backend wants the data: open the full steps.
        const wasConfirmOnly = this.confirmOnly();
        if (wasConfirmOnly) this.forceFull.set(true);
        const target = failure.field === 'rg' ? 0 : failure.field === 'address' ? 2 : 1;
        this.stepIndex.set(wasConfirmOnly ? 1 : target);
        if (failure.field === 'address') {
          this.errorMessage.set(failure.message);
        } else if (!wasConfirmOnly) {
          // The banner carries the exact reason (e.g. CNH taken); the control is just highlighted.
          this.errorMessage.set(failure.message);
          const control = this.form.controls[failure.field];
          control.setErrors({ server: true });
          control.markAsTouched();
        } else {
          this.errorMessage.set('Precisamos confirmar sua CNH e seu endereço. Preencha os dados abaixo.');
        }
        return;
      }
      case 'revoked':
        this.onboardingToken.clear();
        this.blocked.emit(failure.message);
        return;
      case 'wrong-role':
      case 'done':
        this.blocked.emit(failure.message);
        return;
      default:
        this.errorMessage.set(failure.message);
    }
  }
}
