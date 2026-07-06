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
import { FinesService } from '../../services/fines.service';
import { VehiclesService } from '../../services/vehicles.service';
import {
  FINE_SEVERITY_OPTIONS,
  FINE_SORT_OPTIONS,
  FINE_STATUS_OPTIONS,
  FineListItem,
  FineSeverity,
  FineStatus,
} from '../../types/fine.types';
import { VehicleListItem } from '../../types/vehicle.types';

@Component({
  selector: 'app-fines-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DefaultPageLayout, PageCard, ConfirmDialog],
  templateUrl: './fines-list.html',
})
export class FinesList implements OnInit {
  private readonly finesService = inject(FinesService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly router = inject(Router);

  /**
   * When provided, the list is locked to a single vehicle: the vehicle filter dropdown
   * is hidden, filters are prefilled and the fleet-wide "Todos" option is disabled.
   * Used by the vehicle Gerência drill-down pages.
   */
  readonly vehicleIdPrefilter = input<string | undefined>(undefined);

  protected readonly statusOptions = FINE_STATUS_OPTIONS;
  protected readonly severityOptions = FINE_SEVERITY_OPTIONS;
  protected readonly sortOptions = FINE_SORT_OPTIONS;

  protected readonly items = this.finesService.items;
  protected readonly loading = this.finesService.loading;
  protected readonly error = this.finesService.error;
  protected readonly page = this.finesService.page;
  protected readonly size = this.finesService.size;
  protected readonly total = this.finesService.total;

  protected readonly vehicles = signal<VehicleListItem[]>([]);
  protected readonly vehiclesById = computed(() => {
    const map = new Map<string, VehicleListItem>();
    for (const v of this.vehicles()) map.set(v.id, v);
    return map;
  });

  protected readonly vehicleFilter = signal<string>('');
  protected readonly statusFilter = signal<FineStatus | ''>('');
  protected readonly severityFilter = signal<FineSeverity | ''>('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly sort = signal<string>('infraction_date_desc');
  protected readonly pageSize = signal(20);

  protected readonly deleting = signal<FineListItem | null>(null);
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
    // Preload vehicles for denormalization + filter dropdown.
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
    // Preserve the locked vehicle when the list is scoped to a single vehicle.
    this.vehicleFilter.set(this.vehicleIdPrefilter() ?? '');
    this.statusFilter.set('');
    this.severityFilter.set('');
    this.from.set('');
    this.to.set('');
    this.sort.set('infraction_date_desc');
    this.reload(0);
  }

  protected prev(): void {
    if (this.page() > 0) this.reload(this.page() - 1);
  }

  protected next(): void {
    if (this.page() + 1 < this.totalPages()) this.reload(this.page() + 1);
  }

  private reload(page: number): void {
    this.finesService
      .list({
        vehicleId: this.vehicleFilter() || undefined,
        status: this.statusFilter() || undefined,
        severity: this.severityFilter() || undefined,
        from: this.from() || undefined,
        to: this.to() || undefined,
        sort: this.sort(),
        page,
        size: this.pageSize(),
      })
      .subscribe({ error: () => {} });
  }

  protected statusInfo(status: FineStatus): { label: string; chip: string } {
    const o = FINE_STATUS_OPTIONS.find((x) => x.value === status);
    return o ? { label: o.label, chip: o.chip } : { label: status, chip: 'bg-neutral-100' };
  }

  protected severityInfo(sev: FineSeverity): { label: string; chip: string } {
    const o = FINE_SEVERITY_OPTIONS.find((x) => x.value === sev);
    return o ? { label: o.label, chip: o.chip } : { label: sev, chip: 'bg-neutral-100' };
  }

  protected vehicleLabel(vehicleId: string): string {
    const v = this.vehiclesById().get(vehicleId);
    if (!v) return '—';
    return `${this.formatPlate(v.plate)} · ${v.brand} ${v.model}`;
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

  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  }

  protected overdue(fine: FineListItem): boolean {
    if (fine.status !== 'PENDING' || !fine.dueDate) return false;
    const due = new Date(fine.dueDate + 'T00:00:00').getTime();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return due < today;
  }

  protected openDetail(fine: FineListItem): void {
    this.router.navigate(['/multas', fine.id]);
  }

  protected askDelete(fine: FineListItem, event?: Event): void {
    event?.stopPropagation();
    this.deleting.set(fine);
  }

  protected cancelDelete(): void {
    if (this.deletingBusy()) return;
    this.deleting.set(null);
  }

  protected confirmDelete(): void {
    const f = this.deleting();
    if (!f) return;
    this.deletingBusy.set(true);
    this.finesService.remove(f.id).subscribe({
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
