import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
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
import { VehicleIncidentsService } from '../../services/vehicle-incidents.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { toCents } from '../../components/vehicles/insurance-form-fields/insurance-utils';
import { VehicleListItem } from '../../types/vehicle.types';
import { DriverListItem } from '../../types/driver.types';
import {
  CreateVehicleIncidentRequest,
  INCIDENT_FAULT_PARTY_OPTIONS,
  INCIDENT_TYPE_OPTIONS,
  IncidentFaultParty,
  IncidentType,
  UpdateVehicleIncidentRequest,
} from '../../types/vehicle-incident.types';

/**
 * Registro e correção de um sinistro.
 *
 * O que NÃO existe aqui, e não pode passar a existir: campo de status. Um
 * sinistro nasce OPEN / NOT_FILED e só se move pelos dois endpoints de
 * transição, que validam a máquina de estados — o backend recusa status no POST
 * e no PUT justamente para não haver esse atalho. Quem move estado é
 * `IncidentStatusCard`, na tela de detalhe.
 *
 * Também fora do modo edição: o veículo. Sinistro pertence ao carro em que
 * aconteceu; "mudar de veículo" é registro errado, que se apaga e refaz.
 *
 * DADO PESSOAL: os campos do terceiro envolvido são coletados aqui e só
 * aparecem no detalhe. Nunca os leve para uma tela de lista.
 */
@Component({
  selector: 'app-incident-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DefaultPageLayout, PageCard, AlertBanner, FormField, FieldControl],
  templateUrl: './incident-form.html',
})
export class IncidentForm implements OnInit {
  private readonly incidentsService = inject(VehicleIncidentsService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly typeOptions = INCIDENT_TYPE_OPTIONS;
  protected readonly faultPartyOptions = INCIDENT_FAULT_PARTY_OPTIONS;

  protected readonly editingId = signal<string | null>(null);
  protected readonly isEdit = computed(() => this.editingId() !== null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly vehicles = signal<VehicleListItem[]>([]);
  protected readonly drivers = signal<DriverListItem[]>([]);

  /**
   * Teto do seletor de data/hora. O backend recusa sinistro no futuro
   * (`@PastOrPresent`); calculado aqui porque o template não tem `new Date()`.
   * Fixado na entrada da tela — não precisa acompanhar o relógio.
   */
  protected readonly maxOccurredAt = nowAsInputDateTime();

  protected readonly vehicleMessages: Readonly<Record<string, string>> = {
    required: 'Selecione o veículo do sinistro.',
  };
  protected readonly typeMessages: Readonly<Record<string, string>> = {
    required: 'Selecione o tipo do sinistro.',
  };
  protected readonly occurredAtMessages: Readonly<Record<string, string>> = {
    required: 'Informe quando o sinistro aconteceu.',
  };
  protected readonly descriptionMessages: Readonly<Record<string, string>> = {
    required: 'Descreva o que aconteceu.',
    maxlength: 'A descrição deve ter no máximo 1000 caracteres.',
  };

  protected readonly form = this.fb.nonNullable.group({
    vehicleId: ['', [Validators.required]],
    driverId: [''],
    incidentType: ['COLLISION' as IncidentType, [Validators.required]],
    occurredAt: ['', [Validators.required]],
    location: ['', [Validators.maxLength(200)]],
    description: ['', [Validators.required, Validators.maxLength(1000)]],
    atFaultParty: ['UNKNOWN' as IncidentFaultParty],
    estimatedCostReais: [null as number | null, [Validators.min(0)]],
    deductibleReais: [null as number | null, [Validators.min(0)]],
    thirdPartyName: ['', [Validators.maxLength(150)]],
    thirdPartyDocument: ['', [Validators.maxLength(30)]],
    thirdPartyPhone: ['', [Validators.maxLength(30)]],
    thirdPartyPlate: ['', [Validators.maxLength(10)]],
    notes: [''],
    /** Opt-in explícito. O backend nunca mexe num veículo RENTED. */
    takeVehicleOutOfService: [false],
  });

  ngOnInit(): void {
    this.vehiclesService.list({ size: 500, sort: 'plate_asc' }).subscribe({
      next: (res) => this.vehicles.set(res.content ?? []),
      error: () => this.vehicles.set([]),
    });
    this.driverService.list({ size: 500, sort: 'name_asc' }).subscribe({
      next: (res) => this.drivers.set(res.content ?? []),
      error: () => this.drivers.set([]),
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editingId.set(id);
      this.load(id);
      // Veículo é imutável depois do registro — o backend nem lê o campo no PUT.
      this.form.controls.vehicleId.disable();
    }
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.incidentsService.getOne(id).subscribe({
      next: (incident) => {
        this.form.patchValue({
          vehicleId: incident.vehicleId,
          driverId: incident.driverId ?? '',
          incidentType: incident.incidentType,
          occurredAt: isoToInputDateTime(incident.occurredAt),
          location: incident.location ?? '',
          description: incident.description,
          atFaultParty: incident.atFaultParty,
          estimatedCostReais: centsToReaisInput(incident.estimatedCostCents),
          deductibleReais: centsToReaisInput(incident.deductibleCents),
          thirdPartyName: incident.thirdPartyName ?? '',
          thirdPartyDocument: incident.thirdPartyDocument ?? '',
          thirdPartyPhone: incident.thirdPartyPhone ?? '',
          thirdPartyPlate: incident.thirdPartyPlate ?? '',
          notes: incident.notes ?? '',
        });
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Sinistro não encontrado.'));
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

    const shared = {
      driverId: raw.driverId || null,
      incidentType: raw.incidentType,
      occurredAt: inputDateTimeToIso(raw.occurredAt),
      location: raw.location?.trim() || null,
      description: raw.description.trim(),
      atFaultParty: raw.atFaultParty,
      estimatedCostCents: toCents(raw.estimatedCostReais),
      deductibleCents: toCents(raw.deductibleReais),
      thirdPartyName: raw.thirdPartyName?.trim() || null,
      thirdPartyDocument: raw.thirdPartyDocument?.trim() || null,
      thirdPartyPhone: raw.thirdPartyPhone?.trim() || null,
      thirdPartyPlate: raw.thirdPartyPlate?.trim().toUpperCase() || null,
      notes: raw.notes?.trim() || null,
    };

    if (this.isEdit()) {
      const payload: UpdateVehicleIncidentRequest = shared;
      this.incidentsService.update(this.editingId()!, payload).subscribe({
        next: (incident) => this.onSaved(incident.id, 'Sinistro atualizado.'),
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
      return;
    }

    const payload: CreateVehicleIncidentRequest = {
      ...shared,
      vehicleId: raw.vehicleId,
      takeVehicleOutOfService: raw.takeVehicleOutOfService,
    };
    this.incidentsService.create(payload).subscribe({
      next: (incident) => {
        // O backend só para o veículo se ele estava AVAILABLE; quando o pedido
        // não pôde ser atendido o usuário precisa saber, ou vai supor que o
        // carro saiu de circulação e ele continua alugável.
        if (raw.takeVehicleOutOfService && incident.vehicleTakenOutOfService === false) {
          this.notifications.warning(
            'Sinistro registrado, mas o veículo NÃO foi parado: ele não estava disponível ' +
              '(alugado ou já em manutenção). Ajuste o status do veículo manualmente.',
          );
        }
        this.onSaved(incident.id, 'Sinistro registrado.');
      },
      error: (err: HttpErrorResponse) => this.handleError(err),
    });
  }

  private onSaved(id: string, message: string): void {
    this.notifications.success(message);
    this.router.navigate(['/sinistros', id]);
  }

  /**
   * `fieldErrors` do backend caem inline sob o controle correspondente; só o
   * que sobra vai para o banner do formulário. Nunca um toast — `handleForm`
   * reivindica o erro.
   */
  private handleError(err: HttpErrorResponse): void {
    this.saving.set(false);
    const { formMessage } = this.apiErrors.handleForm(
      err,
      this.form,
      'Não foi possível salvar o sinistro.',
    );
    this.error.set(formMessage);
  }

  protected cancel(): void {
    if (this.isEdit()) {
      this.router.navigate(['/sinistros', this.editingId()]);
    } else {
      this.router.navigate(['/sinistros']);
    }
  }
}

/** Backend `LocalDateTime` (yyyy-MM-ddTHH:mm:ss[.SSS]) → valor de `datetime-local`. */
function isoToInputDateTime(iso: string): string {
  if (!iso) return '';
  return iso.length >= 16 ? iso.slice(0, 16) : iso;
}

/** `datetime-local` devolve yyyy-MM-ddTHH:mm → o backend espera os segundos. */
function inputDateTimeToIso(value: string): string {
  if (!value) return '';
  return value.length === 16 ? `${value}:00` : value;
}

function centsToReaisInput(cents: number | null | undefined): number | null {
  return cents == null ? null : cents / 100;
}

/** Agora, no fuso LOCAL, no formato de `datetime-local` (evita o shift de `toISOString`). */
function nowAsInputDateTime(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
