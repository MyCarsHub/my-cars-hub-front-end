import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../components/core/actions-menu/actions-menu';
import { PaintedCard } from '../../components/core/painted-card/painted-card';
import { StatusChip } from '../../components/core/status-chip/status-chip';
import {
  FilterChipGroup,
  FilterChipOption,
} from '../../components/filter-chip-group/filter-chip-group';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { AdjustmentsService } from '../../services/adjustments.service';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverService } from '../../services/driver.service';
import { NotificationService } from '../../services/notification.service';
import {
  ADJUSTMENT_QUERY_MAX,
  Adjustment,
  AdjustmentListResponse,
  AdjustmentStatusFilter,
} from '../../types/adjustment.types';
import { formatBRL } from '../../types/dashboard.types';
import { DriverListItem } from '../../types/driver.types';
import {
  adjustmentStatusMeta,
  brDate,
  initialsOf,
  lastAdjustmentDueDate,
} from '../../utils/adjustments-view';
import { todayInBusinessTz } from '../../utils/business-clock';
import { monthName, monthTitle, shiftMonth } from '../../utils/expenses-view';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Ajustes (V141): cobranças avulsas a um motorista, mês a mês (pelo vencimento). Os cartões e as
 * contagens das pílulas vêm do back-end, que pagina; a tela só pede.
 *
 * Ação da linha no ⋮: ver o ajuste e, enquanto pode ser paga, copiar o Pix. Não há gerar de
 * novo, cancelar nem marcar como paga (decisão do dono; o back-end recusa gerar de novo).
 */
@Component({
  selector: 'app-adjustments-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    DefaultPageLayout,
    PaintedCard,
    StatusChip,
    FilterChipGroup,
    ActionsMenu,
    AlertBanner,
  ],
  templateUrl: './adjustments-list.html',
})
export class AdjustmentsList implements OnInit {
  private readonly adjustmentsService = inject(AdjustmentsService);
  private readonly driverService = inject(DriverService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly today = todayInBusinessTz();
  private readonly currentMonth = this.today.slice(0, 7);
  /** O vencimento vai até o teto do back-end; o seletor de mês chega até o mês dele. */
  private readonly lastMonth = lastAdjustmentDueDate(this.today).slice(0, 7);

  protected readonly queryMax = ADJUSTMENT_QUERY_MAX;
  protected readonly month = signal(this.currentMonth);
  protected readonly status = signal<AdjustmentStatusFilter>('ALL');
  protected readonly driverId = signal('');
  protected readonly query = signal('');
  protected readonly page = signal(0);
  protected readonly filtersOpen = signal(false);

  protected readonly data = signal<AdjustmentListResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly drivers = signal<DriverListItem[]>([]);
  protected readonly copying = signal<string | null>(null);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;

  protected readonly monthTitle = computed(() => monthTitle(this.month()));
  protected readonly monthLower = computed(() => monthName(this.month()));
  protected readonly canGoNext = computed(() => this.month() < this.lastMonth);

  protected readonly summary = computed(() => this.data()?.summary ?? null);
  protected readonly rows = computed(() => this.data()?.page.content ?? []);
  protected readonly total = computed(() => this.data()?.page.total ?? 0);
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly monthCount = computed(() => this.data()?.statusCounts.all ?? 0);

  protected readonly pills = computed<FilterChipOption<AdjustmentStatusFilter>[]>(() => {
    const c = this.data()?.statusCounts;
    const n = (v: number | undefined) => v ?? 0;
    return [
      { value: 'ALL', label: `Todos ${n(c?.all)}` },
      { value: 'PENDING', label: `Pendentes ${n(c?.pending)}` },
      { value: 'OVERDUE', label: `Atrasados ${n(c?.overdue)}` },
      { value: 'PAID', label: `Pagos ${n(c?.paid)}` },
      { value: 'CANCELED', label: `Cancelados ${n(c?.canceled)}` },
    ];
  });

  private readonly hasNarrowing = computed(() => this.driverId() !== '' || this.query().trim() !== '');
  /** Mês sem nenhum ajuste (diferente de "filtro sem resultado"). */
  protected readonly empty = computed(
    () =>
      !this.loading() &&
      !this.error() &&
      this.data() !== null &&
      this.monthCount() === 0 &&
      !this.hasNarrowing(),
  );
  protected readonly noMatch = computed(
    () => !this.loading() && this.data() !== null && this.rows().length === 0 && !this.empty(),
  );

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
    this.driverService.list({ size: 500, sort: 'name_asc' }).subscribe({
      next: (res) => this.drivers.set(res.content ?? []),
      error: () => this.drivers.set([]),
    });
    this.load();
  }

  protected load(): void {
    const seq = ++this.requestSeq;
    this.loading.set(true);
    this.error.set(null);
    this.adjustmentsService
      .list({
        month: this.month(),
        status: this.status(),
        driverId: this.driverId(),
        q: this.query(),
        page: this.page(),
        size: PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          if (seq !== this.requestSeq) return; // resposta de um filtro que já saiu da tela
          this.data.set(res);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.apiErrors.claim(err);
          if (seq !== this.requestSeq) return;
          this.data.set(null);
          this.loading.set(false);
          this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar os ajustes.'));
        },
      });
  }

  protected step(delta: number): void {
    const next = shiftMonth(this.month(), delta);
    if (delta > 0 && next > this.lastMonth) return;
    this.month.set(next);
    this.page.set(0);
    this.load();
  }

  protected pickStatus(value: AdjustmentStatusFilter): void {
    this.status.set(value);
    this.page.set(0);
    this.load();
  }

  protected setDriver(value: string): void {
    this.driverId.set(value);
    this.page.set(0);
    this.load();
  }

  protected setQuery(value: string): void {
    this.query.set(value);
    this.page.set(0);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.load();
    }, SEARCH_DEBOUNCE_MS);
  }

  protected prev(): void {
    if (this.page() === 0) return;
    this.page.update((p) => p - 1);
    this.load();
  }

  protected next(): void {
    if (this.page() + 1 >= this.totalPages()) return;
    this.page.update((p) => p + 1);
    this.load();
  }

  protected money(cents: number): string {
    return formatBRL(cents);
  }

  protected date(iso: string): string {
    return brDate(iso);
  }

  protected initials(name: string): string {
    return initialsOf(name);
  }

  protected meta(a: Adjustment) {
    return adjustmentStatusMeta(a.status, a.dueDate, this.today);
  }

  protected canCopyPix(a: Adjustment): boolean {
    return a.pixAvailable && !!a.rentalId && !!a.chargeId && this.meta(a).open;
  }

  protected countLabel(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  protected copyPix(a: Adjustment): void {
    if (!a.rentalId || !a.chargeId || this.copying()) return;
    this.copying.set(a.id);
    this.adjustmentsService.pix(a.rentalId, a.chargeId).subscribe({
      next: async (payload) => {
        try {
          await navigator.clipboard.writeText(payload);
          this.notifications.success('Pix copia-e-cola copiado.');
        } catch {
          this.notifications.error('Não foi possível copiar. Abra o ajuste e tente de novo.');
        }
        this.copying.set(null);
      },
      error: (err: unknown) => {
        this.copying.set(null);
        this.notifications.error(this.apiErrors.messageFor(err, 'Não foi possível obter o Pix.'));
      },
    });
  }
}
