import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { EMPTY, Observable, catchError, expand, map, of, reduce, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DriverProfileService } from '../../services/driver-profile.service';
import { RentalChargeDto } from '../../types/rental.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import { RIDE_APPS, addDays, daysBetween } from './driver-finance.calc';
import {
  CalendarItemType,
  DriverCalendarData,
  DriverDashboardData,
  DriverEfficiency,
  DriverFinanceContext,
  DriverGoals,
  DriverGoalsState,
  DriverRentalContext,
  GoalProgress,
  LedgerFilter,
  LedgerItem,
  LedgerItemRequest,
  LedgerType,
  RideApp,
} from './driver-finance.types';

/** "Today" of the finance screens, in the business time zone. The demo pins it. */
export const DRIVER_FINANCE_TODAY = new InjectionToken<() => string>('DRIVER_FINANCE_TODAY', {
  providedIn: 'root',
  factory: () => () => todayInBusinessTz(),
});

/** Where the Dashboard's links point. The demo maps them to `/dev/driver/*`. */
export const DRIVER_FINANCE_LINKS = new InjectionToken<{ goals: string }>('DRIVER_FINANCE_LINKS', {
  providedIn: 'root',
  factory: () => ({ goals: '/meu-painel/metas' }),
});

/**
 * The one port the four finance screens read and write through. Production uses
 * `HttpDriverFinanceSource`; the `/dev/driver` demo swaps in an in-memory one with the
 * prototype's data and a state switch (normal / carregando / vazio / erro).
 *
 * The port speaks the DOMAIN (`type`, `amount`, `date`); the HTTP adapter below is the one
 * place that knows the wire (`kind`, `amountCents`, `occurredOn`, `dailyGoalCents`).
 */
@Injectable({ providedIn: 'root', useFactory: () => inject(HttpDriverFinanceSource) })
export abstract class DriverFinanceSource {
  abstract list(filter: LedgerFilter): Observable<LedgerItem[]>;
  /** `true` when the driver has at least one entry of `type`, at any date. */
  abstract hasAny(type: LedgerType): Observable<boolean>;
  abstract create(request: LedgerItemRequest): Observable<LedgerItem>;
  abstract update(id: string, request: LedgerItemRequest): Observable<LedgerItem>;
  abstract remove(id: string): Observable<void>;
  /** The goal (null = never configured) and the server's progress against it. */
  abstract goals(): Observable<DriverGoalsState>;
  abstract saveGoals(goals: DriverGoals): Observable<DriverGoalsState>;
  /** The server's aggregates of `from..to` (plus today, goals and the weekdays). */
  abstract dashboard(from: string, to: string): Observable<DriverDashboardData>;
  /** `month` = `YYYY-MM`. */
  abstract calendar(month: string): Observable<DriverCalendarData>;
  abstract context(): Observable<DriverFinanceContext>;
}

const LEDGER = `${environment.apiUrl}/driver/ledger`;
const GOALS = `${environment.apiUrl}/driver/goals`;
const DASHBOARD = `${environment.apiUrl}/driver/dashboard`;
const CALENDAR = `${environment.apiUrl}/driver/calendar`;
const RENTALS = `${environment.apiUrl}/rentals`;

/** The server's ceiling for one page of the ledger (`MAX_PAGE_SIZE`). */
export const LEDGER_PAGE_SIZE = 100;
/** 50 × 100 entries: more than a year of a busy driver; beyond it something is wrong. */
const MAX_PAGES = 50;

/**
 * Another page exists when the last one came full and the total (if sent) is not reached.
 * "Full" is measured against the `size` the SERVER says it used (it may cap below what was
 * asked), so a lower ceiling on its side still pages instead of stopping at page one.
 */
export function hasNextPage(
  index: number,
  received: number,
  total: number | null,
  pageSize: number = LEDGER_PAGE_SIZE,
): boolean {
  if (index + 1 >= MAX_PAGES || received === 0 || received < pageSize) return false;
  return total === null || (index + 1) * pageSize < total;
}

@Injectable({ providedIn: 'root' })
export class HttpDriverFinanceSource extends DriverFinanceSource {
  private readonly http = inject(HttpClient);
  private readonly profile = inject(DriverProfileService);
  private readonly today = inject(DRIVER_FINANCE_TODAY);

  /**
   * Every entry of the window, page after page: the server caps a page at
   * `LEDGER_PAGE_SIZE` and lists newest first, so one page would silently drop the oldest
   * days of a long period. Stops at the last page (or `MAX_PAGES`, a guard-rail).
   */
  list(filter: LedgerFilter): Observable<LedgerItem[]> {
    const page = (index: number) =>
      this.http
        .get<unknown>(LEDGER, { params: ledgerParams(filter, index, LEDGER_PAGE_SIZE) })
        .pipe(map((res) => ({ index, ...toPage(res) })));
    return page(0).pipe(
      expand((p) =>
        hasNextPage(p.index, p.received, p.total, p.size) ? page(p.index + 1) : EMPTY,
      ),
      // An entry saved between two page reads shifts the OFFSET: the same id can come twice.
      reduce((all, p) => {
        for (const item of p.items) all.set(item.id, item);
        return all;
      }, new Map<string, LedgerItem>()),
      map((all) => [...all.values()]),
    );
  }

  hasAny(type: LedgerType): Observable<boolean> {
    return this.http
      .get<unknown>(LEDGER, { params: ledgerParams({ type }, 0, 1) })
      .pipe(map((res) => toPage(res).items.length > 0));
  }

  create(request: LedgerItemRequest): Observable<LedgerItem> {
    return this.http.post<unknown>(LEDGER, toWire(request)).pipe(map(itemOrFail));
  }

  update(id: string, request: LedgerItemRequest): Observable<LedgerItem> {
    return this.http
      .put<unknown>(`${LEDGER}/${encodeURIComponent(id)}`, toWire(request))
      .pipe(map(itemOrFail));
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${LEDGER}/${encodeURIComponent(id)}`);
  }

  goals(): Observable<DriverGoalsState> {
    return this.http.get<unknown>(GOALS).pipe(map(toGoalsState));
  }

  saveGoals(goals: DriverGoals): Observable<DriverGoalsState> {
    const body = { dailyGoalCents: goals.dailyGoal, workDaysPerWeek: goals.workDaysPerWeek };
    return this.http.put<unknown>(GOALS, body).pipe(map(toGoalsState));
  }

  dashboard(from: string, to: string): Observable<DriverDashboardData> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http
      .get<unknown>(DASHBOARD, { params })
      .pipe(map((res) => toDashboard(res, from, to)));
  }

  calendar(month: string): Observable<DriverCalendarData> {
    const params = new HttpParams().set('month', month);
    return this.http.get<unknown>(CALENDAR, { params }).pipe(map((res) => toCalendar(res, month)));
  }

  /**
   * Profile (name, CNH, active rental) + the rental's charges. A failure of the charges
   * read never breaks the dashboard: the rental card just has no "próxima cobrança".
   */
  context(): Observable<DriverFinanceContext> {
    return this.profile.get().pipe(
      switchMap((profile) => {
        const base: DriverFinanceContext = {
          firstName: profile.name ? profile.name.trim().split(/\s+/)[0] : null,
          licenseExpiry: profile.licenseExpiry,
          rental: null,
        };
        const rental = profile.activeRental;
        if (!rental) return of(base);
        const label = [rental.brand, rental.model].filter(Boolean).join(' ') || 'Seu carro';
        return this.http
          .get<RentalChargeDto[] | { content?: RentalChargeDto[] }>(
            `${RENTALS}/${encodeURIComponent(rental.rentalId)}/charges`,
          )
          .pipe(
            map((res) => (Array.isArray(res) ? res : (res?.content ?? []))),
            catchError(() => of([] as RentalChargeDto[])),
            map((charges) => ({
              ...base,
              rental: toRentalContext(label, rental.plate, charges, this.today(), rental.startDate),
            })),
          );
      }),
    );
  }
}

// ---------------------------------------------------------------- ledger: domain ⇄ wire

/** Query of `GET /v1/driver/ledger`: the domain `type` travels as `kind`. */
export function ledgerParams(filter: LedgerFilter, page: number, size: number): HttpParams {
  let params = new HttpParams().set('page', String(page)).set('size', String(size));
  if (filter.from) params = params.set('from', filter.from);
  if (filter.to) params = params.set('to', filter.to);
  if (filter.type) params = params.set('kind', filter.type);
  if (filter.category) params = params.set('category', filter.category);
  return params;
}

/**
 * Body of `POST` / `PUT /v1/driver/ledger` (`DriverLedgerEntryRequestDto`). The PUT
 * replaces the whole entry, so every field the entry has is sent. Ride fields go ONLY with
 * an INCOME and the odometer ONLY with an EXPENSE: the server answers 400 to a field of the
 * other kind, so they are left out of the body rather than sent as null.
 */
export function toWire(request: LedgerItemRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    kind: request.type,
    category: request.category,
    amountCents: request.amount,
    occurredOn: request.date,
    description: request.notes,
    rentalId: request.rentalId,
  };
  if (request.type === 'INCOME') {
    body['app'] = request.app;
    body['rides'] = request.rides;
    body['hours'] = request.hours;
    body['km'] = request.km;
  } else {
    body['odometerKm'] = request.odometerKm;
  }
  return body;
}

const isRideApp = (v: unknown): v is RideApp => (RIDE_APPS as readonly unknown[]).includes(v);

/** One entry of the server (`DriverLedgerEntryResponseDto`) in the domain shape. */
export function toItem(raw: unknown): LedgerItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = r['id'];
  const type = r['kind'] as LedgerType | undefined;
  const amount = Number(r['amountCents']);
  const date = String(r['occurredOn'] ?? '');
  if (id === undefined || id === null || (type !== 'INCOME' && type !== 'EXPENSE')) return null;
  if (!Number.isFinite(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const num = (key: string): number | null => {
    const v = r[key];
    return v === null || v === undefined || v === '' || !Number.isFinite(Number(v))
      ? null
      : Number(v);
  };
  return {
    id: String(id),
    date,
    type,
    // Kept exactly as sent: a category without a chip survives an edit.
    category: String(r['category'] ?? (type === 'INCOME' ? 'RIDES' : 'OTHER_EXPENSE')),
    amount: Math.round(amount),
    app: isRideApp(r['app']) ? r['app'] : null,
    rides: num('rides'),
    hours: num('hours'),
    km: num('km'),
    odometerKm: num('odometerKm'),
    notes: (r['description'] ?? r['notes'] ?? null) as string | null,
    rentalId: r['rentalId'] === null || r['rentalId'] === undefined ? null : String(r['rentalId']),
  };
}

function toPage(res: unknown): {
  items: LedgerItem[];
  received: number;
  total: number | null;
  size: number;
} {
  const raw = Array.isArray(res) ? res : ((res as { content?: unknown[] } | null)?.content ?? []);
  const meta = Array.isArray(res) ? {} : ((res ?? {}) as { total?: unknown; size?: unknown });
  const total = Number(meta.total);
  const size = Number(meta.size);
  return {
    items: raw.map(toItem).filter((x): x is LedgerItem => x !== null),
    received: Array.isArray(res) ? 0 : raw.length,
    total: Number.isFinite(total) ? total : null,
    size: Number.isFinite(size) && size > 0 ? size : LEDGER_PAGE_SIZE,
  };
}

function itemOrFail(raw: unknown): LedgerItem {
  const item = toItem(raw);
  if (!item) throw new Error('Resposta inválida do servidor ao salvar o lançamento.');
  return item;
}

// ---------------------------------------------------------------- aggregates

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const int = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const opt = (v: unknown): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function toProgress(raw: unknown): GoalProgress {
  const r = obj(raw);
  return {
    from: str(r['from']),
    to: str(r['to']),
    incomeCents: int(r['incomeCents']),
    goalCents: int(r['goalCents']),
    percent: int(r['percent']),
    reached: r['reached'] === true,
  };
}

/** `DriverGoalsResponseDto`. `configured: false` (or a zero goal) is "never defined". */
export function toGoalsState(raw: unknown): DriverGoalsState {
  const r = obj(raw);
  const daily = int(r['dailyGoalCents']);
  const configured = r['configured'] !== false && daily > 0;
  return {
    goal: configured
      ? { dailyGoal: daily, workDaysPerWeek: int(r['workDaysPerWeek']) || 6 }
      : null,
    today: toProgress(r['today']),
    week: toProgress(r['week']),
    month: toProgress(r['month']),
    weekDays: arr(r['weekDays']).map((d) => {
      const x = obj(d);
      return {
        date: str(x['date']),
        incomeCents: int(x['incomeCents']),
        goalCents: int(x['goalCents']),
        reached: x['reached'] === true,
      };
    }),
    lastWeeks: arr(r['lastWeeks']).map(toProgress),
  };
}

function toEfficiency(raw: unknown): DriverEfficiency {
  const r = obj(raw);
  return {
    rides: int(r['rides']),
    hours: int(r['hours']),
    km: int(r['km']),
    avgPerRideCents: opt(r['avgPerRideCents']),
    perHourCents: opt(r['perHourCents']),
    perKmCents: opt(r['perKmCents']),
    profitPerKmCents: opt(r['profitPerKmCents']),
  };
}

/** `DriverDashboardResponseDto`, the fields the finance screens read. */
export function toDashboard(raw: unknown, from: string, to: string): DriverDashboardData {
  const r = obj(raw);
  const totals = obj(r['totals']);
  const today = obj(r['today']);
  const breakdown = obj(r['breakdown']);
  const weekdays = obj(r['weekdays']);
  const stats = obj(r['expenseStats']);
  return {
    from: str(r['from'], from),
    to: str(r['to'], to),
    totals: {
      incomeCents: int(totals['incomeCents']),
      expenseCents: int(totals['expenseCents']),
      netCents: int(totals['netCents']),
      entryCount: int(totals['entryCount']),
    },
    expenseByCategory: arr(r['expenseByCategory']).map((c) => {
      const x = obj(c);
      return { category: str(x['category']), totalCents: int(x['totalCents']), entryCount: int(x['entryCount']) };
    }),
    today: {
      date: str(today['date']),
      incomeCents: int(today['incomeCents']),
      expenseCents: int(today['expenseCents']),
      rentAccruedCents: int(today['rentAccruedCents']),
      profitCents: int(today['profitCents']),
      rides: int(today['rides']),
      hours: int(today['hours']),
      km: int(today['km']),
      avgPerRideCents: opt(today['avgPerRideCents']),
    },
    goals: r['goals'] ? toGoalsState(r['goals']) : null,
    efficiency: toEfficiency(r['efficiency']),
    previousEfficiency: r['previousEfficiency'] ? toEfficiency(r['previousEfficiency']) : null,
    breakdown: {
      incomeCents: int(breakdown['incomeCents']),
      expenseCents: int(breakdown['expenseCents']),
      rentAccruedCents: int(breakdown['rentAccruedCents']),
      leftCents: int(breakdown['leftCents']),
    },
    incomeByApp: arr(r['incomeByApp']).map((a) => {
      const x = obj(a);
      return {
        app: isRideApp(x['app']) ? x['app'] : null,
        totalCents: int(x['totalCents']),
        rides: int(x['rides']),
        entryCount: int(x['entryCount']),
        avgPerRideCents: opt(x['avgPerRideCents']),
      };
    }),
    weekdays: {
      days: arr(weekdays['days']).map((d) => {
        const x = obj(d);
        return { isoDay: int(x['isoDay']), avgIncomeCents: int(x['avgIncomeCents']), workedDays: int(x['workedDays']) };
      }),
      bestIsoDay: opt(weekdays['bestIsoDay']),
      avgPerWorkedDayCents: int(weekdays['avgPerWorkedDayCents']),
    },
    expenseStats: {
      lastOdometerKm: opt(stats['lastOdometerKm']),
      odometerSpanKm: opt(stats['odometerSpanKm']),
      costPerKmCents: opt(stats['costPerKmCents']),
    },
  };
}

const CALENDAR_TYPES = new Set<CalendarItemType>([
  'LEDGER_INCOME',
  'LEDGER_EXPENSE',
  'CHARGE_PAID',
  'CHARGE_DUE',
  'FINE_DUE',
]);

/** `DriverCalendarResponseDto`. An item of an unknown type is dropped, not guessed. */
export function toCalendar(raw: unknown, month: string): DriverCalendarData {
  const r = obj(raw);
  const totals = obj(r['totals']);
  return {
    month: str(r['month'], `${month}-01`),
    totals: {
      incomeCents: int(totals['incomeCents']),
      outflowCents: int(totals['outflowCents']),
      dueCents: int(totals['dueCents']),
      balanceCents: int(totals['balanceCents']),
    },
    truncated: r['truncated'] === true,
    days: arr(r['days']).map((d) => {
      const x = obj(d);
      return {
        date: str(x['date']),
        incomeCents: int(x['incomeCents']),
        outflowCents: int(x['outflowCents']),
        dueCents: int(x['dueCents']),
        items: arr(x['items'])
          .map((i) => {
            const y = obj(i);
            return {
              id: String(y['id'] ?? ''),
              type: str(y['type']) as CalendarItemType,
              label: str(y['label']),
              amountCents: int(y['amountCents']),
              status: typeof y['status'] === 'string' ? (y['status'] as string) : null,
            };
          })
          .filter((i) => CALENDAR_TYPES.has(i.type)),
      };
    }),
  };
}

// ---------------------------------------------------------------- rental

/** Settled charges: PAID, and DISPUTED (the money already left — the server's rule too). */
const PAID = new Set(['PAID', 'DISPUTED']);
const RENT_KINDS = new Set(['RENTAL_PERIOD', 'RENTAL_TOTAL']);

/**
 * The period length is inferred from two consecutive rent charges (7 when there is only
 * one): `activeRental` in the profile does not carry the billing frequency.
 */
export function toRentalContext(
  vehicleLabel: string,
  plate: string | null,
  charges: readonly RentalChargeDto[],
  today: string,
  startDate: string | null = null,
): DriverRentalContext | null {
  const rent = charges
    .filter((c) => RENT_KINDS.has(c.kind) && c.dueDate && c.status !== 'CANCELED')
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const next = rent.find((c) => !PAID.has(c.status) && c.dueDate! >= today) ?? null;
  const reference = next ?? rent[rent.length - 1] ?? null;
  let periodDays = 7;
  if (rent.length >= 2) {
    const gap = daysBetween(rent[rent.length - 2].dueDate!, rent[rent.length - 1].dueDate!);
    if (gap > 0) periodDays = gap;
  }
  return {
    vehicleLabel,
    plate,
    periodAmount: reference?.amount ?? 0,
    periodDays,
    startDate,
    nextCharge: next ? { amount: next.amount, dueDate: next.dueDate! } : null,
    charges: rent
      .filter((c) => c.dueDate! >= addDays(today, -400))
      .map((c) => ({ amount: c.amount, dueDate: c.dueDate!, paid: PAID.has(c.status) })),
  };
}
