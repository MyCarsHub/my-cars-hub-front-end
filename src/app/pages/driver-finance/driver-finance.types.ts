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

/**
 * The expense chips of the UI, with the SERVER's names (`DriverLedgerCategoryEnum`):
 * Pedágio is `TOLL_PARKING` (legacy name), Estacionamento is `PARKING`, Lavagem `CAR_WASH`.
 * The server has more (FOOD, FINE, RENTAL_FEE): they are shown and kept, not offered.
 */
export type ExpenseCategory =
  | 'FUEL'
  | 'CAR_WASH'
  | 'TOLL_PARKING'
  | 'MAINTENANCE'
  | 'PARKING'
  | 'OTHER_EXPENSE';

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

/** Query of `GET /v1/driver/ledger` (domain names; the wire calls `type` `kind`). */
export interface LedgerFilter {
  from?: string;
  to?: string;
  type?: LedgerType;
  category?: LedgerItemCategory;
}

/** The goal itself. `dailyGoal` in cents (wire: `dailyGoalCents`). */
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

// ------------------------------------------------------------------ server aggregates
// Shapes of `/v1/driver/goals`, `/v1/driver/dashboard` and `/v1/driver/calendar`
// (backend feat/driver-finance-api). Every money field is in cents; the adapters in
// `driver-finance.source.ts` turn absent numbers into 0 / null, never NaN.

/** `Progress` of the goals response. */
export interface GoalProgress {
  from: string;
  to: string;
  incomeCents: number;
  goalCents: number;
  /** No ceiling: 150 = goal beaten with room to spare. 0 without a goal. */
  percent: number;
  reached: boolean;
}

/** `GET/PUT /v1/driver/goals`: the goal (null = never configured) plus its progress. */
export interface DriverGoalsState {
  goal: DriverGoals | null;
  today: GoalProgress;
  week: GoalProgress;
  month: GoalProgress;
  /** Monday to Sunday of this week. */
  weekDays: { date: string; incomeCents: number; goalCents: number; reached: boolean }[];
  /** The four complete weeks before this one, OLDEST first (as the server sends them). */
  lastWeeks: GoalProgress[];
}

export interface DriverEfficiency {
  rides: number;
  hours: number;
  km: number;
  avgPerRideCents: number | null;
  perHourCents: number | null;
  perKmCents: number | null;
  profitPerKmCents: number | null;
}

/** `GET /v1/driver/dashboard?from&to`, the fields these screens read. */
export interface DriverDashboardData {
  from: string;
  to: string;
  totals: { incomeCents: number; expenseCents: number; netCents: number; entryCount: number };
  expenseByCategory: { category: string; totalCents: number; entryCount: number }[];
  today: {
    date: string;
    incomeCents: number;
    expenseCents: number;
    rentAccruedCents: number;
    profitCents: number;
    rides: number;
    hours: number;
    km: number;
    avgPerRideCents: number | null;
  };
  /** `null` when the server sent none (or the goals part failed). */
  goals: DriverGoalsState | null;
  efficiency: DriverEfficiency;
  previousEfficiency: DriverEfficiency | null;
  breakdown: { incomeCents: number; expenseCents: number; rentAccruedCents: number; leftCents: number };
  incomeByApp: {
    app: RideApp | null;
    totalCents: number;
    rides: number;
    entryCount: number;
    avgPerRideCents: number | null;
  }[];
  weekdays: {
    /** `isoDay`: 1 = segunda … 7 = domingo. */
    days: { isoDay: number; avgIncomeCents: number; workedDays: number }[];
    bestIsoDay: number | null;
    avgPerWorkedDayCents: number;
  };
  expenseStats: {
    lastOdometerKm: number | null;
    odometerSpanKm: number | null;
    costPerKmCents: number | null;
  };
}

export type CalendarItemType =
  | 'LEDGER_INCOME'
  | 'LEDGER_EXPENSE'
  | 'CHARGE_PAID'
  | 'CHARGE_DUE'
  | 'FINE_DUE';

/** `GET /v1/driver/calendar?month=YYYY-MM`. `days` holds only days with movement. */
export interface DriverCalendarData {
  month: string;
  totals: { incomeCents: number; outflowCents: number; dueCents: number; balanceCents: number };
  days: {
    date: string;
    incomeCents: number;
    outflowCents: number;
    dueCents: number;
    items: {
      id: string;
      type: CalendarItemType;
      /** Ledger category, `RENT` for a charge, the description for a fine. */
      label: string;
      amountCents: number;
      status: string | null;
    }[];
  }[];
}
