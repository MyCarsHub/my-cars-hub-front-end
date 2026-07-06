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
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import {
  MAINTENANCE_SORT_OPTIONS,
  MAINTENANCE_STATUS_OPTIONS,
  MAINTENANCE_TYPE_OPTIONS,
  MaintenanceListItem,
  MaintenanceStatus,
  MaintenanceType,
} from '../../types/maintenance.types';
import { VehicleListItem } from '../../types/vehicle.types';

@Component({
  selector: 'app-maintenances-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DefaultPageLayout, PageCard, ConfirmDialog],
  templateUrl: './maintenances-list.html',
})
export class MaintenancesList implements OnInit {
  private readonly maintenancesService = inject(MaintenancesService);
  private readonly vehiclesService = inject(VehiclesService);
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
      .subscribe({ error: () => {} });
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
    this.deletingBusy.set(true);
    this.maintenancesService.remove(m.id).subscribe({
      next: () => {
        this.deletingBusy.set(false);
        this.deleting.set(null);
        this.reload(this.page());
      },
      error: () => {
        this.deletingBusy.set(false);
        this.deleting.set(null);
      },
    });
  }
}
