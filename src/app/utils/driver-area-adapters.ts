import {
  DriverActiveRental,
  DriverAddress,
  DriverCategoryTotal,
  DriverDashboard,
  DriverPreviousPeriod,
  DriverProfileData,
  DriverSeriesPoint,
  DriverTotals,
  LedgerCategory,
  LedgerEntry,
  LedgerKind,
} from '../types/driver-ledger.types';

/**
 * The seam between the `/v1/driver/**` wire shape and what the screens read.
 *
 * Every read in the driver's area goes through ONE function here, mirroring the backend's
 * `driver_area` DTOs (`DriverDashboardResponseDto`, `DriverLedgerEntryResponseDto`,
 * `DriverProfileResponseDto`, `ActiveRentalSummaryDto`). When a DTO changes, the
 * adaptation is a change in this file and in `types/driver-ledger.types.ts`, not a hunt
 * through three pages.
 *
 * The readers are lenient about NUMBERS and LISTS (an absent number is zero, an absent
 * list is empty) so a partial response paints a screen instead of crashing it. They are
 * strict about IDENTITY: an entry without an id, a kind or a category is dropped rather
 * than invented — a row the driver cannot edit or delete is worse than a missing row.
 */

type Raw = Record<string, unknown>;

function isRaw(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function toKind(value: unknown): LedgerKind | null {
  return value === 'INCOME' || value === 'EXPENSE' ? value : null;
}

export function toLedgerEntry(raw: unknown): LedgerEntry | null {
  if (!isRaw(raw)) return null;
  const id = str(raw['id']);
  const kind = toKind(raw['kind']);
  const category = str(raw['category']);
  const occurredOn = str(raw['occurredOn']);
  if (!id || !kind || !category || !occurredOn) return null;
  return {
    id,
    kind,
    category: category as LedgerCategory,
    amountCents: num(raw['amountCents']),
    occurredOn,
    description: str(raw['description']),
    rentalId: str(raw['rentalId']),
  };
}

function toTotals(raw: unknown): DriverTotals {
  const r = isRaw(raw) ? raw : {};
  const income = num(r['incomeCents']);
  const expense = num(r['expenseCents']);
  return {
    incomeCents: income,
    expenseCents: expense,
    // The server sends the net; deriving it is the fallback for a response that dropped it.
    netCents: typeof r['netCents'] === 'number' ? num(r['netCents']) : income - expense,
    entryCount: num(r['entryCount']),
  };
}

function toPreviousPeriod(raw: unknown): DriverPreviousPeriod {
  const r = isRaw(raw) ? raw : {};
  return { ...toTotals(r), from: str(r['from']), to: str(r['to']) };
}

function toCategoryRows(raw: unknown, kind: LedgerKind): DriverCategoryTotal[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): DriverCategoryTotal[] => {
    if (!isRaw(row)) return [];
    const category = str(row['category']);
    if (!category) return [];
    return [
      {
        kind,
        category: category as LedgerCategory,
        totalCents: num(row['totalCents']),
        entryCount: num(row['entryCount']),
      },
    ];
  });
}

function toSeries(raw: unknown): DriverSeriesPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): DriverSeriesPoint[] => {
    if (!isRaw(row)) return [];
    const periodStart = str(row['periodStart']);
    if (!periodStart) return [];
    const income = num(row['incomeCents']);
    const expense = num(row['expenseCents']);
    return [
      {
        periodStart,
        incomeCents: income,
        expenseCents: expense,
        netCents: typeof row['netCents'] === 'number' ? num(row['netCents']) : income - expense,
      },
    ];
  });
}

export function toActiveRental(raw: unknown): DriverActiveRental | null {
  if (!isRaw(raw)) return null;
  const rentalId = str(raw['rentalId']);
  if (!rentalId) return null;
  return {
    rentalId,
    vehicleId: str(raw['vehicleId']),
    plate: str(raw['plate']),
    brand: str(raw['brand']),
    model: str(raw['model']),
    startDate: str(raw['startDate']),
    endDate: str(raw['endDate']),
  };
}

export function toDriverDashboard(raw: unknown, fallbackFrom = '', fallbackTo = ''): DriverDashboard {
  const r = isRaw(raw) ? raw : {};
  return {
    from: str(r['from']) ?? fallbackFrom,
    to: str(r['to']) ?? fallbackTo,
    totals: toTotals(r['totals']),
    previousPeriod: toPreviousPeriod(r['previousPeriod']),
    byCategory: [
      ...toCategoryRows(r['incomeByCategory'], 'INCOME'),
      ...toCategoryRows(r['expenseByCategory'], 'EXPENSE'),
    ],
    granularity: r['granularity'] === 'WEEK' ? 'WEEK' : 'DAY',
    series: toSeries(r['series']),
    activeRental: toActiveRental(r['activeRental']),
  };
}

function toAddress(raw: unknown): DriverAddress | null {
  if (!isRaw(raw)) return null;
  return {
    street: str(raw['street']) ?? '',
    number: str(raw['number']),
    complement: str(raw['complement']),
    district: str(raw['district']) ?? '',
    cep: str(raw['cep']) ?? '',
    city: str(raw['city']) ?? '',
    uf: (str(raw['uf']) ?? '').toUpperCase(),
  };
}

/**
 * A document that arrives with its digits showing is masked here too. The server is the
 * first line (`documentMasked` is the contract and "the raw number does not leave this
 * route"); this is the second: a regression there must not put a full CPF on a phone
 * screen.
 */
export function maskDocumentForDisplay(value: string | null | undefined): string {
  if (!value) return '—';
  if (/[*•]/.test(value)) return value;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) return `***.***.***-${digits.slice(9)}`;
  if (digits.length === 14) return `**.***.***/****-${digits.slice(12)}`;
  return value;
}

export function toDriverProfile(raw: unknown): DriverProfileData {
  const r = isRaw(raw) ? raw : {};
  const registration = r['registrationStatus'];
  return {
    driverId: str(r['driverId']),
    name: str(r['name']) ?? '',
    status: str(r['status']),
    registrationStatus:
      registration === 'COMPLETE' || registration === 'PENDING_ONBOARDING' ? registration : null,
    documentType: r['documentType'] === 'CNPJ' ? 'CNPJ' : 'CPF',
    documentMasked: maskDocumentForDisplay(str(r['documentMasked'])),
    email: str(r['email']),
    phone: (str(r['phone']) ?? '').replace(/\D/g, ''),
    licenseCategory: str(r['licenseCategory']),
    licenseExpiry: str(r['licenseExpiry']),
    address: toAddress(r['address']),
    companyId: str(r['companyId']),
    companyName: str(r['companyName']),
    activeRental: toActiveRental(r['activeRental']),
  };
}
