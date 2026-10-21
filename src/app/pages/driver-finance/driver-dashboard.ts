import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { MembersSheet } from '../company-settings/members/members-sheet';
import {
  DASHBOARD_PRESETS,
  DashboardPreset,
  addDays,
  addMonths,
  brl,
  brlShort,
  daysBetween,
  longDate,
  maxIso,
  minIso,
  monthEnd,
  monthLabel,
  monthStart,
  mondayOf,
  presetRange,
} from './driver-finance.calc';
import {
  DashboardInput,
  WEEK_CHART_HEIGHT,
  alertsModel,
  calendarModel,
  carModel,
  coverModel,
  dayModel,
  goalsModel,
  heroModel,
  periodModel,
  weekModel,
} from './driver-dashboard.model';
import {
  DRIVER_FINANCE_LINKS,
  DRIVER_FINANCE_TODAY,
  DriverFinanceSource,
} from './driver-finance.source';
import {
  DriverFinanceContext,
  DriverGoals,
  LedgerItem,
  LoadState,
} from './driver-finance.types';
import * as ui from './driver-finance.ui';
import { DriverRentCoverCard } from './driver-rent-cover-card';
import { LedgerEntrySheet } from './ledger-entry-sheet';

const WEEKDAY_HEAD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * Dashboard do motorista — the owner's prototype (`Motorista Dashboard.dc.html`): today's
 * profit against the daily goal, the alerts the app can prove, the week, the rent
 * coverage, the period numbers (efficiency, where the money goes, best days, average per
 * ride by app), the financial calendar, goals and the car.
 *
 * Everything is computed here from the ledger + goals + the rental's charges
 * (`driver-dashboard.model.ts`). The ledger is read as a WINDOW that grows to cover the
 * selected period, its previous period, the week and the calendar month — moving the
 * calendar or the period only fetches when the window does not cover it yet.
 *
 * «Lançar» (hero, and the FAB on phones once the hero's button scrolled away) opens the
 * launch popup with the Ganho/Custo tabs: Lançar → valor → Salvar is three touches.
 */
@Component({
  selector: 'app-driver-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, DriverRentCoverCard, LedgerEntrySheet, MembersSheet, RouterLink],
  host: { class: 'block' },
  templateUrl: './driver-dashboard.html',
})
export class DriverDashboard {
  private readonly source = inject(DriverFinanceSource);
  protected readonly links = inject(DRIVER_FINANCE_LINKS);
  private readonly todayFn = inject(DRIVER_FINANCE_TODAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly sheet = viewChild.required(LedgerEntrySheet);
  private readonly heroAction = viewChild<ElementRef<HTMLElement>>('heroAction');

  protected readonly ui = ui;
  protected readonly presets = DASHBOARD_PRESETS;
  protected readonly weekdayHead = WEEKDAY_HEAD;
  protected readonly chartHeight = WEEK_CHART_HEIGHT;
  protected readonly money = brl;
  protected readonly short = brlShort;

  protected readonly today = computed(() => this.todayFn());
  protected readonly todayLabel = computed(() => longDate(this.today()));

  protected readonly state = signal<LoadState>('loading');
  private readonly items = signal<LedgerItem[]>([]);
  private readonly goals = signal<DriverGoals | null>(null);
  private readonly context = signal<DriverFinanceContext | null>(null);
  /** The ledger window already in memory. */
  private loaded: { from: string; to: string } | null = null;

  protected readonly preset = signal<DashboardPreset>('monthCurrent');
  protected readonly customFrom = signal(addDays(this.todayFn(), -13));
  protected readonly customTo = signal(this.todayFn());
  protected readonly calMonth = signal(monthStart(this.todayFn()));
  protected readonly selectedDay = signal<string | null>(null);
  /** Phones: the FAB shows once the hero's «Lançar» left the screen. */
  protected readonly fabVisible = signal(false);

  protected readonly range = computed(() =>
    presetRange(this.preset(), this.today(), { from: this.customFrom(), to: this.customTo() }),
  );

  private readonly input = computed<DashboardInput>(() => ({
    items: this.items(),
    goals: this.goals(),
    rental: this.context()?.rental ?? null,
    today: this.today(),
  }));

  protected readonly greeting = computed(() => {
    const name = this.context()?.firstName;
    return name ? `Olá, ${name}` : 'Olá';
  });
  protected readonly hero = computed(() => heroModel(this.input()));
  protected readonly alerts = computed(() =>
    alertsModel(this.context()?.rental ?? null, this.context()?.licenseExpiry ?? null, this.today()),
  );
  protected readonly week = computed(() => weekModel(this.input()));
  protected readonly cover = computed(() => coverModel(this.input()));
  protected readonly period = computed(() =>
    periodModel(this.input(), this.range().from, this.range().to),
  );
  protected readonly calendar = computed(() => calendarModel(this.input(), this.calMonth()));
  protected readonly calendarLabel = computed(() => monthLabel(this.calMonth()));
  protected readonly day = computed(() => {
    const d = this.selectedDay();
    return d ? dayModel(this.input(), d) : null;
  });
  protected readonly goalRows = computed(() => goalsModel(this.input()));
  protected readonly car = computed(() => carModel(this.input()));
  protected readonly lastOdometer = computed(() => {
    const max = Math.max(0, ...this.items().map((i) => i.odometerKm ?? 0));
    return max || null;
  });

  constructor() {
    this.loadAll();
    afterNextRender(() => this.watchHeroAction());
  }

  /** First load (and «Tentar novamente»): goals, context and the ledger window. */
  loadAll(): void {
    this.state.set('loading');
    this.loaded = null;
    const window = this.neededWindow();
    forkJoin({
      goals: this.source.goals(),
      context: this.source.context(),
      items: this.source.list({ from: window.from, to: window.to }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ goals, context, items }) => {
          this.goals.set(goals);
          this.context.set(context);
          this.items.set(items);
          this.loaded = window;
          this.state.set('ready');
        },
        error: () => this.state.set('error'),
      });
  }

  // ------------------------------------------------------------ period + calendar

  protected selectPreset(key: DashboardPreset): void {
    this.preset.set(key);
    this.ensureWindow();
  }

  protected onCustomFrom(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) this.customFrom.set(value);
    this.ensureWindow();
  }

  protected onCustomTo(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) this.customTo.set(value);
    this.ensureWindow();
  }

  protected calPrev(): void {
    this.calMonth.update((m) => addMonths(m, -1));
    this.ensureWindow();
  }

  protected calNext(): void {
    this.calMonth.update((m) => addMonths(m, 1));
    this.ensureWindow();
  }

  protected calToday(): void {
    this.calMonth.set(monthStart(this.today()));
    this.selectedDay.set(this.today());
  }

  protected openDay(date: string | null): void {
    if (date) this.selectedDay.set(date);
  }

  protected closeDay(): void {
    this.selectedDay.set(null);
  }

  /** The window every card needs: the period + its previous period, the week and the month. */
  private neededWindow(): { from: string; to: string } {
    const today = this.today();
    const { from, to } = this.range();
    const len = daysBetween(from, to) + 1;
    const month = this.calMonth();
    return {
      from: minIso(addDays(from, -len), mondayOf(today), monthStart(month), monthStart(today), addDays(mondayOf(today), -28)),
      to: minIso(maxIso(to, monthEnd(month), today), today),
    };
  }

  private ensureWindow(): void {
    if (this.state() !== 'ready') return;
    const need = this.neededWindow();
    const have = this.loaded;
    if (have && need.from >= have.from && need.to <= have.to) return;
    const window = have
      ? { from: minIso(need.from, have.from), to: maxIso(need.to, have.to) }
      : need;
    this.source
      .list({ from: window.from, to: window.to })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          this.items.set(items);
          this.loaded = window;
        },
        error: () => this.state.set('error'),
      });
  }

  // ------------------------------------------------------------ launch

  protected openLaunch(): void {
    this.sheet().openCreate('INCOME', true);
  }

  protected editEvent(item: LedgerItem | null): void {
    if (!item) return;
    this.selectedDay.set(null);
    this.sheet().openEdit(item);
  }

  protected onSaved(item: LedgerItem): void {
    this.items.update((list) => [item, ...list.filter((i) => i.id !== item.id)]);
  }

  protected onRemoved(id: string): void {
    this.items.update((list) => list.filter((i) => i.id !== id));
  }

  private watchHeroAction(): void {
    const el = this.heroAction()?.nativeElement;
    if (!this.isBrowser || !el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) =>
      this.fabVisible.set(!entry.isIntersecting && entry.boundingClientRect.top < 0),
    );
    observer.observe(el);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}
