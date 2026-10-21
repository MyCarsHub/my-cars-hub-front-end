import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { EMPTY, Observable, catchError, expand, map, of, reduce, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DriverProfileService } from '../../services/driver-profile.service';
import { RentalChargeDto } from '../../types/rental.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import { addDays, daysBetween } from './driver-finance.calc';
import {
  DriverFinanceContext,
  DriverGoals,
  DriverRentalContext,
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
 */
@Injectable({ providedIn: 'root', useFactory: () => inject(HttpDriverFinanceSource) })
export abstract class DriverFinanceSource {
  abstract list(filter: LedgerFilter): Observable<LedgerItem[]>;
  /** `true` when the driver has at least one entry of `type`, at any date. */
  abstract hasAny(type: LedgerType): Observable<boolean>;
  abstract create(request: LedgerItemRequest): Observable<LedgerItem>;
  abstract update(id: string, request: LedgerItemRequest): Observable<LedgerItem>;
  abstract remove(id: string): Observable<void>;
  /** `null` when the driver never defined goals. */
  abstract goals(): Observable<DriverGoals | null>;
  abstract saveGoals(goals: DriverGoals): Observable<DriverGoals>;
  abstract context(): Observable<DriverFinanceContext>;
}

const LEDGER = `${environment.apiUrl}/driver/ledger`;
const GOALS = `${environment.apiUrl}/driver/goals`;
const RENTALS = `${environment.apiUrl}/rentals`;

/** The server's ceiling for one page of the ledger (`MAX_PAGE_SIZE`). */
export const LEDGER_PAGE_SIZE = 100;
/** 50 × 100 entries: more than a year of a busy driver; beyond it something is wrong. */
const MAX_PAGES = 50;

/** Another page exists when the last one came full and the total (if sent) is not reached. */
export function hasNextPage(index: number, received: number, total: number | null): boolean {
  if (index + 1 >= MAX_PAGES || received < LEDGER_PAGE_SIZE) return false;
  return total === null || (index + 1) * LEDGER_PAGE_SIZE < total;
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
    const page = (index: number) => {
      let params = new HttpParams()
        .set('page', String(index))
        .set('size', String(LEDGER_PAGE_SIZE));
      if (filter.from) params = params.set('from', filter.from);
      if (filter.to) params = params.set('to', filter.to);
      if (filter.type) params = params.set('type', filter.type);
      if (filter.category) params = params.set('category', filter.category);
      return this.http
        .get<unknown>(LEDGER, { params })
        .pipe(map((res) => ({ index, ...toPage(res) })));
    };
    return page(0).pipe(
      expand((p) => (hasNextPage(p.index, p.received, p.total) ? page(p.index + 1) : EMPTY)),
      reduce((all, p) => all.concat(p.items), [] as LedgerItem[]),
    );
  }

  hasAny(type: LedgerType): Observable<boolean> {
    const params = new HttpParams().set('type', type).set('page', '0').set('size', '1');
    return this.http.get<unknown>(LEDGER, { params }).pipe(map((res) => toItems(res).length > 0));
  }

  create(request: LedgerItemRequest): Observable<LedgerItem> {
    return this.http.post<unknown>(LEDGER, request).pipe(map(itemOrFail));
  }

  update(id: string, request: LedgerItemRequest): Observable<LedgerItem> {
    return this.http
      .put<unknown>(`${LEDGER}/${encodeURIComponent(id)}`, request)
      .pipe(map(itemOrFail));
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${LEDGER}/${encodeURIComponent(id)}`);
  }

  goals(): Observable<DriverGoals | null> {
    return this.http.get<unknown>(GOALS).pipe(map(toGoals));
  }

  saveGoals(goals: DriverGoals): Observable<DriverGoals> {
    return this.http
      .put<unknown>(GOALS, goals)
      .pipe(map((res) => toGoals(res) ?? goals));
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

// ---------------------------------------------------------------- adapters

/** Reads the TARGET contract and, as a fallback, the ledger keys in production today. */
export function toItem(raw: unknown): LedgerItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = r['id'];
  const type = (r['type'] ?? r['kind']) as LedgerType | undefined;
  const amount = Number(r['amount'] ?? r['amountCents']);
  const date = String(r['date'] ?? r['occurredOn'] ?? '');
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
    category: String(r['category'] ?? (type === 'INCOME' ? 'RIDES' : 'OTHER')),
    amount: Math.round(amount),
    app: (r['app'] as RideApp | null | undefined) ?? null,
    rides: num('rides'),
    hours: num('hours'),
    km: num('km'),
    odometerKm: num('odometerKm'),
    notes: (r['notes'] ?? r['description'] ?? null) as string | null,
    rentalId: r['rentalId'] === null || r['rentalId'] === undefined ? null : String(r['rentalId']),
  };
}

function toPage(res: unknown): { items: LedgerItem[]; received: number; total: number | null } {
  const raw = Array.isArray(res) ? res : ((res as { content?: unknown[] } | null)?.content ?? []);
  const total = Array.isArray(res) ? null : Number((res as { total?: unknown } | null)?.total);
  return {
    items: raw.map(toItem).filter((x): x is LedgerItem => x !== null),
    received: Array.isArray(res) ? 0 : raw.length,
    total: total !== null && Number.isFinite(total) ? total : null,
  };
}

function toItems(res: unknown): LedgerItem[] {
  const list = Array.isArray(res)
    ? res
    : ((res as { content?: unknown[] } | null)?.content ?? []);
  return list.map(toItem).filter((x): x is LedgerItem => x !== null);
}

function itemOrFail(raw: unknown): LedgerItem {
  const item = toItem(raw);
  if (!item) throw new Error('Resposta inválida do servidor ao salvar o lançamento.');
  return item;
}

function toGoals(raw: unknown): DriverGoals | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const dailyGoal = Number(r['dailyGoal']);
  const workDaysPerWeek = Number(r['workDaysPerWeek']);
  if (!Number.isFinite(dailyGoal) || dailyGoal <= 0) return null;
  return {
    dailyGoal: Math.round(dailyGoal),
    workDaysPerWeek: Number.isFinite(workDaysPerWeek) && workDaysPerWeek >= 1 ? workDaysPerWeek : 6,
  };
}

const PAID = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'PAID']);
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
