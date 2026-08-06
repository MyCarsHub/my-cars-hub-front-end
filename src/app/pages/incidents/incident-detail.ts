import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { DetailActions } from '../../components/core/detail-actions/detail-actions';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import {
  VehicleSummary,
  VehicleSummaryChip,
} from '../../components/vehicles/vehicle-summary-chip/vehicle-summary-chip';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { VehicleIncidentsService } from '../../services/vehicle-incidents.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { formatBRL } from '../../types/dashboard.types';
import { IncidentDocumentsCard } from './incident-documents-card';
import { IncidentStatusCard } from './incident-status-card';
import {
  INCIDENT_FAULT_PARTY_META,
  VehicleIncident,
} from '../../types/vehicle-incident.types';

/**
 * Ficha completa de um sinistro — a ÚNICA tela que mostra os dados do terceiro
 * envolvido, porque é a única leitura deliberada de um sinistro específico (o
 * backend os mantém fora da listagem por decisão de LGPD; não os reintroduza).
 *
 * O avanço das duas máquinas de estado vive em `IncidentStatusCard`, que é quem
 * conhece as transições válidas e os campos que cada uma exige.
 */
@Component({
  selector: 'app-incident-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    DetailActions,
    AlertBanner,
    VehicleSummaryChip,
    IncidentStatusCard,
    IncidentDocumentsCard,
  ],
  templateUrl: './incident-detail.html',
})
export class IncidentDetail implements OnInit {
  private readonly incidentsService = inject(VehicleIncidentsService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly incident = signal<VehicleIncident | null>(null);
  protected readonly vehicle = signal<VehicleSummary | null>(null);
  protected readonly driverName = signal<string | null>(null);
  protected readonly loading = signal(false);
  /** Falha de carga — substitui o corpo da página. */
  protected readonly error = signal<string | null>(null);
  /** Falha de uma ação tomada aqui (exclusão). */
  protected readonly actionError = signal<string | null>(null);

  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);

  protected readonly faultPartyLabel = computed(() => {
    const party = this.incident()?.atFaultParty;
    return party ? INCIDENT_FAULT_PARTY_META[party] : '—';
  });

  /** `true` quando há qualquer dado de terceiro — o bloco só existe se houver. */
  protected readonly hasThirdParty = computed(() => {
    const i = this.incident();
    if (!i) return false;
    return Boolean(i.thirdPartyName || i.thirdPartyDocument || i.thirdPartyPhone || i.thirdPartyPlate);
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.incidentsService.getOne(id).subscribe({
      next: (incident) => {
        this.incident.set(incident);
        this.loading.set(false);
        this.loadVehicle(incident.vehicleId);
        if (incident.driverId) this.loadDriver(incident.driverId);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Sinistro não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  private loadVehicle(id: string): void {
    this.vehiclesService.getOne(id).subscribe({
      next: (v) =>
        this.vehicle.set({
          id: v.id,
          plate: v.plate,
          brand: v.brand,
          model: v.model,
          type: v.type,
          hodometer: v.hodometer,
          licensingExpiration: v.licensingExpiration,
        }),
      error: () => this.vehicle.set(null),
    });
  }

  private loadDriver(id: string): void {
    this.driverService.getOne(id).subscribe({
      next: (d) => this.driverName.set(d.name),
      error: () => this.driverName.set(null),
    });
  }

  /**
   * O card de status já devolve o sinistro inteiro — tanto depois de uma
   * transição quanto depois da recarga que segue um conflito de trava otimista.
   * Nada de um GET a mais aqui.
   */
  protected onStatusChanged(updated: VehicleIncident): void {
    this.incident.set(updated);
  }

  protected askDelete(): void {
    this.deleteOpen.set(true);
  }

  protected cancelDelete(): void {
    if (this.deleting()) return;
    this.deleteOpen.set(false);
  }

  protected confirmDelete(): void {
    const incident = this.incident();
    if (!incident) return;
    this.actionError.set(null);
    this.deleting.set(true);
    this.incidentsService.remove(incident.id).subscribe({
      next: () => {
        this.notifications.success('Sinistro removido.');
        this.router.navigate(['/sinistros']);
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível excluir.'));
      },
    });
  }

  protected formatDateTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Valores trafegam em CENTAVOS — sempre pelo utilitário do projeto. */
  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return formatBRL(cents);
  }
}
