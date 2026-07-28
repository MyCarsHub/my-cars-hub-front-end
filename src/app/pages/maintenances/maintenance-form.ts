import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';
import { NotificationService } from '../../services/notification.service';
import { toCents } from '../../components/vehicles/financing-form-fields/financing-utils';
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import {
  CreateMaintenanceRequest,
  MAINTENANCE_STATUS_OPTIONS,
  MAINTENANCE_TYPE_OPTIONS,
  MaintenanceStatus,
  MaintenanceType,
  UpdateMaintenanceRequest,
} from '../../types/maintenance.types';
import { VehicleListItem } from '../../types/vehicle.types';

@Component({
  selector: 'app-maintenance-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DefaultPageLayout, PageCard, AlertBanner, FormField, FieldControl],
  templateUrl: './maintenance-form.html',
})
export class MaintenanceForm implements OnInit {
  private readonly maintenancesService = inject(MaintenancesService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly typeOptions = MAINTENANCE_TYPE_OPTIONS.filter((o) => o.value !== '');
  protected readonly statusOptions = MAINTENANCE_STATUS_OPTIONS.filter((o) => o.value !== '');

  protected readonly editingId = signal<string | null>(null);
  protected readonly isEdit = computed(() => this.editingId() !== null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly vehicles = signal<VehicleListItem[]>([]);

  protected readonly form = this.fb.nonNullable.group({
    vehicleId: ['', [Validators.required]],
    type: ['PREVENTIVE' as MaintenanceType, [Validators.required]],
    description: ['', [Validators.required, Validators.maxLength(300)]],
    serviceDate: ['', [Validators.required]],
    hodometerReading: [null as number | null, [Validators.min(0)]],
    costReais: [0, [Validators.required, Validators.min(0)]],
    provider: ['', [Validators.maxLength(120)]],
    invoiceNumber: ['', [Validators.maxLength(60)]],
    nextServiceDate: [''],
    nextServiceHodometer: [null as number | null, [Validators.min(0)]],
    status: ['SCHEDULED' as MaintenanceStatus, [Validators.required]],
    notes: [''],
  });

  /** Espelha o status escolhido para o template reagir sem lógica inline. */
  protected readonly currentStatus = signal<MaintenanceStatus>('SCHEDULED');

  /**
   * O backend só exige o hodômetro quando a manutenção já foi realizada
   * (`status = DONE`); agendada/em andamento/cancelada aceitam null.
   */
  protected readonly hodometerRequired = computed(() => this.currentStatus() === 'DONE');

  protected readonly hodometerHint = computed(() =>
    this.hodometerRequired()
      ? 'Leitura no momento do serviço.'
      : 'Só é exigido quando o status for “Realizada”. Deixe em branco se ainda não sabe.',
  );

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly vehicleMessages: Readonly<Record<string, string>> = {
    required: 'Selecione um veículo.',
  };
  protected readonly typeMessages: Readonly<Record<string, string>> = {
    required: 'Selecione o tipo de manutenção.',
  };
  protected readonly descriptionMessages: Readonly<Record<string, string>> = {
    required: 'Descreva o serviço.',
  };
  protected readonly serviceDateMessages: Readonly<Record<string, string>> = {
    required: 'Informe a data do serviço.',
  };
  protected readonly statusMessages: Readonly<Record<string, string>> = {
    required: 'Selecione o status da manutenção.',
  };
  protected readonly hodometerMessages: Readonly<Record<string, string>> = {
    required: 'Informe o hodômetro atual para registrar uma manutenção já realizada.',
    min: 'Informe um valor válido (≥ 0).',
  };
  protected readonly costMessages: Readonly<Record<string, string>> = {
    required: 'Informe um valor válido.',
    min: 'Informe um valor válido.',
  };

  /** Leitura vinda do backend na edição — usada para não apagar valor sem intenção. */
  private readonly loadedHodometer = signal<number | null>(null);

  ngOnInit(): void {
    this.form.controls.status.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => this.onStatusChange(status));
    this.applyHodometerValidators(this.form.controls.status.value);

    this.vehiclesService.list({ size: 500, sort: 'plate_asc' }).subscribe({
      next: (res) => this.vehicles.set(res.content ?? []),
      error: () => this.vehicles.set([]),
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editingId.set(id);
      this.load(id);
      this.form.controls.vehicleId.disable();
    }
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.maintenancesService.getOne(id).subscribe({
      next: (m) => {
        this.form.patchValue({
          vehicleId: m.vehicleId,
          type: m.type,
          description: m.description,
          serviceDate: m.serviceDate,
          hodometerReading: m.hodometerReading,
          costReais: m.costCents / 100,
          provider: m.provider ?? '',
          invoiceNumber: m.invoiceNumber ?? '',
          nextServiceDate: m.nextServiceDate ?? '',
          nextServiceHodometer: m.nextServiceHodometer,
          status: m.status,
          notes: m.notes ?? '',
        });
        this.loadedHodometer.set(m.hodometerReading ?? null);
        this.onStatusChange(m.status);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Manutenção não encontrada.'));
        this.loading.set(false);
      },
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
    const costCents = toCents(Number(raw.costReais)) ?? 0;

    if (this.isEdit()) {
      const payload: UpdateMaintenanceRequest = {
        type: raw.type,
        description: raw.description.trim(),
        serviceDate: raw.serviceDate,
        hodometerReading: this.hodometerForUpdate(raw.hodometerReading),
        costCents,
        provider: raw.provider?.trim() || null,
        invoiceNumber: raw.invoiceNumber?.trim() || null,
        nextServiceDate: raw.nextServiceDate || null,
        nextServiceHodometer: raw.nextServiceHodometer ?? null,
        status: raw.status,
        notes: raw.notes?.trim() || null,
      };
      this.maintenancesService.update(this.editingId()!, payload).subscribe({
        next: (m) => this.onSaved(m.id),
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
    } else {
      const payload: CreateMaintenanceRequest = {
        vehicleId: raw.vehicleId,
        type: raw.type,
        description: raw.description.trim(),
        serviceDate: raw.serviceDate,
        hodometerReading: this.normalizeHodometer(raw.hodometerReading),
        costCents,
        provider: raw.provider?.trim() || null,
        invoiceNumber: raw.invoiceNumber?.trim() || null,
        nextServiceDate: raw.nextServiceDate || null,
        nextServiceHodometer: raw.nextServiceHodometer ?? null,
        // Sempre explícito: omitir faria o backend assumir DONE e exigir hodômetro.
        status: raw.status,
        notes: raw.notes?.trim() || null,
      };
      this.maintenancesService.create(payload).subscribe({
        next: (m) => this.onSaved(m.id),
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
    }
  }

  private onStatusChange(status: MaintenanceStatus): void {
    this.currentStatus.set(status);
    this.applyHodometerValidators(status);
  }

  private applyHodometerValidators(status: MaintenanceStatus): void {
    const ctrl = this.form.controls.hodometerReading;
    ctrl.setValidators(
      status === 'DONE'
        ? [Validators.required, Validators.min(0)]
        : [Validators.min(0)],
    );
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  private normalizeHodometer(value: number | null): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * O PUT é replace total: um null enviado por descuido apagaria a leitura já
   * gravada. Só propaga null quando o usuário de fato mexeu no campo.
   */
  private hodometerForUpdate(value: number | null): number | null {
    const normalized = this.normalizeHodometer(value);
    if (normalized !== null) return normalized;
    if (this.form.controls.hodometerReading.pristine) return this.loadedHodometer();
    return null;
  }

  private onSaved(id: string): void {
    this.notifications.success('Manutenção salva.');
    this.router.navigate(['/manutencoes', id]);
  }

  /**
   * Backend `fieldErrors` land inline under the matching control; only the leftover
   * goes to the form banner. Never a toast — `handleForm` claims the error.
   */
  private handleError(err: HttpErrorResponse): void {
    this.saving.set(false);
    const { formMessage } = this.apiErrors.handleForm(
      err,
      this.form,
      'Não foi possível salvar a manutenção.',
    );
    this.error.set(formMessage);
  }

  protected cancel(): void {
    if (this.isEdit()) {
      this.router.navigate(['/manutencoes', this.editingId()]);
    } else {
      this.router.navigate(['/manutencoes']);
    }
  }
}
