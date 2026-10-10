/**
 * Types of the DRIVER's own area: the personal ledger (ganhos e custos), the dashboard that
 * summarises it, and the driver's own record.
 *
 * Wire keys are the backend's (`/v1/driver/**`). Money is in cents (integer), dates are ISO
 * `yyyy-MM-dd` — the same conventions as the fleet Dashboard.
 *
 * The ledger is the DRIVER's own bookkeeping. It is not a rental charge and it never touches
 * the company's finances: nothing here is read by, or written into, the fleet Dashboard.
 */

export type LedgerKind = 'INCOME' | 'EXPENSE';

export type IncomeCategory = 'RIDES' | 'DELIVERIES' | 'OTHER_INCOME';

export type ExpenseCategory =
  | 'FUEL'
  | 'MAINTENANCE'
  | 'RENTAL_FEE'
  | 'FINE'
  | 'FOOD'
  | 'TOLL_PARKING'
  | 'OTHER_EXPENSE';

export type LedgerCategory = IncomeCategory | ExpenseCategory;

/**
 * One row of the ledger, as `GET /v1/driver/ledger` returns it
 * (`DriverLedgerEntryResponseDto`; the audit timestamps are not read by any screen).
 */
export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  category: LedgerCategory;
  amountCents: number;
  /** `yyyy-MM-dd`. The day the money moved, never a timestamp. */
  occurredOn: string;
  description: string | null;
  /** The rental the entry is tied to, or `null` for a plain entry. */
  rentalId: string | null;
}

/**
 * Body of `POST /v1/driver/ledger` and `PUT /v1/driver/ledger/{id}` — the PUT replaces the
 * whole entry, so an edit sends the same six fields as a creation. There is no driver or
 * company id on purpose: who the driver is comes from the token.
 */
export interface LedgerEntryRequest {
  kind: LedgerKind;
  category: LedgerCategory;
  amountCents: number;
  occurredOn: string;
  description: string | null;
  rentalId: string | null;
}

/** Filters of `GET /v1/driver/ledger`. Every one is optional; the list is paged. */
export interface LedgerListQuery {
  from?: string | null;
  to?: string | null;
  kind?: LedgerKind | null;
  category?: LedgerCategory | null;
  rentalId?: string | null;
  page?: number;
  size?: number;
}

/** `totals` of the dashboard. */
export interface DriverTotals {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  entryCount: number;
}

/** `previousPeriod`: the window right before `from..to`, same length (or the previous month). */
export interface DriverPreviousPeriod extends DriverTotals {
  from: string | null;
  to: string | null;
}

/** One row of `incomeByCategory` / `expenseByCategory`, flattened with its `kind`. */
export interface DriverCategoryTotal {
  kind: LedgerKind;
  category: LedgerCategory;
  totalCents: number;
  entryCount: number;
}

export interface DriverSeriesPoint {
  /** First day of the bucket (the day, or the Monday of the week). */
  periodStart: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

/** The rental the driver is in right now (`ActiveRentalSummaryDto`). */
export interface DriverActiveRental {
  rentalId: string;
  vehicleId: string | null;
  plate: string | null;
  brand: string | null;
  model: string | null;
  startDate: string | null;
  endDate: string | null;
}

/** `GET /v1/driver/dashboard?from=&to=`. */
export interface DriverDashboard {
  from: string;
  to: string;
  totals: DriverTotals;
  previousPeriod: DriverPreviousPeriod;
  byCategory: DriverCategoryTotal[];
  /** `DAY` up to 31 days, `WEEK` (ISO weeks) beyond. */
  granularity: 'DAY' | 'WEEK';
  series: DriverSeriesPoint[];
  activeRental: DriverActiveRental | null;
}

/** Same shape as the company-side `AddressDto`: the CEP may come with or without the hyphen. */
export interface DriverAddress {
  street: string;
  number: string | null;
  complement: string | null;
  district: string;
  cep: string;
  city: string;
  uf: string;
}

/**
 * `GET /v1/driver/profile` (`DriverProfileResponseDto`). Name, e-mail, document and CNH are
 * read-only for the driver: the company that registered him owns them.
 */
export interface DriverProfileData {
  driverId: string | null;
  name: string;
  status: string | null;
  registrationStatus: 'COMPLETE' | 'PENDING_ONBOARDING' | null;
  documentType: 'CPF' | 'CNPJ';
  /** Masked by the server (`***.***.***-12`); the client masks again defensively. */
  documentMasked: string;
  email: string | null;
  /** Digits only, as stored. Empty when the company never registered one. */
  phone: string;
  licenseCategory: string | null;
  licenseExpiry: string | null;
  /** `null` for a registration still PENDING_ONBOARDING. */
  address: DriverAddress | null;
  companyId: string | null;
  companyName: string | null;
  activeRental: DriverActiveRental | null;
}

/**
 * Body of `PUT /v1/driver/profile` — the only two things a driver edits about himself.
 * Phone is DIGITS ONLY (10 or 11); an absent field is "leave as is" on the server.
 */
export interface DriverProfileUpdate {
  phone: string;
  /** Omitted when the driver has no address and typed none: the server leaves it as is. */
  address?: DriverAddress;
}
