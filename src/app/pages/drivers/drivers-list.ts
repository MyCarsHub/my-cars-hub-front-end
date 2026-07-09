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
import { DriverService } from '../../services/driver.service';
import {
  DriverFilters,
  DriverListItem,
  DriverStatus,
  LicenseCategory,
} from '../../types/driver.types';
import {
  DRIVER_STATUS_FILTER_OPTIONS,
  driverStatusMeta,
} from '../../utils/status-maps';

const STATUS_OPTIONS = DRIVER_STATUS_FILTER_OPTIONS;

const CATEGORY_OPTIONS: Array<{ value: LicenseCategory | ''; label: string }> = [
  { value: '', label: 'Todas' },
  { value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' },
  { value: 'D', label: 'D' }, { value: 'E', label: 'E' },
  { value: 'AB', label: 'AB' }, { value: 'AC', label: 'AC' },
  { value: 'AD', label: 'AD' }, { value: 'AE', label: 'AE' },
];

const SORT_OPTIONS = [
  { value: 'name_asc', label: 'Nome (A→Z)' },
  { value: 'name_desc', label: 'Nome (Z→A)' },
  { value: 'license_expiry_asc', label: 'CNH vence antes' },
  { value: 'license_expiry_desc', label: 'CNH vence depois' },
  { value: 'created_desc', label: 'Mais recentes' },
  { value: 'created_asc', label: 'Mais antigos' },
] as const;

@Component({
  selector: 'app-drivers-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DefaultPageLayout, PageCard, ConfirmDialog],
  templateUrl: './drivers-list.html',
})
export class DriversList implements OnInit {
  private readonly driverService = inject(DriverService);
  private readonly router = inject(Router);

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly categoryOptions = CATEGORY_OPTIONS;
  protected readonly sortOptions = SORT_OPTIONS;

  protected readonly items = this.driverService.items;
  protected readonly loading = this.driverService.loading;
  protected readonly error = this.driverService.error;
  protected readonly page = this.driverService.page;
  protected readonly size = this.driverService.size;
  protected readonly total = this.driverService.total;

  protected readonly search = signal('');
  protected readonly statusFilter = signal<DriverStatus | ''>('');
  protected readonly categoryFilter = signal<LicenseCategory | ''>('');
  protected readonly expiryBefore = signal('');
  protected readonly sort = signal<DriverFilters['sort']>('name_asc');
  protected readonly pageSize = signal(20);

  protected readonly deletingDriver = signal<DriverListItem | null>(null);
  protected readonly deleting = signal(false);

  protected readonly togglingStatusDriver = signal<DriverListItem | null>(null);
  protected readonly togglingStatus = signal(false);
  protected readonly actionError = signal<string | null>(null);

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
    this.statusFilter.set('');
    this.categoryFilter.set('');
    this.expiryBefore.set('');
    this.sort.set('name_asc');
    this.reload(0);
  }

  protected prev(): void {
    if (this.page() > 0) this.reload(this.page() - 1);
  }

  protected next(): void {
    if (this.page() + 1 < this.totalPages()) this.reload(this.page() + 1);
  }

  private reload(page: number): void {
    this.driverService.list({
      name: this.search().trim() || undefined,
      status: this.statusFilter() || undefined,
      licenseCategory: this.categoryFilter() || undefined,
      licenseExpiryBefore: this.expiryBefore() || undefined,
      sort: this.sort(),
      page,
      size: this.pageSize(),
    }).subscribe({ error: () => {} });
  }

  protected statusLabel(status: DriverStatus): string {
    return driverStatusMeta(status).label;
  }

  protected statusChip(status: DriverStatus): string {
    return driverStatusMeta(status).chip;
  }

  protected formatPhone(phone: string | null): string {
    const d = (phone ?? '').replace(/\D/g, '');
    if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return phone ?? '—';
  }

  protected formatDate(iso: string): string {
    return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
  }

  protected isExpiringSoon(iso: string): boolean {
    const expiry = new Date(iso + 'T00:00:00').getTime();
    const now = Date.now();
    const days = (expiry - now) / (1000 * 60 * 60 * 24);
    return days < 30;
  }

  protected openDetail(driver: DriverListItem): void {
    this.router.navigate(['/motoristas', driver.id]);
  }

  protected askDelete(driver: DriverListItem, event?: Event): void {
    event?.stopPropagation();
    this.deletingDriver.set(driver);
  }

  protected cancelDelete(): void {
    if (this.deleting()) return;
    this.deletingDriver.set(null);
  }

  protected confirmDelete(): void {
    const driver = this.deletingDriver();
    if (!driver) return;
    this.actionError.set(null);
    this.deleting.set(true);
    this.driverService.remove(driver.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deletingDriver.set(null);
        this.reload(this.page());
      },
      error: (err) => {
        this.deleting.set(false);
        this.deletingDriver.set(null);
        this.actionError.set(this.readError(err, 'Não foi possível excluir o motorista.'));
      },
    });
  }

  protected canDelete(driver: DriverListItem): boolean {
    return driver.status !== 'WORKING';
  }

  protected canToggleStatus(driver: DriverListItem): boolean {
    return driver.status !== 'WORKING';
  }

  protected toggleStatusLabel(driver: DriverListItem): string {
    return driver.status === 'SUSPENDED' ? 'Reativar' : 'Suspender';
  }

  protected toggleStatusTooltip(driver: DriverListItem): string | null {
    if (driver.status === 'WORKING') {
      return 'Motorista em serviço não pode ter o status alterado manualmente. Encerre o aluguel primeiro.';
    }
    return null;
  }

  protected deleteTooltip(driver: DriverListItem): string | null {
    if (driver.status === 'WORKING') {
      return 'Motorista em serviço não pode ser excluído. Encerre o aluguel primeiro.';
    }
    return null;
  }

  protected askToggleStatus(driver: DriverListItem, event?: Event): void {
    event?.stopPropagation();
    if (!this.canToggleStatus(driver)) return;
    this.togglingStatusDriver.set(driver);
  }

  protected cancelToggleStatus(): void {
    if (this.togglingStatus()) return;
    this.togglingStatusDriver.set(null);
  }

  protected confirmToggleStatus(): void {
    const driver = this.togglingStatusDriver();
    if (!driver) return;
    const next: DriverStatus = driver.status === 'SUSPENDED' ? 'AVAILABLE' : 'SUSPENDED';
    this.actionError.set(null);
    this.togglingStatus.set(true);
    this.driverService.changeStatus(driver.id, next).subscribe({
      next: () => {
        this.togglingStatus.set(false);
        this.togglingStatusDriver.set(null);
      },
      error: (err) => {
        this.togglingStatus.set(false);
        this.togglingStatusDriver.set(null);
        this.actionError.set(
          this.readError(err, 'Não foi possível alterar o status do motorista.'),
        );
      },
    });
  }

  protected toggleConfirmMessage(): string {
    const driver = this.togglingStatusDriver();
    if (!driver) return '';
    if (driver.status === 'SUSPENDED') {
      return `Reativar «${driver.name}»? O motorista voltará a ficar disponível para novos aluguéis.`;
    }
    return `Suspender «${driver.name}»? O motorista ficará bloqueado para novos aluguéis até ser reativado.`;
  }

  private readError(err: unknown, fallback: string): string {
    const body = (err as { error?: { message?: string } })?.error;
    if (body && typeof body.message === 'string' && body.message.length > 0) {
      return body.message;
    }
    return fallback;
  }
}
