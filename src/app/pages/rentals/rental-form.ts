import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { toCents } from '../../components/vehicles/financing-form-fields/financing-utils';
import { RentalService } from './rental.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { BillingAccessService } from '../../services/billing-access.service';
import { AsaasIntegrationService } from '../company-settings/integrations/asaas-integration.service';
import {
  BILLING_FREQUENCY_OPTIONS,
  CreateRentalRequest,
  RentalBillingFrequency,
  RentalUpdateRequest,
} from '../../types/rental.types';
import { VehicleListItem } from '../../types/vehicle.types';
import { DriverListItem } from '../../types/driver.types';

@Component({
  selector: 'app-rental-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, DefaultPageLayout, PageCard],
  templateUrl: './rental-form.html',
})
export class RentalForm implements OnInit {
  private readonly rentalService = inject(RentalService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly billingAccess = inject(BillingAccessService);
  private readonly asaasService = inject(AsaasIntegrationService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly editingId = signal<string | null>(null);
  protected readonly editingStatus = signal<string | null>(null);
  protected readonly isEdit = computed(() => this.editingId() !== null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly vehicles = signal<VehicleListItem[]>([]);
  protected readonly drivers = signal<DriverListItem[]>([]);

  protected readonly billingFrequencyOptions = BILLING_FREQUENCY_OPTIONS;

  // TRIAL gate — read from cached BillingAccessService; the app-shell already
  // primed the cache after login, so this is synchronous in practice.
  protected readonly isTrial = computed(
    () => this.billingAccess.status()?.plan?.code === 'TRIAL',
  );

  // Asaas integration status; loaded on init so we can warn the user if they
  // enable automaticCharge without a connected Asaas account.
  protected readonly asaasStatus = this.asaasService.status;
  protected readonly asaasConnected = computed(
    () => this.asaasStatus()?.connected === true,
  );

  protected readonly form = this.fb.nonNullable.group(
    {
      vehicleId: ['', [Validators.required]],
      driverId: ['', [Validators.required]],
      startDate: ['', [Validators.required]],
      endDate: ['', [Validators.required]],
      // Order in the UI: frequency comes BEFORE the rate so the rate label can
      // reflect the chosen period ("Valor da diária" / "semanal" / "mensal").
      billingFrequency: ['DAILY' as RentalBillingFrequency, [Validators.required]],
      dailyRateReais: [0, [Validators.required, Validators.min(0.01)]],
      caucaoReais: [0, [Validators.min(0)]],
      automaticCharge: [false],
      notes: [''],
    },
    { validators: endAfterStartValidator },
  );

  /**
   * Reactive derived state fed by form.valueChanges.
   * `toSignal` gives us OnPush-friendly re-renders whenever inputs change,
   * without the manual `subscribe` + `set` boilerplate.
   */
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly totalDays = computed(() => {
    const v = this.formValue();
    if (!v?.startDate || !v?.endDate) return 0;
    const s = new Date(v.startDate + 'T00:00:00').getTime();
    const e = new Date(v.endDate + 'T00:00:00').getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
    const diff = Math.round((e - s) / 86_400_000);
    return diff > 0 ? diff : 1;
  });

  protected readonly billingFrequency = computed<RentalBillingFrequency>(
    () => (this.formValue()?.billingFrequency ?? 'DAILY') as RentalBillingFrequency,
  );

  /**
   * Dynamic label for the rate input — switches based on the chosen frequency.
   * The form control name stays `dailyRateReais` (and is posted as `dailyRate`)
   * so the backend contract is unchanged.
   */
  protected readonly rateLabel = computed(() => {
    switch (this.billingFrequency()) {
      case 'WEEKLY':
        return 'Valor semanal (R$)';
      case 'MONTHLY':
        return 'Valor mensal (R$)';
      default:
        return 'Valor da diária (R$)';
    }
  });

  protected readonly billingUnits = computed(() => {
    const days = this.totalDays();
    if (!days) return 0;
    switch (this.billingFrequency()) {
      case 'WEEKLY':
        return Math.ceil(days / 7);
      case 'MONTHLY':
        return Math.ceil(days / 30);
      default:
        return days;
    }
  });

  protected readonly totalAmountCents = computed(() => {
    const v = this.formValue();
    const days = this.totalDays();
    if (!days) return null;
    const cents = toCents(Number(v?.dailyRateReais ?? 0));
    if (cents == null) return null;
    switch (this.billingFrequency()) {
      case 'WEEKLY':
        return cents * Math.ceil(days / 7);
      case 'MONTHLY':
        return cents * Math.ceil(days / 30);
      default:
        return cents * days;
    }
  });

  protected readonly totalAmountLabel = computed(() => {
    const t = this.totalAmountCents();
    if (t == null) return '--';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(t / 100);
  });

  protected readonly totalPreviewCaption = computed(() => {
    const units = this.billingUnits();
    const freq = this.billingFrequency();
    const unitLabel =
      BILLING_FREQUENCY_OPTIONS.find((o) => o.value === freq)?.perUnitLabel ?? 'diária';
    return `${units} × ${unitLabel}`;
  });

  protected readonly automaticChargeOn = computed(
    () => this.formValue()?.automaticCharge === true,
  );

  ngOnInit(): void {
    this.vehiclesService.list({ size: 500, sort: 'plate_asc' }).subscribe({
      next: (res) => this.vehicles.set(res.content ?? []),
      error: () => this.vehicles.set([]),
    });
    this.driverService.list({ size: 500, sort: 'name_asc' }).subscribe({
      next: (res) =>
        this.drivers.set((res.content ?? []).filter((d) => d.status !== 'SUSPENDED')),
      error: () => this.drivers.set([]),
    });

    // Prime billing access (cached — no-op if already loaded elsewhere).
    this.billingAccess.load().subscribe();

    // Load Asaas integration status so we can show a warning when the user
    // toggles automatic charge without a connected integration.
    this.asaasService.load().subscribe({ error: () => {} });

    // Disable the toggle up-front when we already know the plan is TRIAL.
    // A microtask-level effect could handle late arrivals; for now, patch on
    // load and the template also reads isTrial() to reinforce.
    if (this.isTrial()) {
      this.form.controls.automaticCharge.disable();
    }

    // Edit mode: pre-fill from backend rental.
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editingId.set(id);
      this.rentalService.getById(id).subscribe({
        next: (r) => {
          this.form.patchValue({
            vehicleId: r.vehicleId,
            driverId: r.driverId,
            startDate: r.startDate,
            endDate: r.endDate,
            dailyRateReais: r.dailyRate / 100,
            billingFrequency: r.billingFrequency ?? 'DAILY',
            caucaoReais: r.caucaoAmount / 100,
            automaticCharge: r.automaticCharge ?? false,
            notes: r.notes ?? '',
          });
          // Post-load: rentals in COMPLETED/CANCELED are immutable server-side;
          // ACTIVE forbids swapping vehicle/driver. We restrict UI accordingly
          // instead of disabling the whole form (which used to make PUT unusable).
          this.editingStatus.set(r.status);
          if (r.status === 'COMPLETED' || r.status === 'CANCELED') {
            this.form.disable();
          } else if (r.status === 'ACTIVE') {
            this.form.controls.vehicleId.disable();
            this.form.controls.driverId.disable();
            this.form.controls.automaticCharge.disable();
          } else {
            // RESERVED — automaticCharge is not editable (it drives Asaas side-effects)
            this.form.controls.automaticCharge.disable();
          }
        },
        error: (err: HttpErrorResponse) =>
          this.error.set(this.extractError(err, 'Aluguel não encontrado.')),
      });
    }
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Verifique os campos destacados.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const raw = this.form.getRawValue();
    const dailyRate = toCents(Number(raw.dailyRateReais)) ?? 0;
    const caucao = toCents(Number(raw.caucaoReais ?? 0)) ?? 0;

    const editingId = this.editingId();
    if (editingId) {
      const updatePayload: RentalUpdateRequest = {
        vehicleId: raw.vehicleId,
        driverId: raw.driverId,
        startDate: raw.startDate,
        endDate: raw.endDate,
        dailyRate,
        billingFrequency: raw.billingFrequency,
        caucaoAmount: caucao,
        notes: raw.notes?.trim() || undefined,
      };
      this.rentalService.update(editingId, updatePayload).subscribe({
        next: (r) => this.router.navigate(['/alugueis', r.id]),
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(this.extractError(err, 'Não foi possível salvar as alterações.'));
        },
      });
      return;
    }

    const payload: CreateRentalRequest = {
      vehicleId: raw.vehicleId,
      driverId: raw.driverId,
      startDate: raw.startDate,
      endDate: raw.endDate,
      dailyRate,
      billingFrequency: raw.billingFrequency,
      caucaoAmount: caucao,
      automaticCharge: raw.automaticCharge === true,
      notes: raw.notes?.trim() || undefined,
    };

    this.rentalService.create(payload).subscribe({
      next: (r) => this.router.navigate(['/alugueis', r.id]),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(this.extractError(err, 'Não foi possível criar o aluguel.'));
      },
    });
  }

  protected cancel(): void {
    if (this.isEdit()) {
      this.router.navigate(['/alugueis', this.editingId()]);
    } else {
      this.router.navigate(['/alugueis']);
    }
  }

  protected fieldInvalid(name: string): boolean {
    const ctrl: AbstractControl | null = this.form.get(name);
    return !!ctrl && ctrl.invalid && ctrl.touched;
  }

  protected formHasEndBeforeStart(): boolean {
    return !!this.form.errors?.['endBeforeStart'] && this.form.touched;
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }

  protected formatPlate(plate: string): string {
    const p = (plate ?? '').toUpperCase();
    if (p.length === 7) return `${p.slice(0, 3)}-${p.slice(3)}`;
    return p || '—';
  }
}

function endAfterStartValidator(group: AbstractControl): ValidationErrors | null {
  const start = group.get('startDate')?.value as string;
  const end = group.get('endDate')?.value as string;
  if (!start || !end) return null;
  if (end < start) return { endBeforeStart: true };
  return null;
}
