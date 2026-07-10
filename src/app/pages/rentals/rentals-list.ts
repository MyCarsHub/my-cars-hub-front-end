import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { NotificationService } from '../../services/notification.service';
import { RentalService } from './rental.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import {
  RENTAL_STATUS_OPTIONS,
  RentalBillingFrequency,
  RentalListItemDto,
  RentalStatus,
  billingFrequencyLabel,
  rentalStatusInfo,
} from '../../types/rental.types';
import { VehicleListItem } from '../../types/vehicle.types';
import { DriverListItem } from '../../types/driver.types';

type PendingAction = 'activate' | 'cancel' | 'complete' | 'delete';

@Component({
  selector: 'app-rentals-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DefaultPageLayout, PageCard, ConfirmDialog],
  templateUrl: './rentals-list.html',
})
export class RentalsList implements OnInit {
  private readonly rentalService = inject(RentalService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Debounce handle for desktop auto-search. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly statusOptions = RENTAL_STATUS_OPTIONS;

  protected readonly items = this.rentalService.items;
  protected readonly loading = this.rentalService.loading;
  protected readonly error = this.rentalService.error;
  protected readonly page = this.rentalService.page;
  protected readonly size = this.rentalService.size;
  protected readonly total = this.rentalService.total;

  protected readonly vehicles = signal<VehicleListItem[]>([]);
  protected readonly drivers = signal<DriverListItem[]>([]);

  protected readonly vehiclesById = computed(() => {
    const map = new Map<string, VehicleListItem>();
    for (const v of this.vehicles()) map.set(v.id, v);
    return map;
  });

  protected readonly driversById = computed(() => {
    const map = new Map<string, DriverListItem>();
    for (const d of this.drivers()) map.set(d.id, d);
    return map;
  });

  protected readonly statusFilter = signal<RentalStatus | ''>('');
  protected readonly vehicleFilter = signal<string>('');
  protected readonly driverFilter = signal<string>('');
  protected readonly fromFilter = signal<string>('');
  protected readonly toFilter = signal<string>('');
  protected readonly pageSize = signal(20);

  /** Draft signals — bound to inputs inside the filters sheet on mobile.
   *  Only committed to the "active" filter signals on Apply, so the mobile
   *  user can tweak values without triggering reloads on every keystroke. */
  protected readonly draftStatus = signal<RentalStatus | ''>('');
  protected readonly draftVehicle = signal<string>('');
  protected readonly draftDriver = signal<string>('');
  protected readonly draftFrom = signal<string>('');
  protected readonly draftTo = signal<string>('');

  /** Whether the mobile filters sheet is open. */
  protected readonly filtersOpen = signal(false);

  /** Count of active non-empty filters (excluding status chips, which are
   *  always visible above). Drives the "Filtros" button badge. */
  protected readonly activeFilterCount = computed(() => {
    let n = 0;
    if (this.vehicleFilter()) n++;
    if (this.driverFilter()) n++;
    if (this.fromFilter() || this.toFilter()) n++;
    return n;
  });

  // Per-row open dropdown (mobile 3-dot menu). Only one open at a time.
  protected readonly openMenuId = signal<string | null>(null);

  // Confirm dialog + pending action state.
  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly pendingRental = signal<RentalListItemDto | null>(null);
  protected readonly actionBusy = signal(false);

  protected readonly totalPages = computed(() => {
    const t = this.total();
    const s = this.size();
    return t === 0 ? 1 : Math.ceil(t / s);
  });

  protected readonly pageNumber = computed(() => this.page() + 1);

  protected readonly dialogOpen = computed(() => this.pendingAction() !== null);

  protected readonly dialogTitle = computed(() => {
    switch (this.pendingAction()) {
      case 'activate':
        return 'Iniciar aluguel';
      case 'cancel':
        return 'Cancelar aluguel';
      case 'complete':
        return 'Finalizar aluguel';
      case 'delete':
        return 'Excluir aluguel';
      default:
        return '';
    }
  });

  protected readonly dialogMessage = computed(() => {
    switch (this.pendingAction()) {
      case 'activate':
        return 'Deseja marcar este aluguel como ativo agora?';
      case 'cancel':
        return 'Tem certeza que deseja cancelar este aluguel? As cobranças pendentes serão canceladas.';
      case 'complete':
        return 'Marcar aluguel como concluído? Isso dispara o reembolso da caução, quando houver.';
      case 'delete':
        return 'Tem certeza que deseja excluir este aluguel? Esta ação não pode ser desfeita.';
      default:
        return '';
    }
  });

  protected readonly dialogVariant = computed<'info' | 'warning' | 'danger'>(() => {
    switch (this.pendingAction()) {
      case 'delete':
      case 'cancel':
        return 'danger';
      case 'complete':
        return 'warning';
      default:
        return 'info';
    }
  });

  protected readonly dialogConfirmLabel = computed(() => {
    switch (this.pendingAction()) {
      case 'activate':
        return 'Iniciar';
      case 'cancel':
        return 'Cancelar aluguel';
      case 'complete':
        return 'Finalizar';
      case 'delete':
        return 'Excluir';
      default:
        return 'Confirmar';
    }
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
    // Hydrate filters from URL so shared links restore state.
    const qp = this.route.snapshot.queryParamMap;
    const status = (qp.get('status') as RentalStatus | null) ?? '';
    this.statusFilter.set(status);
    this.vehicleFilter.set(qp.get('vehicleId') ?? '');
    this.driverFilter.set(qp.get('driverId') ?? '');
    this.fromFilter.set(qp.get('from') ?? '');
    this.toFilter.set(qp.get('to') ?? '');
    this.syncDraftFromActive();
    this.reload(0);
  }

  protected setStatus(status: RentalStatus | ''): void {
    this.statusFilter.set(status);
    this.syncUrl();
    this.reload(0);
  }

  // -------------------------------------------------------- filter handling

  protected openFilters(): void {
    this.syncDraftFromActive();
    this.filtersOpen.set(true);
  }

  protected closeFilters(): void {
    this.filtersOpen.set(false);
  }

  protected clearFilters(): void {
    // Clears draft state — user still has to press Apply to commit.
    this.draftStatus.set('');
    this.draftVehicle.set('');
    this.draftDriver.set('');
    this.draftFrom.set('');
    this.draftTo.set('');
  }

  protected applyFilters(): void {
    this.statusFilter.set(this.draftStatus());
    this.vehicleFilter.set(this.draftVehicle());
    this.driverFilter.set(this.draftDriver());
    this.fromFilter.set(this.draftFrom());
    this.toFilter.set(this.draftTo());
    this.filtersOpen.set(false);
    this.syncUrl();
    this.reload(0);
  }

  /**
   * Desktop inline change — writes straight to the active signals (skipping
   * the draft indirection) and debounces the reload so the user isn't hit
   * with a flood of requests while typing dates or switching selects.
   */
  protected onDesktopFilterChange(field: 'vehicle' | 'driver' | 'from' | 'to',
                                  value: string): void {
    switch (field) {
      case 'vehicle': this.vehicleFilter.set(value); break;
      case 'driver': this.driverFilter.set(value); break;
      case 'from': this.fromFilter.set(value); break;
      case 'to': this.toFilter.set(value); break;
    }
    this.syncUrl();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.reload(0), 300);
  }

  private syncDraftFromActive(): void {
    this.draftStatus.set(this.statusFilter());
    this.draftVehicle.set(this.vehicleFilter());
    this.draftDriver.set(this.driverFilter());
    this.draftFrom.set(this.fromFilter());
    this.draftTo.set(this.toFilter());
  }

  private syncUrl(): void {
    const queryParams = {
      status: this.statusFilter() || null,
      vehicleId: this.vehicleFilter() || null,
      driverId: this.driverFilter() || null,
      from: this.fromFilter() || null,
      to: this.toFilter() || null,
    };
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected prev(): void {
    if (this.page() > 0) this.reload(this.page() - 1);
  }

  protected next(): void {
    if (this.page() + 1 < this.totalPages()) this.reload(this.page() + 1);
  }

  private reload(page: number): void {
    this.rentalService
      .list({
        status: this.statusFilter() || undefined,
        vehicleId: this.vehicleFilter() || undefined,
        driverId: this.driverFilter() || undefined,
        from: this.fromFilter() || undefined,
        to: this.toFilter() || undefined,
        page,
        size: this.pageSize(),
      })
      .subscribe({ error: () => {} });
  }

  protected statusInfo(status: RentalStatus): { label: string; chip: string } {
    return rentalStatusInfo(status);
  }

  protected billingFrequencyLabel(f: RentalBillingFrequency | undefined | null): string {
    return f ? billingFrequencyLabel(f) : '—';
  }

  protected vehiclePlate(vehicleId: string): string {
    const v = this.vehiclesById().get(vehicleId);
    if (!v) return '—';
    return this.formatPlate(v.plate);
  }

  protected vehicleModel(vehicleId: string): string {
    const v = this.vehiclesById().get(vehicleId);
    return v ? `${v.brand} ${v.model}` : '';
  }

  protected driverName(driverId: string): string {
    const d = this.driversById().get(driverId);
    return d?.name ?? '—';
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

  protected daysBetween(startIso: string, endIso: string): number {
    if (!startIso || !endIso) return 0;
    const s = new Date(startIso + 'T00:00:00').getTime();
    const e = new Date(endIso + 'T00:00:00').getTime();
    const diff = Math.round((e - s) / 86_400_000);
    return diff > 0 ? diff : 1;
  }

  protected openDetail(r: RentalListItemDto): void {
    this.router.navigate(['/alugueis', r.id]);
  }

  protected isActive(filter: RentalStatus | ''): boolean {
    return this.statusFilter() === filter;
  }

  // ---------------------------------------------------------------- actions

  protected canEdit(r: RentalListItemDto): boolean {
    return r.status === 'RESERVED' || r.status === 'ACTIVE';
  }

  protected canDelete(r: RentalListItemDto): boolean {
    return r.status === 'RESERVED' || r.status === 'CANCELED';
  }

  protected canCancel(r: RentalListItemDto): boolean {
    return r.status === 'RESERVED';
  }

  protected canComplete(r: RentalListItemDto): boolean {
    return r.status === 'ACTIVE';
  }

  /**
   * Manual activation only for rentals created without automatic Asaas charge.
   * Aligns with backend `RentalService.activate` guard (isAutomaticCharge ⇒ 409).
   */
  protected canActivate(r: RentalListItemDto): boolean {
    return r.status === 'RESERVED' && r.automaticCharge === false;
  }

  /**
   * True when the rental is waiting for Asaas payment confirmation to be
   * activated by webhook (no manual "Iniciar" button should be shown).
   */
  protected isAwaitingPayment(r: RentalListItemDto): boolean {
    return r.status === 'RESERVED' && r.automaticCharge === true;
  }

  protected toggleMenu(id: string, ev: Event): void {
    ev.stopPropagation();
    this.openMenuId.update((cur) => (cur === id ? null : id));
  }

  protected closeMenu(): void {
    this.openMenuId.set(null);
  }

  protected askAction(action: PendingAction, r: RentalListItemDto, ev: Event): void {
    ev.stopPropagation();
    this.closeMenu();
    this.pendingAction.set(action);
    this.pendingRental.set(r);
  }

  protected cancelDialog(): void {
    if (this.actionBusy()) return;
    this.pendingAction.set(null);
    this.pendingRental.set(null);
  }

  protected confirmDialog(): void {
    const action = this.pendingAction();
    const r = this.pendingRental();
    if (!action || !r || this.actionBusy()) return;
    this.actionBusy.set(true);

    const onSuccess = (successMsg: string): void => {
      this.actionBusy.set(false);
      this.pendingAction.set(null);
      this.pendingRental.set(null);
      this.notifications.push('success', successMsg);
      this.reload(this.page());
    };
    const onError = (err: HttpErrorResponse, fallback: string): void => {
      this.actionBusy.set(false);
      this.pendingAction.set(null);
      this.pendingRental.set(null);
      const body = err.error;
      const msg =
        body && typeof body === 'object' && typeof body.message === 'string'
          ? body.message
          : fallback;
      this.notifications.push('error', msg);
    };

    switch (action) {
      case 'activate':
        this.rentalService.activate(r.id).subscribe({
          next: () => onSuccess('Aluguel iniciado.'),
          error: (err) => onError(err, 'Não foi possível iniciar o aluguel.'),
        });
        break;
      case 'cancel':
        this.rentalService.cancel(r.id).subscribe({
          next: () => onSuccess('Aluguel cancelado.'),
          error: (err) => onError(err, 'Não foi possível cancelar o aluguel.'),
        });
        break;
      case 'complete':
        this.rentalService.complete(r.id).subscribe({
          next: () => onSuccess('Aluguel finalizado.'),
          error: (err) => onError(err, 'Não foi possível finalizar o aluguel.'),
        });
        break;
      case 'delete':
        this.rentalService.remove(r.id).subscribe({
          next: () => onSuccess('Aluguel excluído.'),
          error: (err) => onError(err, 'Não foi possível excluir o aluguel.'),
        });
        break;
    }
  }
}
