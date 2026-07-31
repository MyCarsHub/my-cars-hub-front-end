import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';
import { NotificationService } from '../../services/notification.service';
import { DriverService } from '../../services/driver.service';
import { CepService } from '../../services/cep.service';
import {
  CreateDriverRequest,
  DriverStatus,
  LicenseCategory,
  UpdateDriverRequest,
} from '../../types/driver.types';
import { DRIVER_STATUS_META } from '../../utils/status-maps';
import { isValidCpf } from '../../utils/validators/cpf.validator';

const CATEGORIES: LicenseCategory[] = ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'];
const STATUSES: Array<{ value: DriverStatus; label: string }> = (
  ['AVAILABLE', 'WORKING', 'SUSPENDED'] as DriverStatus[]
).map((v) => ({ value: v, label: DRIVER_STATUS_META[v].label }));
const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

@Component({
  selector: 'app-driver-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    PrimaryInput,
    AlertBanner,
    FormField,
    FieldControl,
  ],
  templateUrl: './driver-form.html',
})
export class DriverForm implements OnInit {
  private readonly driverService = inject(DriverService);
  private readonly cepService = inject(CepService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly categories = CATEGORIES;
  protected readonly statuses = STATUSES;
  protected readonly ufs = UFS;

  protected readonly editingId = signal<string | null>(null);
  protected readonly isEdit = computed(() => this.editingId() !== null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly cepLoading = signal(false);

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly nameMessages: Readonly<Record<string, string>> = {
    required: 'Informe o nome do motorista.',
  };
  protected readonly rgMessages: Readonly<Record<string, string>> = {
    required: 'Informe o RG.',
  };
  protected readonly emailMessages: Readonly<Record<string, string>> = {
    required: 'Informe um e-mail válido.',
    email: 'Informe um e-mail válido.',
  };
  protected readonly phoneMessages: Readonly<Record<string, string>> = {
    required: 'Informe um telefone válido (10 ou 11 dígitos).',
    pattern: 'Informe um telefone válido (10 ou 11 dígitos).',
  };
  protected readonly cepMessages: Readonly<Record<string, string>> = {
    required: 'CEP inválido (00000-000).',
    pattern: 'CEP inválido (00000-000).',
  };
  protected readonly streetMessages: Readonly<Record<string, string>> = {
    required: 'Informe a rua.',
  };
  protected readonly districtMessages: Readonly<Record<string, string>> = {
    required: 'Informe o bairro.',
  };
  protected readonly cityMessages: Readonly<Record<string, string>> = {
    required: 'Informe a cidade.',
  };
  protected readonly ufMessages: Readonly<Record<string, string>> = {
    required: 'Selecione a UF.',
    pattern: 'Selecione a UF.',
  };
  protected readonly licenseNumberMessages: Readonly<Record<string, string>> = {
    required: 'Informe o número da CNH.',
    pattern: 'A CNH deve ter 11 caracteres.',
  };
  protected readonly licenseExpiryMessages: Readonly<Record<string, string>> = {
    required: 'Informe a data de vencimento.',
  };
  protected readonly documentMessages: Readonly<Record<string, string>> = {
    required: 'CPF: 11 dígitos. CNPJ: 14 dígitos.',
    pattern: 'CPF: 11 dígitos. CNPJ: 14 dígitos.',
    cpfInvalid: 'CPF inválido.',
  };

  // Máscaras visuais — o form control guarda só dígitos (telefone) / alfanumérico (CNH/doc).
  protected readonly phoneDisplay = signal('');
  protected readonly licenseDisplay = signal('');
  protected readonly documentDisplay = signal('');
  protected readonly rgDisplay = signal('');

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(180)]],
    rg: ['', [Validators.required, Validators.maxLength(10)]],
    userId: [''],
    document: this.fb.nonNullable.group({
      type: ['CPF' as 'CPF' | 'CNPJ', [Validators.required]],
      value: ['', [
        Validators.required,
        Validators.pattern(/^[A-Z0-9]{11,14}$/),
        (ctrl: AbstractControl) => {
          const type = ctrl.parent?.get('type')?.value;
          if (type !== 'CPF' || !ctrl.value) return null;
          return isValidCpf(String(ctrl.value)) ? null : { cpfInvalid: true };
        },
      ]],
    }),
    contact: this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email, Validators.maxLength(180)]],
      phone: ['', [Validators.required, Validators.pattern(/^\d{10,11}$/)]],
    }),
    address: this.fb.nonNullable.group({
      cep: ['', [Validators.required, Validators.pattern(/^\d{5}-?\d{3}$/)]],
      street: ['', [Validators.required, Validators.maxLength(180)]],
      number: [''],
      complement: [''],
      district: ['', [Validators.required, Validators.maxLength(120)]],
      city: ['', [Validators.required, Validators.maxLength(120)]],
      uf: ['', [Validators.required, Validators.pattern(/^[A-Z]{2}$/)]],
    }),
    licenseNumber: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{11}$/)]],
    licenseCategory: ['B' as LicenseCategory, [Validators.required]],
    licenseExpiry: ['', [Validators.required]],
    status: ['AVAILABLE' as DriverStatus, [Validators.required]],
  });

  ngOnInit(): void {
    // Re-run CPF validation on document.value when type flips between CPF/CNPJ.
    this.form.controls.document.controls.type.valueChanges.subscribe(() => {
      this.form.controls.document.controls.value.updateValueAndValidity();
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editingId.set(id);
      this.loadDriver(id);
      this.form.controls.document.disable();
    }
  }

  protected onPhoneBeforeInput(event: InputEvent): void {
    // Bloqueia caracteres não-numéricos ANTES de entrarem no DOM (evita flash de letra).
    // Paste (insertFromPaste) passa direto — o (input) faz o strip.
    if (event.inputType === 'insertText' && event.data && !/^\d+$/.test(event.data)) {
      event.preventDefault();
    }
  }

  protected onPhoneInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 11);
    this.form.controls.contact.controls.phone.setValue(raw);
    this.form.controls.contact.controls.phone.markAsTouched();
    this.phoneDisplay.set(this.formatPhone(raw));
  }

  protected onLicenseInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 11);
    this.form.controls.licenseNumber.setValue(raw);
    this.form.controls.licenseNumber.markAsTouched();
    this.licenseDisplay.set(raw);
  }

  protected onRgInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10);
    this.form.controls.rg.setValue(raw);
    this.form.controls.rg.markAsTouched();
    this.rgDisplay.set(this.formatRg(raw));
  }

  private formatRg(digits: string): string {
    const d = digits.slice(0, 10);
    if (d.length === 0) return '';
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
    if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}-${d.slice(8)}`;
  }

  protected onDocumentInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 14);
    this.form.controls.document.controls.value.setValue(raw);
    this.form.controls.document.controls.value.markAsTouched();
    this.documentDisplay.set(raw);
  }

  private formatPhone(digits: string): string {
    const d = digits.slice(0, 11);
    if (d.length === 0) return '';
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  }

  private loadDriver(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.driverService.getOne(id).subscribe({
      next: (driver) => {
        const phoneDigits = (driver.contact.phone ?? '').replace(/\D/g, '').slice(0, 11);
        const licenseRaw = (driver.licenseNumber ?? '').toUpperCase().slice(0, 11);
        const documentRaw = (driver.document.value ?? '').toUpperCase().slice(0, 14);
        const rgDigits = (driver.rg ?? '').replace(/\D/g, '').slice(0, 10);
        this.phoneDisplay.set(this.formatPhone(phoneDigits));
        this.licenseDisplay.set(licenseRaw);
        this.documentDisplay.set(documentRaw);
        this.rgDisplay.set(this.formatRg(rgDigits));
        this.form.patchValue({
          name: driver.name,
          rg: rgDigits,
          userId: driver.userId ?? '',
          document: {
            type: driver.document.type ?? 'CPF',
            value: driver.document.value ?? '',
          },
          contact: {
            email: driver.contact.email,
            phone: phoneDigits,
          },
          address: {
            cep: driver.address.cep,
            street: driver.address.street,
            number: driver.address.number ?? '',
            complement: driver.address.complement ?? '',
            district: driver.address.district,
            city: driver.address.city,
            uf: driver.address.uf,
          },
          licenseNumber: licenseRaw,
          licenseCategory: driver.licenseCategory,
          licenseExpiry: driver.licenseExpiry,
          status: driver.status,
        });
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Motorista não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  protected onCepBlur(): void {
    const cep = this.form.controls.address.controls.cep.value;
    const digits = (cep ?? '').replace(/\D/g, '');
    if (digits.length !== 8) return;
    this.cepLoading.set(true);
    this.cepService.lookup(digits).subscribe({
      next: (res) => {
        this.cepLoading.set(false);
        if (!res) return;
        this.form.controls.address.patchValue({
          street: res.street || this.form.controls.address.controls.street.value,
          district: res.district || this.form.controls.address.controls.district.value,
          city: res.city || this.form.controls.address.controls.city.value,
          uf: res.uf || this.form.controls.address.controls.uf.value,
        });
      },
      error: () => this.cepLoading.set(false),
    });
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Verifique os campos destacados e tente novamente.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    clearServerErrors(this.form);

    const raw = this.form.getRawValue();
    const addressPayload = {
      street: raw.address.street.trim(),
      number: raw.address.number?.trim() || null,
      complement: raw.address.complement?.trim() || null,
      district: raw.address.district.trim(),
      cep: raw.address.cep.trim(),
      city: raw.address.city.trim(),
      uf: raw.address.uf.toUpperCase(),
    };
    const contactPayload = {
      email: raw.contact.email.trim(),
      phone: raw.contact.phone.trim(),
    };
    const commonPayload = {
      name: raw.name.trim(),
      rg: raw.rg ? raw.rg.replace(/\D/g, '') || null : null,
      userId: raw.userId?.trim() ? raw.userId.trim() : null,
      address: addressPayload,
      contact: contactPayload,
      licenseNumber: raw.licenseNumber.trim(),
      licenseCategory: raw.licenseCategory,
      licenseExpiry: raw.licenseExpiry,
      status: raw.status,
    };

    if (this.isEdit()) {
      const payload: UpdateDriverRequest = commonPayload;
      this.driverService.update(this.editingId()!, payload).subscribe({
        next: (driver) => this.onSaved(driver.id),
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
    } else {
      const payload: CreateDriverRequest = {
        ...commonPayload,
        document: {
          type: raw.document.type,
          value: raw.document.value.trim(),
        },
      };
      this.driverService.create(payload).subscribe({
        next: (driver) => this.onSaved(driver.id),
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
    }
  }

  private onSaved(id: string): void {
    this.notifications.success('Motorista salvo.');
    this.router.navigate(['/motoristas', id]);
  }

  /**
   * Backend `fieldErrors` (e.g. `licenseNumber` when the CNH is already registered)
   * land on the matching controls; only what is left over goes to the form banner.
   * Never a toast — `handleForm` claims the error so the safety net stays quiet.
   */
  private handleError(err: HttpErrorResponse): void {
    this.saving.set(false);
    const { formMessage } = this.apiErrors.handleForm(
      err,
      this.form,
      'Não foi possível salvar o motorista.',
    );
    this.error.set(formMessage);
  }

  protected cancel(): void {
    if (this.isEdit()) {
      this.router.navigate(['/motoristas', this.editingId()]);
    } else {
      this.router.navigate(['/motoristas']);
    }
  }
}
