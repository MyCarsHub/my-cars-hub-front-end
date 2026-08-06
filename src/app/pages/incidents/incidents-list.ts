import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../components/core/actions-menu/actions-menu';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { VehicleIncidentsService } from '../../services/vehicle-incidents.service';
import { VehiclesService } from '../../services/vehicles.service';
import { formatBRL } from '../../types/dashboard.types';
import { VehicleListItem } from '../../types/vehicle.types';
import {
  INCIDENT_INSURANCE_FILTER_OPTIONS,
  INCIDENT_INSURANCE_META,
  INCIDENT_RESOLUTION_FILTER_OPTIONS,
  INCIDENT_RESOLUTION_META,
  INCIDENT_SORT_OPTIONS,
  INCIDENT_TYPE_FILTER_OPTIONS,
  INSURANCE_DIMENSION_LABEL,
  IncidentInsuranceStatus,
  IncidentResolutionStatus,
  IncidentStatusMeta,
  IncidentType,
  RESOLUTION_DIMENSION_LABEL,
  VehicleIncidentListItem,
} from '../../types/vehicle-incident.types';

/**
 * Visão consolidada de sinistros cross-veículos: a lista filtrável É a tela.
 *
 * O cartão "Resumo" foi retirado por decisão do dono do produto, e com ele a
 * chamada a `GET /vehicle-incidents/summary` — que sem nada para renderizar
 * seria só uma requisição a mais no celular. Não reintroduza uma sem a outra.
 *
 * DADO PESSOAL: a linha da listagem NÃO traz os dados do terceiro envolvido
 * (nome, documento, telefone, placa). O backend os mantém fora do
 * `VehicleIncidentListItemDto` de propósito e esta tela não pode reintroduzi-los
 * — nem buscando o detalhe por baixo para "enriquecer" a lista.
 *
 * Cada linha mostra AS DUAS situações com o prefixo da dimensão ("Veículo:" /
 * "Seguro:") porque elas avançam independentemente: sem o prefixo, "Resolvido"
 * e "Indenizado" viram dois rótulos verdes indistinguíveis.
 */
@Component({
  selector: 'app-incidents-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    ActionsMenu,
    AlertBanner,
  ],
  templateUrl: './incidents-list.html',
})
export class IncidentsList implements OnInit {
  private readonly incidentsService = inject(VehicleIncidentsService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  /** Trava a lista num veículo só (drill-down a partir do detalhe do veículo). */
  readonly vehicleIdPrefilter = input<string | undefined>(undefined);

  protected readonly typeOptions = INCIDENT_TYPE_FILTER_OPTIONS;
  protected readonly resolutionOptions = INCIDENT_RESOLUTION_FILTER_OPTIONS;
  protected readonly insuranceOptions = INCIDENT_INSURANCE_FILTER_OPTIONS;
  protected readonly sortOptions = INCIDENT_SORT_OPTIONS;

  protected readonly resolutionDimensionLabel = RESOLUTION_DIMENSION_LABEL;
  protected readonly insuranceDimensionLabel = INSURANCE_DIMENSION_LABEL;

  protected readonly items = this.incidentsService.items;
  protected readonly loading = this.incidentsService.loading;
  protected readonly error = this.incidentsService.error;
  protected readonly page = this.incidentsService.page;
  protected readonly size = this.incidentsService.size;
  protected readonly total = this.incidentsService.total;

  protected readonly vehicles = signal<VehicleListItem[]>([]);
  protected readonly vehiclesById = computed(() => {
    const map = new Map<string, VehicleListItem>();
    for (const v of this.vehicles()) map.set(v.id, v);
    return map;
  });

  protected readonly vehicleFilter = signal<string>('');
  protected readonly typeFilter = signal<IncidentType | ''>('');
  protected readonly resolutionFilter = signal<IncidentResolutionStatus | 'ACTIVE' | ''>('');
  protected readonly insuranceFilter = signal<IncidentInsuranceStatus | ''>('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly sort = signal<string>('occurred_desc');
  protected readonly pageSize = signal(20);

  protected readonly deleting = signal<VehicleIncidentListItem | null>(null);
  protected readonly deletingBusy = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected readonly totalPages = computed(() => {
    const t = this.total();
    const s = this.size();
    return t === 0 ? 1 : Math.ceil(t / s);
  });

  protected readonly pageNumber = computed(() => this.page() + 1);

  ngOnInit(): void {
    const prefilter = this.vehicleIdPrefilter();
    if (prefilter) this.vehicleFilter.set(prefilter);

    this.vehiclesService.list({ size: 500, sort: 'plate_asc' }).subscribe({
      next: (res) => this.vehicles.set(res.content ?? []),
      error: () => this.vehicles.set([]),
    });

    this.reload(0);
  }

  protected onFilterChange(): void {
    this.reload(0);
  }

  protected clearFilters(): void {
    this.vehicleFilter.set(this.vehicleIdPrefilter() ?? '');
    this.typeFilter.set('');
    this.resolutionFilter.set('');
    this.insuranceFilter.set('');
    this.from.set('');
    this.to.set('');
    this.sort.set('occurred_desc');
    this.reload(0);
  }

  protected prev(): void {
    if (this.page() > 0) this.reload(this.page() - 1);
  }

  protected next(): void {
    if (this.page() + 1 < this.totalPages()) this.reload(this.page() + 1);
  }

  private reload(page: number): void {
    this.incidentsService
      .list({
        vehicleId: this.vehicleFilter() || undefined,
        incidentType: this.typeFilter() || undefined,
        resolutionStatus: this.resolutionFilter() || undefined,
        insuranceStatus: this.insuranceFilter() || undefined,
        from: this.from() || undefined,
        to: this.to() || undefined,
        sort: this.sort(),
        page,
        size: this.pageSize(),
      })
      // O service já escreve a falha no seu signal `error`, que o template
      // renderiza como banner — reivindique para a rede de segurança não
      // disparar um toast em cima.
      .subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
  }

  protected resolutionMeta(status: IncidentResolutionStatus): IncidentStatusMeta {
    return INCIDENT_RESOLUTION_META[status];
  }

  protected insuranceMeta(status: IncidentInsuranceStatus): IncidentStatusMeta {
    return INCIDENT_INSURANCE_META[status];
  }

  protected vehiclePlate(vehicleId: string): string {
    const v = this.vehiclesById().get(vehicleId);
    return v ? this.formatPlate(v.plate) : '—';
  }

  protected vehicleModel(vehicleId: string): string {
    const v = this.vehiclesById().get(vehicleId);
    return v ? `${v.brand} ${v.model}` : '';
  }

  protected formatPlate(plate: string): string {
    const p = (plate ?? '').toUpperCase();
    if (p.length === 7) return `${p.slice(0, 3)}-${p.slice(3)}`;
    return p || '—';
  }

  protected formatDateTime(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Valores trafegam em CENTAVOS — formate sempre pelo utilitário do projeto. */
  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return formatBRL(cents);
  }

  protected openDetail(incident: VehicleIncidentListItem): void {
    this.router.navigate(['/sinistros', incident.id]);
  }

  protected askDelete(incident: VehicleIncidentListItem, event?: Event): void {
    event?.stopPropagation();
    this.deleting.set(incident);
  }

  protected cancelDelete(): void {
    if (this.deletingBusy()) return;
    this.deleting.set(null);
  }

  protected confirmDelete(): void {
    const incident = this.deleting();
    if (!incident) return;
    this.actionError.set(null);
    this.deletingBusy.set(true);
    this.incidentsService.remove(incident.id).subscribe({
      next: () => {
        this.deletingBusy.set(false);
        this.deleting.set(null);
        this.notifications.success('Sinistro removido.');
        this.reload(this.page());
      },
      error: (err: unknown) => {
        this.deletingBusy.set(false);
        this.deleting.set(null);
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível excluir o sinistro.'),
        );
      },
    });
  }
}
