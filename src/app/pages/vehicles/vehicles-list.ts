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
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { VehiclesService } from '../../services/vehicles.service';
import {
  VEHICLE_SORT_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  VehicleFilters,
  VehicleListItem,
  VehicleType,
} from '../../types/vehicle.types';

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

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly sortOptions = VEHICLE_SORT_OPTIONS;

  protected readonly items = this.vehiclesService.items;
  protected readonly loading = this.vehiclesService.loading;
  protected readonly error = this.vehiclesService.error;
  protected readonly page = this.vehiclesService.page;
  protected readonly size = this.vehiclesService.size;
  protected readonly total = this.vehiclesService.total;

  protected readonly search = signal('');
  protected readonly typeFilter = signal<VehicleType | ''>('');
  protected readonly sort = signal<VehicleFilters['sort']>('plate_asc');
  protected readonly pageSize = signal(20);

  protected readonly deletingVehicle = signal<VehicleListItem | null>(null);
  protected readonly deleting = signal(false);

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
        sort: this.sort(),
        page,
        size: this.pageSize(),
      })
      .subscribe({ error: () => {} });
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

  protected licensingBadge(iso: string | null): { label: string; chip: string } | null {
    const days = this.licensingDaysLeft(iso);
    if (days === null) return null;
    if (days < 0) return { label: 'Vencido', chip: 'bg-rose-100 text-rose-700' };
    if (days <= 30) return { label: `Vence em ${days}d`, chip: 'bg-amber-100 text-amber-800' };
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
        this.reload(this.page());
      },
      error: () => {
        this.deleting.set(false);
        this.deletingVehicle.set(null);
      },
    });
  }
}
