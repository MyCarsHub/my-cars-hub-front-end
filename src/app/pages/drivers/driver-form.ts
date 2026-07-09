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
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { DriverService } from '../../services/driver.service';
import { CepService } from '../../services/cep.service';
import {
  CreateDriverRequest,
  DriverStatus,
  LicenseCategory,
  UpdateDriverRequest,
} from '../../types/driver.types';
import { DRIVER_STATUS_META } from '../../utils/status-maps';

const CATEGORIES: LicenseCategory[] = ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'];
const STATUSES: Array<{ value: DriverStatus; label: string }> = (
  ['AVAILABLE', 'WORKING', 'SUSPENDED'] as DriverStatus[]
).map((v) => ({ value: v, label: DRIVER_STATUS_META[v].label }));
const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

@Component({
  selector: 'app-driver-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DefaultPageLayout, PageCard, PrimaryInput],
  templateUrl: './driver-form.html',
})
export class DriverForm implements OnInit {
  private readonly driverService = inject(DriverService);
  private readonly cepService = inject(CepService);
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

  // Máscaras visuais — o form control guarda só dígitos (telefone) / alfanumérico (CNH/doc).
  protected readonly phoneDisplay = signal('');
  protected readonly licenseDisplay = signal('');
  protected readonly documentDisplay = signal('');

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(180)]],
    userId: [''],
    document: this.fb.nonNullable.group({
      type: ['CPF' as 'CPF' | 'CNPJ', [Validators.required]],
      value: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{11,14}$/)]],
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
        this.phoneDisplay.set(this.formatPhone(phoneDigits));
        this.licenseDisplay.set(licenseRaw);
        this.documentDisplay.set(documentRaw);
        this.form.patchValue({
          name: driver.name,
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
        this.error.set(this.extractError(err, 'Motorista não encontrado.'));
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
        next: (driver) => this.router.navigate(['/motoristas', driver.id]),
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
        next: (driver) => this.router.navigate(['/motoristas', driver.id]),
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
    }
  }

  private handleError(err: HttpErrorResponse): void {
    this.saving.set(false);
    this.error.set(this.extractError(err, 'Não foi possível salvar o motorista.'));
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }

  protected cancel(): void {
    if (this.isEdit()) {
      this.router.navigate(['/motoristas', this.editingId()]);
    } else {
      this.router.navigate(['/motoristas']);
    }
  }

  // Helpers pra template
  protected fieldInvalid(path: string[]): boolean {
    let ctrl: any = this.form;
    for (const seg of path) ctrl = ctrl?.get(seg);
    return !!ctrl && ctrl.invalid && ctrl.touched;
  }
}
