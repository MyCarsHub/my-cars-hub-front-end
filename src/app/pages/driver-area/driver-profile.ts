import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { PageCard } from '../../components/core/page-card/page-card';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { DRIVER_NAV_ROUTES } from '../../components/sidebar/driver-nav';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';
import { AuthService } from '../../services/auth.service';
import { CepService } from '../../services/cep.service';
import { DriverProfileService } from '../../services/driver-profile.service';
import { NotificationService } from '../../services/notification.service';
import { SessionService } from '../../services/session.service';
import { formatDate } from '../../types/dashboard.types';
import { DriverProfileData, DriverProfileUpdate } from '../../types/driver-ledger.types';
import { BR_UFS } from '../../utils/br-ufs';
import { applyMaskedCepInput, maskCep } from '../../utils/cep-mask';
import { applyMaskedPhoneInput, maskPhone, normalizePhone } from '../../utils/phone-mask';
import { companyRoleLabel } from '../../utils/role-labels';
import { ThemePicker } from '../../components/theme-picker/theme-picker';

/** DDD + number: 10 (landline) or 11 (mobile) digits — the server's own rule. */
export function phoneDigitsValidator(control: AbstractControl): ValidationErrors | null {
  const digits = normalizePhone(String(control.value ?? ''));
  if (digits === '') return null;
  return digits.length === 10 || digits.length === 11 ? null : { phoneFormat: true };
}

/**
 * `/perfil` for a DRIVER, drawn from the owner's prototype (`Motorista Perfil.dc.html`): his
 * read-only record, the two things he may edit about it, his account (help, Sair) and the
 * active rental. Without a rental the rental card is NOT drawn — no empty cards (owner).
 *
 * ## What is NOT here, on purpose
 *
 * No plan, no billing, no list of "empresas vinculadas" with a switch, and no "Rever o tour"
 * row although the prototype has one: `TOUR_STEPS` is the FLEET tour, none of its anchors is
 * on the driver's menu, so the button would open nothing. None of that is a driver's, and the generic profile's plan block called `/v1/billing/**`, which a
 * driver cannot read. This page reads `/v1/driver/profile` and nothing else.
 *
 * ## Edit
 *
 * Phone and address only — name, e-mail, document and CNH belong to the company that
 * registered him and are shown read-only. The CPF arrives masked from the server and is
 * rendered as received.
 */
@Component({
  selector: 'app-driver-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlertBanner,
    DefaultPageLayout,
    FieldControl,
    FormField,
    PageCard,
    ThemePicker,
  ],
  templateUrl: './driver-profile.html',
})
export class DriverProfile implements OnInit {
  private readonly profiles = inject(DriverProfileService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly cepService = inject(CepService);
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  private readonly navRoutes = inject(DRIVER_NAV_ROUTES);

  protected readonly ufs = BR_UFS;
  /** Where "Ver aluguel" and "Falar com o suporte" go — the menu's own map, so the demo follows. */
  protected readonly rentalBase = this.navRoutes.aluguel ?? '/alugueis';
  protected readonly supportRoute = this.navRoutes.suporte ?? '/suporte';
  protected readonly roleLabel = companyRoleLabel('DRIVER');

  protected readonly profile = signal<DriverProfileData | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly cepLoading = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly name = computed(
    () => this.profile()?.name || this.session.getItem('name') || '—',
  );
  protected readonly email = computed(
    () => this.profile()?.email || this.session.getItem('email') || '—',
  );
  protected readonly initials = computed(() => {
    const value = this.name();
    if (!value || value === '—') return '?';
    return value
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  });
  protected readonly license = computed(() => {
    const p = this.profile();
    if (!p?.licenseCategory) return null;
    const until = p.licenseExpiry ? ` · válida até ${formatDate(p.licenseExpiry)}` : '';
    return `Categoria ${p.licenseCategory}${until}`;
  });
  protected readonly rentalSince = computed(() => {
    const start = this.profile()?.activeRental?.startDate;
    return start ? formatDate(start) : null;
  });
  protected readonly rentalVehicle = computed(() => {
    const r = this.profile()?.activeRental;
    if (!r) return '';
    return [r.brand, r.model].filter(Boolean).join(' ');
  });

  protected readonly phoneMessages: Readonly<Record<string, string>> = {
    required: 'Informe o seu telefone.',
    phoneFormat: 'Telefone com DDD, 10 ou 11 números.',
  };
  protected readonly cepMessages: Readonly<Record<string, string>> = {
    required: 'Informe o CEP.',
    pattern: 'CEP inválido (00000-000).',
  };
  protected readonly streetMessages: Readonly<Record<string, string>> = { required: 'Informe a rua.' };
  protected readonly districtMessages: Readonly<Record<string, string>> = { required: 'Informe o bairro.' };
  protected readonly cityMessages: Readonly<Record<string, string>> = { required: 'Informe a cidade.' };
  protected readonly ufMessages: Readonly<Record<string, string>> = {
    required: 'Selecione a UF.',
    pattern: 'Selecione a UF.',
  };

  /**
   * Same fields and limits as the company-side `AddressDto`. They are required only when the
   * driver has — or starts typing — an address: a registration still pending has none, and
   * the page must not force him to invent one just to fix a phone number.
   */
  protected readonly form = this.fb.nonNullable.group({
    phone: ['', [Validators.required, phoneDigitsValidator]],
    address: this.fb.nonNullable.group({
      cep: ['', [Validators.pattern(/^\d{5}-?\d{3}$/), Validators.maxLength(9)]],
      street: ['', [Validators.maxLength(180)]],
      number: ['', [Validators.maxLength(20)]],
      complement: ['', [Validators.maxLength(120)]],
      district: ['', [Validators.maxLength(120)]],
      city: ['', [Validators.maxLength(120)]],
      uf: ['', [Validators.pattern(/^[A-Z]{2}$|^$/)]],
    }),
  });

  /** `true` once any address field has text: from then on the address is all-or-nothing. */
  protected readonly addressStarted = signal(false);

  /** A read-only value drawn as a field, as in the prototype — the eye reads it as "not mine to edit". */
  protected readonly readonlyClass =
    'min-h-12 flex items-center rounded-xl border border-edge bg-surface-muted px-3.5 py-2 ' +
    'text-base text-fg-soft break-words';

  protected readonly inputClass =
    'w-full min-h-12 bg-surface border rounded-xl px-3 text-base text-fg-body ' +
    'placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-primary-400 ' +
    'focus:border-primary-400 disabled:opacity-60 disabled:cursor-not-allowed';

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.profiles.get().subscribe({
      next: (profile) => {
        this.profile.set(profile);
        this.hydrate(profile);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.loadError.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar o seu perfil. Tente novamente.'),
        );
      },
    });
  }

  protected onPhoneInput(event: Event): void {
    applyMaskedPhoneInput(event, this.form.controls.phone);
  }

  protected onCepInput(event: Event): void {
    applyMaskedCepInput(event, this.form.controls.address.controls.cep);
    this.refreshAddressRequirement();
  }

  protected onAddressInput(): void {
    this.refreshAddressRequirement();
  }

  /** CEP lookup fills street, district, city and UF — the same auto-fill as the onboarding. */
  protected onCepBlur(): void {
    const address = this.form.controls.address;
    const digits = address.controls.cep.value.replace(/\D/g, '');
    if (digits.length !== 8) return;
    this.cepLoading.set(true);
    this.cepService.lookup(digits).subscribe({
      next: (res) => {
        this.cepLoading.set(false);
        if (!res) return;
        address.patchValue({
          street: res.street || address.controls.street.value,
          district: res.district || address.controls.district.value,
          city: res.city || address.controls.city.value,
          uf: res.uf || address.controls.uf.value,
        });
        this.refreshAddressRequirement();
      },
      error: () => this.cepLoading.set(false),
    });
  }

  protected save(): void {
    if (this.saving()) return;
    this.refreshAddressRequirement();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Verifique os campos destacados e tente novamente.');
      return;
    }

    const raw = this.form.getRawValue();
    const payload: DriverProfileUpdate = { phone: normalizePhone(raw.phone) };
    if (this.addressStarted()) {
      const a = raw.address;
      payload.address = {
        street: a.street.trim(),
        number: a.number.trim() || null,
        complement: a.complement.trim() || null,
        district: a.district.trim(),
        cep: a.cep.trim(),
        city: a.city.trim(),
        uf: a.uf.toUpperCase(),
      };
    }

    this.saving.set(true);
    this.formError.set(null);
    clearServerErrors(this.form);

    this.profiles.update(payload).subscribe({
      next: (profile) => {
        this.saving.set(false);
        this.profile.set(profile);
        this.hydrate(profile);
        this.notifications.success('Seus dados foram atualizados.');
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const { formMessage } = this.apiErrors.handleForm(
          err,
          this.form,
          'Não foi possível salvar. Tente novamente.',
        );
        this.formError.set(formMessage);
      },
    });
  }

  protected logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login', { replaceUrl: true });
  }

  private hydrate(profile: DriverProfileData): void {
    const a = profile.address;
    this.form.reset({
      phone: maskPhone(profile.phone),
      address: {
        cep: maskCep(a?.cep ?? ''),
        street: a?.street ?? '',
        number: a?.number ?? '',
        complement: a?.complement ?? '',
        district: a?.district ?? '',
        city: a?.city ?? '',
        uf: a?.uf ?? '',
      },
    });
    this.refreshAddressRequirement();
  }

  /**
   * All-or-nothing, like the company's own address rule: an address with a street but no
   * city is refused by the server, so the form says so before the round trip. With every
   * field empty the address is simply not sent.
   */
  private refreshAddressRequirement(): void {
    const group = this.form.controls.address;
    const started = Object.values(group.getRawValue()).some((v) => String(v).trim() !== '');
    this.addressStarted.set(started);

    for (const key of ['cep', 'street', 'district', 'city', 'uf'] as const) {
      const control = group.controls[key];
      const had = control.hasValidator(Validators.required);
      if (started && !had) control.addValidators(Validators.required);
      if (!started && had) control.removeValidators(Validators.required);
      control.updateValueAndValidity({ emitEvent: false });
    }
  }
}
