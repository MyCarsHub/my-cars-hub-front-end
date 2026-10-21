import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Observable, Subject, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { MembersSheet } from '../company-settings/members/members-sheet';
import {
  DASHBOARD_PRESETS,
  DashboardPreset,
  addDays,
  addMonths,
  brl,
  brlShort,
  longDate,
  monthLabel,
  monthStart,
  presetRange,
} from './driver-finance.calc';
import {
  DashboardInput,
  WEEK_CHART_HEIGHT,
  alertsModel,
  calendarModel,
  carModel,
  dayModel,
  goalsModel,
  heroModel,
  periodModel,
  weekModel,
} from './driver-dashboard.model';
import { DriverFinanceClock } from './driver-finance.clock';
import { DRIVER_FINANCE_LINKS, DriverFinanceSource, toDashboard } from './driver-finance.source';
import {
  DriverCalendarData,
  DriverDashboardData,
  DriverFinanceContext,
  LedgerItem,
  LoadState,
} from './driver-finance.types';
import * as ui from './driver-finance.ui';
import { DriverNextCharge } from '../driver-area/rental/driver-next-charge';
import { LedgerEntrySheet } from './ledger-entry-sheet';
import { ArrowSelect } from './arrow-select';

const WEEKDAY_HEAD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Days of ledger the Dashboard keeps: rent coverage (up to a monthly period) and the week. */
const RECENT_DAYS = 31;

const NO_CONTEXT: DriverFinanceContext = { firstName: null, licenseExpiry: null, rental: null };

/** Each request supersedes the previous one; a failure comes back as `null`, never as an error. */
function latest<K, V>(requests: Subject<K>, call: (key: K) => Observable<V>) {
  return requests.pipe(
    switchMap((key) =>
      call(key).pipe(
        map((value) => ({ value: value as V | null })),
        catchError(() => of({ value: null as V | null })),
      ),
    ),
  );
}

/**
 * Dashboard do motorista — the owner's prototype (`Motorista Dashboard.dc.html`): today's
 * profit against the daily goal, the alerts the app can prove, the week, the rent
 * coverage, the period numbers (efficiency, where the money goes, best days, average per
 * ride by app), the financial calendar, goals and the car.
 *
 * The numbers are the SERVER's: `/v1/driver/dashboard` (today, goals, efficiency,
 * breakdown, weekdays, by app) and `/v1/driver/calendar`. The ledger of the last
 * `RECENT_DAYS` feeds only what the server does not compute (rent coverage since the last
 * charge, km of the week). Only the dashboard read is fatal: the profile, the recent ledger
 * and the calendar degrade in place.
 *
 * «Lançar» (hero, and the FAB on phones once the hero's button scrolled away) opens the
 * launch popup with the Ganho/Custo tabs: Lançar → valor → Salvar is three touches.
 */
@Component({
  selector: 'app-driver-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, ArrowSelect, DriverNextCharge, LedgerEntrySheet, MembersSheet, RouterLink],
  providers: [DriverFinanceClock],
  host: { class: 'block' },
  templateUrl: './driver-dashboard.html',
})
export class DriverDashboard {
  private readonly source = inject(DriverFinanceSource);
  protected readonly links = inject(DRIVER_FINANCE_LINKS);
  private readonly clock = inject(DriverFinanceClock);
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

  /** A signal (not a memoised function): turns over at midnight with the screen open. */
  protected readonly today = this.clock.today;
  protected readonly todayLabel = computed(() => longDate(this.today()));

  protected readonly state = signal<LoadState>('loading');
  private readonly context = signal<DriverFinanceContext>(NO_CONTEXT);
  private readonly recent = signal<LedgerItem[]>([]);
  private readonly dash = signal<DriverDashboardData>(toDashboard({}, '', ''));
  private readonly cal = signal<DriverCalendarData | null>(null);
  /** A later read failed: the screen stays, with a retry for that part. */
  protected readonly periodError = signal(false);
  protected readonly calendarError = signal(false);

  protected readonly preset = signal<DashboardPreset>('monthCurrent');
  protected readonly customFrom = signal(addDays(this.clock.today(), -13));
  protected readonly customTo = signal(this.clock.today());
  protected readonly calMonth = signal(monthStart(this.clock.today()));
  protected readonly selectedDay = signal<string | null>(null);
  /** Phones: the FAB shows once the hero's «Lançar» left the screen. */
  protected readonly fabVisible = signal(false);

  private readonly periodRequests = new Subject<{ from: string; to: string }>();
  private readonly calendarRequests = new Subject<string>();
  private readonly recentRequests = new Subject<string>();

  protected readonly range = computed(() =>
    presetRange(this.preset(), this.today(), { from: this.customFrom(), to: this.customTo() }),
  );

  private readonly input = computed<DashboardInput>(() => ({
    items: this.recent(),
    goals: this.dash().goals,
    rental: this.context().rental,
    today: this.today(),
  }));

  protected readonly greeting = computed(() => {
    const name = this.context().firstName;
    return name ? `Olá, ${name}` : 'Olá';
  });
  protected readonly hero = computed(() => heroModel(this.dash().today, this.dash().goals));
  protected readonly alerts = computed(() =>
    alertsModel(this.context().rental, this.context().licenseExpiry, this.today()),
  );
  protected readonly week = computed(() => weekModel(this.input()));
  /** Active rental, for the «Aluguel da semana» card (the real one from Meu aluguel). */
  protected readonly rentalId = computed(() => this.context().rental?.rentalId ?? null);
  protected readonly period = computed(() => periodModel(this.dash()));
  protected readonly calendar = computed(() =>
    calendarModel(this.cal(), this.calMonth(), this.today()),
  );
  protected readonly calendarLabel = computed(() => monthLabel(this.calMonth()));
  protected readonly day = computed(() => {
    const d = this.selectedDay();
    return d ? dayModel(this.cal(), d, this.context().rental) : null;
  });
  protected readonly goalRows = computed(() => goalsModel(this.dash().goals));
  protected readonly car = computed(() => carModel(this.input()));
  /** The server's last odometer reading — the cost popup's "Último registro". */
  protected readonly lastOdometer = computed(() => this.dash().expenseStats.lastOdometerKm);

  constructor() {
    latest(this.periodRequests, (r) => this.source.dashboard(r.from, r.to))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ value }) => {
        this.periodError.set(value === null);
        if (value) this.dash.set(value);
      });
    latest(this.calendarRequests, (month) => this.source.calendar(month))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ value }) => {
        this.calendarError.set(value === null);
        if (value) this.cal.set(value);
      });
    latest(this.recentRequests, (today) =>
      this.source.list({ from: addDays(today, -RECENT_DAYS), to: today }),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ value }) => {
        if (value) this.recent.set(value);
      });

    this.loadAll();
    afterNextRender(() => this.watchHeroAction());

    // Midnight with the Dashboard open: "Hoje" moved, every part re-reads.
    let firstDay = true;
    effect(() => {
      this.today();
      if (firstDay) {
        firstDay = false;
        return;
      }
      untracked(() => this.refresh());
    });
  }

  /** First load (and «Tentar novamente»). Only the dashboard read can fail the screen. */
  loadAll(): void {
    this.state.set('loading');
    const today = this.today();
    const { from, to } = this.range();
    forkJoin({
      dash: this.source.dashboard(from, to),
      context: this.source.context().pipe(catchError(() => of(NO_CONTEXT))),
      recent: this.source
        .list({ from: addDays(today, -RECENT_DAYS), to: today })
        .pipe(catchError(() => of([] as LedgerItem[]))),
      cal: this.source.calendar(this.calMonth().slice(0, 7)).pipe(catchError(() => of(null))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ dash, context, recent, cal }) => {
          this.dash.set(dash);
          this.context.set(context);
          this.recent.set(recent);
          this.cal.set(cal);
          this.calendarError.set(cal === null);
          this.periodError.set(false);
          this.state.set('ready');
        },
        error: () => this.state.set('error'),
      });
  }

  /** After a save, a delete or a new day: every part re-reads; stale answers are dropped. */
  private refresh(): void {
    if (this.state() !== 'ready') return;
    this.retryPeriod();
    this.retryCalendar();
    this.recentRequests.next(this.today());
  }

  // ------------------------------------------------------------ period + calendar

  protected retryPeriod(): void {
    this.periodRequests.next(this.range());
  }

  protected retryCalendar(): void {
    this.calendarRequests.next(this.calMonth().slice(0, 7));
  }

  protected selectPreset(key: DashboardPreset): void {
    this.preset.set(key);
    this.retryPeriod();
  }

  protected onCustomFrom(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) this.customFrom.set(value);
    this.retryPeriod();
  }

  protected onCustomTo(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) this.customTo.set(value);
    this.retryPeriod();
  }

  protected calPrev(): void {
    this.calMonth.update((m) => addMonths(m, -1));
    this.retryCalendar();
  }

  protected calNext(): void {
    this.calMonth.update((m) => addMonths(m, 1));
    this.retryCalendar();
  }

  protected calToday(): void {
    const month = monthStart(this.today());
    if (month !== this.calMonth()) {
      this.calMonth.set(month);
      this.retryCalendar();
    }
    this.selectedDay.set(this.today());
  }

  protected openDay(date: string | null): void {
    if (date) this.selectedDay.set(date);
  }

  protected closeDay(): void {
    this.selectedDay.set(null);
  }

  // ------------------------------------------------------------ launch

  protected openLaunch(): void {
    this.sheet().openCreate('INCOME', true);
  }

  /**
   * A ledger row of the day opens the edit popup. The calendar item carries only id, label
   * and amount, so the full entry (rides, app, rentalId…) comes from the recent ledger or,
   * for an older day, from a read of that day.
   */
  protected editEvent(id: string | null): void {
    const date = this.selectedDay();
    if (!id || !date) return;
    const open = (item: LedgerItem | undefined) => {
      if (!item) return;
      this.selectedDay.set(null);
      this.sheet().openEdit(item);
    };
    const known = this.recent().find((i) => i.id === id);
    if (known) {
      open(known);
      return;
    }
    this.source
      .list({ from: date, to: date })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => open(items.find((i) => i.id === id)),
        error: () => this.calendarError.set(true),
      });
  }

  protected onSaved(): void {
    this.refresh();
  }

  protected onRemoved(): void {
    this.refresh();
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
