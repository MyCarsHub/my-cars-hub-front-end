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
import { RouterLink } from '@angular/router';

import { ActionsMenu } from '../../components/core/actions-menu/actions-menu';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { PaintedCard } from '../../components/core/painted-card/painted-card';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import {
  FilterChipGroup,
  FilterChipOption,
} from '../../components/filter-chip-group/filter-chip-group';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../services/api-error.service';
import { ExpensesService } from '../../services/expenses.service';
import { NotificationService } from '../../services/notification.service';
import { VehiclesService } from '../../services/vehicles.service';
import { Expense, ExpenseCategoryKey } from '../../types/expense.types';
import { formatBRL } from '../../types/dashboard.types';
import { VehicleListItem } from '../../types/vehicle.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import { formatPlate, formatVehicleLabel } from '../../utils/display-format';
import {
  categoryCounts,
  filterExpenses,
  monthName,
  monthTitle,
  shiftMonth,
  summarize,
} from '../../utils/expenses-view';

const PAGE_SIZE = 20;

/**
 * Gastos (FEAT-0425): despesas da locadora, mês a mês. O mês inteiro é carregado de uma vez
 * (o back-end pagina em 100) para que o total, a maior categoria e a parte "da locadora toda"
 * sejam verdade; busca, categoria e veículo filtram essa lista na tela.
 */
@Component({
  selector: 'app-expenses-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    DefaultPageLayout,
    PaintedCard,
    FilterChipGroup,
    ActionsMenu,
    ConfirmDialog,
    AlertBanner,
  ],
  templateUrl: './expenses-list.html',
})
export class ExpensesList implements OnInit {
  private readonly expensesService = inject(ExpensesService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  private readonly currentMonth = todayInBusinessTz().slice(0, 7);

  protected readonly month = signal(this.currentMonth);
  protected readonly items = signal<Expense[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly vehicles = signal<VehicleListItem[]>([]);

  protected readonly category = signal<ExpenseCategoryKey | 'ALL'>('ALL');
  protected readonly vehicleId = signal('');
  protected readonly query = signal('');
  protected readonly filtersOpen = signal(false);
  protected readonly page = signal(0);

  protected readonly deleting = signal<Expense | null>(null);
  protected readonly deletingBusy = signal(false);

  protected readonly monthTitle = computed(() => monthTitle(this.month()));
  protected readonly monthLower = computed(() => monthName(this.month()));
  /** Não há gasto no futuro para ver: o botão "próximo" para no mês corrente. */
  protected readonly canGoNext = computed(() => this.month() < this.currentMonth);

  protected readonly summary = computed(() => summarize(this.items()));
  protected readonly pills = computed<FilterChipOption<ExpenseCategoryKey | 'ALL'>[]>(() =>
    categoryCounts(this.items()).map((c) => ({ value: c.value, label: `${c.label} ${c.count}` })),
  );
  protected readonly filtered = computed(() =>
    filterExpenses(this.items(), {
      category: this.category(),
      vehicleId: this.vehicleId(),
      query: this.query(),
    }),
  );
  protected readonly filteredTotal = computed(() =>
    this.filtered().reduce((sum, e) => sum + e.amountCents, 0),
  );
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filtered().length / PAGE_SIZE)),
  );
  protected readonly rows = computed(() =>
    this.filtered().slice(this.page() * PAGE_SIZE, (this.page() + 1) * PAGE_SIZE),
  );
  /** Mês sem nenhum lançamento (diferente de "filtro sem resultado"). */
  protected readonly empty = computed(
    () => !this.loading() && !this.error() && this.items().length === 0,
  );
  protected readonly noMatch = computed(
    () => this.items().length > 0 && this.filtered().length === 0,
  );

  ngOnInit(): void {
    this.vehiclesService.list({ size: 500, sort: 'plate_asc' }).subscribe({
      next: (res) => this.vehicles.set(res.content ?? []),
      error: () => this.vehicles.set([]),
    });
    this.load();
  }

  protected step(delta: number): void {
    const next = shiftMonth(this.month(), delta);
    if (delta > 0 && next > this.currentMonth) return;
    this.month.set(next);
    this.category.set('ALL');
    this.page.set(0);
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    const asked = this.month();
    this.expensesService.listMonth(asked).subscribe({
      next: (list) => {
        if (asked !== this.month()) return; // resposta de um mês que já saiu da tela
        this.items.set(list);
        this.loading.set(false);
        // A delete can leave the current page past the end (last row of the last page): step back.
        if (this.page() >= this.totalPages()) this.page.set(this.totalPages() - 1);
      },
      error: (err: unknown) => {
        this.apiErrors.claim(err);
        if (asked !== this.month()) return;
        this.items.set([]);
        this.loading.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar os gastos.'));
      },
    });
  }

  protected pickCategory(value: ExpenseCategoryKey | 'ALL'): void {
    this.category.set(value);
    this.page.set(0);
  }

  protected setQuery(value: string): void {
    this.query.set(value);
    this.page.set(0);
  }

  protected setVehicle(value: string): void {
    this.vehicleId.set(value);
    this.page.set(0);
  }

  protected prev(): void {
    if (this.page() > 0) this.page.update((p) => p - 1);
  }

  protected next(): void {
    if (this.page() + 1 < this.totalPages()) this.page.update((p) => p + 1);
  }

  protected money(cents: number): string {
    return formatBRL(cents);
  }

  protected date(iso: string): string {
    return iso.split('-').reverse().join('/');
  }

  protected vehicleOption(v: VehicleListItem): string {
    return `${formatPlate(v.plate)} · ${formatVehicleLabel(v.brand, v.model)}`;
  }

  /** O back-end manda `PLACA · marca modelo`; sem veículo é um gasto da locadora toda. */
  protected plateOf(e: Expense): string {
    return e.vehicleLabel ? formatPlate(e.vehicleLabel.split(' · ')[0]) : '—';
  }

  protected modelOf(e: Expense): string {
    if (!e.vehicleLabel) return 'Locadora toda';
    return e.vehicleLabel.split(' · ').slice(1).join(' · ');
  }

  protected askDelete(e: Expense, event?: Event): void {
    event?.stopPropagation();
    this.deleting.set(e);
  }

  protected cancelDelete(): void {
    if (this.deletingBusy()) return;
    this.deleting.set(null);
  }

  protected confirmDelete(): void {
    const e = this.deleting();
    if (!e) return;
    this.actionError.set(null);
    this.deletingBusy.set(true);
    this.expensesService.remove(e.id).subscribe({
      next: () => {
        this.deletingBusy.set(false);
        this.deleting.set(null);
        this.notifications.success('Gasto excluído.');
        this.load();
      },
      error: (err: unknown) => {
        this.deletingBusy.set(false);
        this.deleting.set(null);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível excluir o gasto.'));
        // 404: the gasto is already gone (deleted elsewhere): refresh so the row leaves the list.
        if (err instanceof HttpErrorResponse && err.status === 404) this.load();
      },
    });
  }
}
