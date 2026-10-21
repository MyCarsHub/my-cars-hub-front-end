import { Observable, of, throwError } from 'rxjs';
import { DriverFinanceSource } from './driver-finance.source';
import { simulateCalendar, simulateDashboard, simulateGoals } from './driver-finance.simulator';
import {
  DriverCalendarData,
  DriverDashboardData,
  DriverFinanceContext,
  DriverGoals,
  DriverGoalsState,
  LedgerFilter,
  LedgerItem,
  LedgerItemRequest,
  LedgerType,
} from './driver-finance.types';

/** Test double of `DriverFinanceSource`: synchronous, recording every write. */
export class FakeFinanceSource extends DriverFinanceSource {
  items: LedgerItem[] = [];
  goalsValue: DriverGoals | null = { dailyGoal: 30000, workDaysPerWeek: 6 };
  contextValue: DriverFinanceContext = { firstName: 'Carlos', licenseExpiry: null, rental: null };
  /** `'error'` makes every read fail; `'never'` keeps every read pending. */
  mode: 'ok' | 'error' | 'never' = 'ok';
  created: LedgerItemRequest[] = [];
  updated: { id: string; request: LedgerItemRequest }[] = [];
  removed: string[] = [];
  savedGoals: DriverGoals[] = [];
  /** Fail only one read, after the screen loaded (goals, or a later window of the ledger). */
  failGoals = false;
  failList = false;
  /** Error a write returns (an `HttpErrorResponse` to exercise the message). */
  writeError: unknown = null;
  listCalls: LedgerFilter[] = [];

  private read<T>(value: T): Observable<T> {
    if (this.mode === 'error') return throwError(() => new Error('boom'));
    if (this.mode === 'never') return new Observable<T>(() => undefined);
    return of(value);
  }

  list(filter: LedgerFilter): Observable<LedgerItem[]> {
    this.listCalls.push(filter);
    if (this.failList) return throwError(() => new Error('list'));
    return this.read(
      this.items.filter(
        (i) =>
          (!filter.from || i.date >= filter.from) &&
          (!filter.to || i.date <= filter.to) &&
          (!filter.type || i.type === filter.type),
      ),
    );
  }

  hasAny(type: LedgerType): Observable<boolean> {
    return this.read(this.items.some((i) => i.type === type));
  }

  create(request: LedgerItemRequest): Observable<LedgerItem> {
    if (this.writeError) return throwError(() => this.writeError);
    this.created.push(request);
    const item = { ...request, id: `new-${this.created.length}` };
    this.items = [item, ...this.items];
    return of(item);
  }

  update(id: string, request: LedgerItemRequest): Observable<LedgerItem> {
    this.updated.push({ id, request });
    return of({ ...request, id });
  }

  remove(id: string): Observable<void> {
    this.removed.push(id);
    this.items = this.items.filter((i) => i.id !== id);
    return of(undefined);
  }

  /** "Hoje" of the simulated server. */
  today = TODAY;

  goals(): Observable<DriverGoalsState> {
    if (this.failGoals) return throwError(() => new Error('goals'));
    return this.read(simulateGoals(this.items, this.goalsValue, this.today));
  }

  saveGoals(goals: DriverGoals): Observable<DriverGoalsState> {
    this.savedGoals.push(goals);
    this.goalsValue = goals;
    return of(simulateGoals(this.items, goals, this.today));
  }

  dashboardCalls: { from: string; to: string }[] = [];

  /** With `failGoals` the dashboard comes without its goals part. */
  dashboard(from: string, to: string): Observable<DriverDashboardData> {
    this.dashboardCalls.push({ from, to });
    if (this.failList) return throwError(() => new Error('dashboard'));
    const data = simulateDashboard(this.items, from, to, this.today, this.contextValue.rental, this.goalsValue);
    return this.read(this.failGoals ? { ...data, goals: null } : data);
  }

  calendar(month: string): Observable<DriverCalendarData> {
    if (this.failList) return throwError(() => new Error('calendar'));
    return this.read(simulateCalendar(this.items, this.contextValue.rental, month));
  }

  context(): Observable<DriverFinanceContext> {
    return this.read(this.contextValue);
  }
}

export const TODAY = '2026-10-10';

export function income(over: Partial<LedgerItem> = {}): LedgerItem {
  return {
    id: 'g1',
    date: TODAY,
    type: 'INCOME',
    category: 'RIDES',
    amount: 18640,
    app: 'UBER',
    rides: 9,
    hours: 6.5,
    km: 112,
    odometerKm: null,
    notes: null,
    rentalId: null,
    ...over,
  };
}

export function expense(over: Partial<LedgerItem> = {}): LedgerItem {
  return {
    id: 'c1',
    date: TODAY,
    type: 'EXPENSE',
    category: 'FUEL',
    amount: 12000,
    app: null,
    rides: null,
    hours: null,
    km: null,
    odometerKm: 48320,
    notes: null,
    rentalId: null,
    ...over,
  };
}
