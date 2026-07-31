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
import { Observable } from 'rxjs';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import { ActionsMenu } from '../../components/core/actions-menu/actions-menu';
import {
  ConcludeMaintenanceDialog,
  isInputRejection,
} from './components/conclude-maintenance-dialog/conclude-maintenance-dialog';
import {
  MAINTENANCE_SORT_OPTIONS,
  MAINTENANCE_STATUS_OPTIONS,
  MAINTENANCE_TYPE_OPTIONS,
  Maintenance,
  MaintenanceListItem,
  MaintenanceStatus,
  MaintenanceType,
} from '../../types/maintenance.types';
import { VehicleListItem } from '../../types/vehicle.types';

/** Transições de status disponíveis numa linha (backend: `/conclude`, `/cancel`). */
type MaintenanceTransition = 'conclude' | 'cancel';

/** Status a partir dos quais o backend aceita concluir/cancelar. */
const TRANSITIONABLE: readonly MaintenanceStatus[] = ['SCHEDULED', 'IN_PROGRESS'];

@Component({
  selector: 'app-maintenances-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    ConcludeMaintenanceDialog,
    ActionsMenu,
    AlertBanner,
  ],
  templateUrl: './maintenances-list.html',
})
export class MaintenancesList implements OnInit {
  private readonly maintenancesService = inject(MaintenancesService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  /**
   * When provided, the list is locked to a single vehicle: the vehicle dropdown is hidden.
   * Used by the vehicle Gerência drill-down pages.
   */
  readonly vehicleIdPrefilter = input<string | undefined>(undefined);

  protected readonly typeOptions = MAINTENANCE_TYPE_OPTIONS;
  protected readonly statusOptions = MAINTENANCE_STATUS_OPTIONS;
  protected readonly sortOptions = MAINTENANCE_SORT_OPTIONS;

  protected readonly items = this.maintenancesService.items;
  protected readonly loading = this.maintenancesService.loading;
  protected readonly error = this.maintenancesService.error;
  protected readonly page = this.maintenancesService.page;
  protected readonly size = this.maintenancesService.size;
  protected readonly total = this.maintenancesService.total;

  protected readonly vehicles = signal<VehicleListItem[]>([]);
  protected readonly vehiclesById = computed(() => {
    const map = new Map<string, VehicleListItem>();
    for (const v of this.vehicles()) map.set(v.id, v);
    return map;
  });

  protected readonly vehicleFilter = signal<string>('');
  protected readonly typeFilter = signal<MaintenanceType | ''>('');
  protected readonly statusFilter = signal<MaintenanceStatus | ''>('');
  protected readonly sort = signal<string>('service_date_desc');
  protected readonly pageSize = signal(20);

  protected readonly deleting = signal<MaintenanceListItem | null>(null);
  protected readonly deletingBusy = signal(false);
  /** Failure of a row action (delete / concluir / cancelar). Banner, right above the list. */
  protected readonly actionError = signal<string | null>(null);

  /** Transição de status pendente de confirmação (kebab → diálogo). */
  protected readonly pendingAction = signal<MaintenanceTransition | null>(null);
  protected readonly pendingItem = signal<MaintenanceListItem | null>(null);
  protected readonly actionBusy = signal(false);
  /**
   * Hodômetro do veículo da linha pendente. `VehicleListItem` não traz a leitura,
   * então ela é buscada ao abrir o diálogo e chega depois da abertura.
   */
  protected readonly pendingVehicleHodometer = signal<number | null>(null);
  /** A busca do hodômetro do veículo falhou: o campo abre vazio e sem sugestão. */
  protected readonly pendingVehicleFailed = signal(false);
  /**
   * Recusa da leitura pelo backend (400/422). Fica DENTRO do diálogo, que
   * permanece aberto com o valor digitado para o usuário corrigir e repetir.
   */
  protected readonly concludeError = signal<string | null>(null);

  protected readonly concludeOpen = computed(() => this.pendingAction() === 'conclude');
  protected readonly cancelOpen = computed(() => this.pendingAction() === 'cancel');

  /** Leitura sugerida: a real do veículo quando disponível, senão a já gravada. */
  protected readonly concludeDefault = computed(
    () => this.pendingVehicleHodometer() ?? this.pendingItem()?.hodometerReading ?? null,
  );

  protected readonly pendingLabel = computed(() => {
    const m = this.pendingItem();
    if (!m) return '';
    return `${this.vehiclePlate(m.vehicleId)} · ${m.description}`;
  });

  protected readonly totalPages = computed(() => {
    const t = this.total();
    const s = this.size();
    return t === 0 ? 1 : Math.ceil(t / s);
  });

  protected readonly pageNumber = computed(() => this.page() + 1);

  ngOnInit(): void {
    const prefilter = this.vehicleIdPrefilter();
    if (prefilter) {
      this.vehicleFilter.set(prefilter);
    }
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
    this.statusFilter.set('');
    this.sort.set('service_date_desc');
    this.reload(0);
  }

  protected prev(): void {
    if (this.page() > 0) this.reload(this.page() - 1);
  }

  protected next(): void {
    if (this.page() + 1 < this.totalPages()) this.reload(this.page() + 1);
  }

  private reload(page: number): void {
    this.maintenancesService
      .list({
        vehicleId: this.vehicleFilter() || undefined,
        type: this.typeFilter() || undefined,
        status: this.statusFilter() || undefined,
        sort: this.sort(),
        page,
        size: this.pageSize(),
      })
      // `MaintenancesService` already writes the failure into its `error` signal, which
      // the template renders as a banner — claim it so the safety net doesn't toast it.
      .subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
  }

  protected typeInfo(t: MaintenanceType): { label: string; chip: string } {
    const o = MAINTENANCE_TYPE_OPTIONS.find((x) => x.value === t);
    return o ? { label: o.label, chip: o.chip } : { label: t, chip: 'bg-neutral-100' };
  }

  protected statusInfo(s: MaintenanceStatus): { label: string; chip: string } {
    const o = MAINTENANCE_STATUS_OPTIONS.find((x) => x.value === s);
    return o ? { label: o.label, chip: o.chip } : { label: s, chip: 'bg-neutral-100' };
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

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('pt-BR');
  }

  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  }

  /**
   * Returns a soft "Próxima em Nd" chip when `nextServiceDate` is within 30 days.
   * Returns "Vencida" when already in the past.
   */
  protected nextServiceBadge(iso: string | null): { label: string; chip: string } | null {
    if (!iso) return null;
    const next = new Date(iso + 'T00:00:00').getTime();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = Math.round((next - today) / 86400000);
    if (days < 0) return { label: 'Vencida', chip: 'bg-rose-100 text-rose-700' };
    if (days <= 30) return { label: `Próxima em ${days}d`, chip: 'bg-amber-100 text-amber-800' };
    return null;
  }

  protected openDetail(m: MaintenanceListItem): void {
    this.router.navigate(['/manutencoes', m.id]);
  }

  /**
   * Concluir/cancelar só existem para `SCHEDULED` / `IN_PROGRESS`. A maioria dos
   * registros antigos já nasce `DONE`, então o par some na maior parte das linhas.
   */
  protected canTransition(m: MaintenanceListItem): boolean {
    return TRANSITIONABLE.includes(m.status);
  }

  /**
   * Sem `$event`: o próprio {@link ActionsMenu} já barra a propagação para a
   * linha (host `(click)`). Chamar `stopPropagation()` aqui impedia o clique de
   * chegar ao painel do menu, que então NÃO fechava e ficava por cima do
   * diálogo (painel `z-[60]` × diálogo `z-50`).
   */
  protected askConclude(m: MaintenanceListItem): void {
    this.pendingItem.set(m);
    this.pendingVehicleHodometer.set(null);
    this.pendingVehicleFailed.set(false);
    this.concludeError.set(null);
    this.pendingAction.set('conclude');
    // O diálogo abre imediatamente com a leitura gravada e adota a do veículo
    // quando ela chega (enquanto o campo não foi editado).
    this.vehiclesService.getOne(m.vehicleId).subscribe({
      next: (v) => {
        if (this.pendingItem()?.id === m.id) this.pendingVehicleHodometer.set(v.hodometer ?? null);
      },
      // Sem a leitura do veículo o campo fica vazio: troca a dica genérica por
      // uma que diz explicitamente ao usuário para digitar a leitura atual.
      error: (err: unknown) => {
        this.apiErrors.claim(err);
        if (this.pendingItem()?.id === m.id) this.pendingVehicleFailed.set(true);
      },
    });
  }

  protected askCancel(m: MaintenanceListItem): void {
    this.pendingItem.set(m);
    this.pendingAction.set('cancel');
  }

  protected closeActionDialog(): void {
    if (this.actionBusy()) return;
    this.pendingAction.set(null);
    this.pendingItem.set(null);
    this.pendingVehicleHodometer.set(null);
    this.pendingVehicleFailed.set(false);
    this.concludeError.set(null);
  }

  protected confirmConclude(hodometerReading: number): void {
    const m = this.pendingItem();
    if (!m || this.actionBusy()) return;
    this.concludeError.set(null);
    this.runTransition(
      this.maintenancesService.conclude(m.id, { hodometerReading }),
      'Manutenção concluída.',
      'Não foi possível concluir a manutenção.',
      // 400/422 = leitura recusada pelo backend; corrigível no próprio campo.
      (message) => this.concludeError.set(message),
    );
  }

  protected confirmCancel(): void {
    const m = this.pendingItem();
    if (!m || this.actionBusy()) return;
    this.runTransition(
      this.maintenancesService.cancel(m.id),
      'Manutenção cancelada.',
      'Não foi possível cancelar a manutenção.',
    );
  }

  /**
   * @param onFieldError Quando informado e o backend recusar a ENTRADA (400/422),
   * o diálogo permanece aberto com o valor digitado e a mensagem é renderizada
   * dentro dele. Os demais erros (409 de status, 404, 5xx) fecham e vão para o
   * banner — não há o que corrigir no campo.
   */
  private runTransition(
    request: Observable<Maintenance>,
    successMessage: string,
    fallbackError: string,
    onFieldError?: (message: string) => void,
  ): void {
    this.actionError.set(null);
    this.actionBusy.set(true);
    const done = (): void => {
      this.actionBusy.set(false);
      this.pendingAction.set(null);
      this.pendingItem.set(null);
      this.pendingVehicleHodometer.set(null);
      this.pendingVehicleFailed.set(false);
    };
    request.subscribe({
      next: () => {
        done();
        this.concludeError.set(null);
        this.notifications.success(successMessage);
        this.reload(this.page());
      },
      error: (err: unknown) => {
        const message = this.apiErrors.messageFor(err, fallbackError);
        if (onFieldError && isInputRejection(err)) {
          this.actionBusy.set(false);
          onFieldError(message);
          return;
        }
        done();
        this.actionError.set(message);
      },
    });
  }

  protected askDelete(m: MaintenanceListItem, event?: Event): void {
    event?.stopPropagation();
    this.deleting.set(m);
  }

  protected cancelDelete(): void {
    if (this.deletingBusy()) return;
    this.deleting.set(null);
  }

  protected confirmDelete(): void {
    const m = this.deleting();
    if (!m) return;
    this.actionError.set(null);
    this.deletingBusy.set(true);
    this.maintenancesService.remove(m.id).subscribe({
      next: () => {
        this.deletingBusy.set(false);
        this.deleting.set(null);
        this.notifications.success('Manutenção removida.');
        this.reload(this.page());
      },
      // Business failures (409 / 404) get the inline banner above the list — there is
      // no single field to anchor them to and the confirm dialog closes on error.
      error: (err: unknown) => {
        this.deletingBusy.set(false);
        this.deleting.set(null);
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível excluir a manutenção.'),
        );
      },
    });
  }
}
