import { DriverCharge, DriverChargeGroups } from '../types/driver-charges.types';
import { effectiveChargeStatus } from '../types/rental.types';

/** What the driver reads for each kind. Short, no jargon; "Aluguel" covers period and total. */
export function driverChargeKindLabel(kind: DriverCharge['kind']): string {
  switch (kind) {
    case 'CAUCAO':
      return 'Caução';
    case 'OVERDUE_FEE':
      return 'Multa por atraso';
    default:
      return 'Aluguel';
  }
}

/**
 * The calendar day (`yyyy-MM-dd`) of a `paidAt`, or `null`.
 *
 * The backend sends `paidAt` as a `LocalDateTime`: no offset, so there is no instant to
 * convert and no timezone to convert it to. The date part is taken AS IS — the same reading
 * the operator's screen gives it. Which zone the JVM wrote it in is an open observation, not
 * something this function can fix; if it turns out not to be Brasilia, the day shown here
 * (and there) is the one to revisit.
 */
export function paidDayOf(paidAt: string | null): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(paidAt ?? '');
  return match ? match[1] : null;
}

/**
 * Splits the charges by what the driver has to do about them.
 *
 * - Overdue: PAST_DUE from the server, or PENDING already past its due date (the same
 *   derivation the operator's screen uses, so the two never disagree on "atrasada").
 * - Unpaid and not overdue: the first is `next`; a charge with no due date comes first (the
 *   caução, which has to be paid before anything else).
 * - History: PAID and REFUNDED. FAILED, CANCELED, RELEASED and DISPUTED are the operator's
 *   business and have nothing the driver can act on, so they are not drawn.
 *
 * `today` is passed in, never read here, so one screen has one clock.
 */
export function groupDriverCharges(charges: DriverCharge[], today: string): DriverChargeGroups {
  const overdue: DriverCharge[] = [];
  const waiting: DriverCharge[] = [];
  const history: DriverCharge[] = [];

  for (const charge of charges) {
    const status = effectiveChargeStatus(charge, today);
    if (status === 'PAST_DUE') overdue.push(charge);
    else if (status === 'PENDING') waiting.push(charge);
    else if (status === 'PAID' || status === 'REFUNDED') history.push(charge);
  }

  overdue.sort(byDueDate);
  waiting.sort(byDueDate);
  history.sort((a, b) => (b.paidAt ?? '').localeCompare(a.paidAt ?? ''));

  return { overdue, next: waiting[0] ?? null, upcoming: waiting.slice(1), history };
}

/**
 * The driver's FAILED charges that are already past their due date (a charge with no due date
 * is not "late" for him). The landlord is regularising them, so the screen only says so: no
 * pay button, no link, and never the word "falha". Only the due date decides, never `today`
 * read here.
 */
export function regularizingCharges(charges: DriverCharge[], today: string): DriverCharge[] {
  return charges.filter(
    (c) => c.status === 'FAILED' && c.dueDate !== null && c.dueDate < today,
  );
}

/** No date first, then the earliest. Equal dates keep the server's order (the sort is stable). */
function byDueDate(a: DriverCharge, b: DriverCharge): number {
  if (a.dueDate === b.dueDate) return 0;
  if (!a.dueDate) return -1;
  if (!b.dueDate) return 1;
  return a.dueDate.localeCompare(b.dueDate);
}
