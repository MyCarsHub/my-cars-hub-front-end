import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import {
  VEHICLE_SORT_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  VehicleFilters,
  VehicleListItem,
  VehicleStatus,
  VehicleType,
} from '../../types/vehicle.types';
import {
  VEHICLE_STATUS_FILTER_OPTIONS,
  licensingBadge,
  vehicleStatusMeta,
} from '../../utils/status-maps';

const TYPE_OPTIONS: Array<{ value: VehicleType | ''; label: string }> = [
  { value: '', label: 'Todos' },
  ...VEHICLE_TYPE_OPTIONS.map((o) => ({ value: o.value as VehicleType, label: o.label })),
];

@Component({
  selector: 'app-vehicles-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DefaultPageLayout, PageCard, ConfirmDialog],
  templateUrl: './vehicles-list.html',
})
export class VehiclesList implements OnInit {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly statusOptions = VEHICLE_STATUS_FILTER_OPTIONS;
  protected readonly sortOptions = VEHICLE_SORT_OPTIONS;

  protected readonly items = this.vehiclesService.items;
  protected readonly loading = this.vehiclesService.loading;
  protected readonly error = this.vehiclesService.error;
  protected readonly page = this.vehiclesService.page;
  protected readonly size = this.vehiclesService.size;
  protected readonly total = this.vehiclesService.total;

  protected readonly search = signal('');
  protected readonly typeFilter = signal<VehicleType | ''>('');
  protected readonly statusFilter = signal<VehicleStatus | ''>('');
  protected readonly sort = signal<VehicleFilters['sort']>('plate_asc');
  protected readonly pageSize = signal(20);

  protected readonly deletingVehicle = signal<VehicleListItem | null>(null);
  protected readonly deleting = signal(false);
  protected readonly openMenuId = signal<string | null>(null);
  protected readonly transitioningId = signal<string | null>(null);

  protected readonly totalPages = computed(() => {
    const t = this.total();
    const s = this.size();
    return t === 0 ? 1 : Math.ceil(t / s);
  });

  protected readonly pageNumber = computed(() => this.page() + 1);

  ngOnInit(): void {
    this.reload(0);
  }

  protected onSearchSubmit(): void {
    this.reload(0);
  }

  protected onFilterChange(): void {
    this.reload(0);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.typeFilter.set('');
    this.statusFilter.set('');
    this.sort.set('plate_asc');
    this.reload(0);
  }

  protected prev(): void {
    if (this.page() > 0) this.reload(this.page() - 1);
  }

  protected next(): void {
    if (this.page() + 1 < this.totalPages()) this.reload(this.page() + 1);
  }

  private reload(page: number): void {
    this.vehiclesService
      .list({
        q: this.search().trim() || undefined,
        type: this.typeFilter() || undefined,
        status: this.statusFilter() || undefined,
        sort: this.sort(),
        page,
        size: this.pageSize(),
      })
      .subscribe({ error: () => {} });
  }

  protected statusLabel(status: VehicleStatus): string {
    return vehicleStatusMeta(status).label;
  }

  protected statusChip(status: VehicleStatus): string {
    return vehicleStatusMeta(status).chip;
  }

  protected typeLabel(type: VehicleType): string {
    return VEHICLE_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
  }

  protected typeChip(type: VehicleType): string {
    return type === 'CAR'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-amber-100 text-amber-800';
  }

  protected formatPlate(plate: string): string {
    const p = (plate ?? '').toUpperCase();
    if (p.length === 7) return `${p.slice(0, 3)}-${p.slice(3)}`;
    return p || '—';
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
  }

  protected licensingDaysLeft(iso: string | null): number | null {
    if (!iso) return null;
    const expiry = new Date(iso + 'T00:00:00').getTime();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((expiry - startOfToday) / 86400000);
  }

  protected showIpvaOverdue(v: VehicleListItem): boolean {
    if (v.ipvaStatus === 'PAID') return false;
    return v.ipvaStatus === 'OVERDUE' || v.ipvaExpired === true;
  }

  protected licensingBadge(iso: string | null): { label: string; chip: string } | null {
    if (!iso) return null;
    const badge = licensingBadge(iso);
    // list only surfaces alertful states (overdue / near-due). "Em dia" is
    // covered by the plain date column, no chip needed.
    if (badge.label === 'Vencido' || badge.label.startsWith('Vence em')) {
      return badge;
    }
    return null;
  }

  protected openDetail(vehicle: VehicleListItem): void {
    this.router.navigate(['/veiculos', vehicle.id]);
  }

  protected askDelete(vehicle: VehicleListItem, event?: Event): void {
    event?.stopPropagation();
    this.deletingVehicle.set(vehicle);
  }

  protected cancelDelete(): void {
    if (this.deleting()) return;
    this.deletingVehicle.set(null);
  }

  protected confirmDelete(): void {
    const vehicle = this.deletingVehicle();
    if (!vehicle) return;
    this.deleting.set(true);
    this.vehiclesService.remove(vehicle.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deletingVehicle.set(null);
        this.notify.success(`Veículo «${this.formatPlate(vehicle.plate)}» excluído.`);
        this.reload(this.page());
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deletingVehicle.set(null);
        this.notify.error(this.extractError(err, 'Não foi possível excluir o veículo.'));
      },
    });
  }

  /**
   * Delete is disabled when the vehicle is currently RENTED — backend also
   * blocks it (409), but the tooltip surfaces the reason without a round-trip.
   */
  protected deleteDisabledReason(vehicle: VehicleListItem): string | null {
    if (vehicle.status === 'RENTED') {
      return 'Veículo está alugado. Finalize o aluguel para excluir.';
    }
    return null;
  }

  protected toggleMenu(id: string, event?: Event): void {
    event?.stopPropagation();
    this.openMenuId.update((cur) => (cur === id ? null : id));
  }

  protected closeMenu(): void {
    this.openMenuId.set(null);
  }

  protected canGoMaintenance(vehicle: VehicleListItem): boolean {
    return vehicle.status === 'AVAILABLE' || vehicle.status === 'INACTIVE';
  }

  protected canGoAvailable(vehicle: VehicleListItem): boolean {
    return vehicle.status === 'MAINTENANCE' || vehicle.status === 'INACTIVE';
  }

  protected canGoInactive(vehicle: VehicleListItem): boolean {
    return vehicle.status === 'AVAILABLE' || vehicle.status === 'MAINTENANCE';
  }

  protected transitionStatus(
    vehicle: VehicleListItem,
    target: 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE',
    event?: Event,
  ): void {
    event?.stopPropagation();
    this.closeMenu();
    if (this.transitioningId() === vehicle.id) return;
    this.transitioningId.set(vehicle.id);
    this.vehiclesService.updateStatus(vehicle.id, target).subscribe({
      next: (v) => {
        this.transitioningId.set(null);
        this.notify.success(
          `Status do veículo «${this.formatPlate(vehicle.plate)}» atualizado para ${this.statusLabel(v.status)}.`,
        );
      },
      error: (err: HttpErrorResponse) => {
        this.transitioningId.set(null);
        this.notify.error(this.extractError(err, 'Não foi possível alterar o status.'));
      },
    });
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
