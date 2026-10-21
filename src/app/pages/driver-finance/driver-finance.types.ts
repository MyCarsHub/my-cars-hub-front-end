/**
 * Types of the driver's finance screens (Dashboard, Ganhos, Custos, Metas).
 *
 * TARGET CONTRACT — `/v1/driver/ledger` (extended) and `/v1/driver/goals` (new). The backend
 * is being aligned to it; the HTTP source (`driver-finance.source.ts`) also reads the older
 * wire keys (`kind`, `amountCents`, `occurredOn`, `description`) so a list still renders
 * against the ledger that is in production today.
 *
 * Money is ALWAYS integer cents. Dates are ISO `yyyy-MM-dd` in the business time zone.
 */

export type LedgerType = 'INCOME' | 'EXPENSE';

export type RideApp = 'UBER' | '99' | 'INDRIVE' | 'OUTRO';

export type ExpenseCategory = 'FUEL' | 'WASH' | 'TOLL' | 'MAINTENANCE' | 'PARKING' | 'OTHER';

/** Income has one category today; the field exists so the wire shape is one for both types. */
export type IncomeCategory = 'RIDES';

export type LedgerItemCategory = IncomeCategory | ExpenseCategory;

/** One row of `GET /v1/driver/ledger`. */
export interface LedgerItem {
  id: string;
  date: string;
  type: LedgerType;
  /**
   * Kept as the server sent it: a category this UI has no chip for (an entry made on another
   * screen) must survive an edit untouched, never be coerced to a UI value.
   */
  category: string;
  /** Cents. Always positive: the `type` carries the sign. */
  amount: number;
  app: RideApp | null;
  rides: number | null;
  hours: number | null;
  km: number | null;
  /** Odometer reading the driver typed with an expense. */
  odometerKm: number | null;
  notes: string | null;
  /** Rental the entry is tied to; an edit sends it back unchanged. */
  rentalId: string | null;
}

/** Body of `POST` and `PUT /v1/driver/ledger[/{id}]`. */
export type LedgerItemRequest = Omit<LedgerItem, 'id'>;

/** Query of `GET /v1/driver/ledger`. Every key is optional. */
export interface LedgerFilter {
  from?: string;
  to?: string;
  type?: LedgerType;
  category?: LedgerItemCategory;
}

/** `GET/PUT /v1/driver/goals`. `dailyGoal` in cents; `null` goal = never defined. */
export interface DriverGoals {
  dailyGoal: number;
  workDaysPerWeek: number;
}

/** What the dashboard knows about the driver's active rental (none = `null`). */
export interface DriverRentalContext {
  vehicleLabel: string;
  plate: string | null;
  /** Amount of one billing period, in cents (the next charge's amount). */
  periodAmount: number;
  /** Length of one billing period in days (7 for a weekly rental). */
  periodDays: number;
  /** First day of the contract: no rent is debited before it. */
  startDate: string | null;
  /** Next open charge, if the server has one. */
  nextCharge: { amount: number; dueDate: string } | null;
  /** Charges due inside the dashboard window, for the calendar. */
  charges: { amount: number; dueDate: string; paid: boolean }[];
}

/** Everything the dashboard reads besides the ledger and the goals. */
export interface DriverFinanceContext {
  firstName: string | null;
  rental: DriverRentalContext | null;
  /** `yyyy-MM-dd`; drives the "CNH a vencer" alert. */
  licenseExpiry: string | null;
}

/** The four states every list exposes. */
export type LoadState = 'loading' | 'error' | 'ready';
