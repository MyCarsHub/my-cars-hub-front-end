import { ChargeKind, ChargeStatus } from './rental.types';

/**
 * One charge as `GET /v1/rentals/{rentalId}/charges` returns it to a DRIVER.
 *
 * It is deliberately NOT the operator's `RentalChargeDto`: the server leaves out the gateway
 * ids, the provider, the failure codes and the operator's notes, and this type has no field
 * to hold them. Money is in cents; `dueDate` is `yyyy-MM-dd`; `paidAt` is an instant.
 *
 * `checkoutUrl` is the gateway's invoice page (QR Pix and copy-and-paste). It only comes on a
 * charge that can still be paid (PENDING / PAST_DUE) and it is an EXTERNAL link, not a
 * document of ours.
 */
export interface DriverCharge {
  id: string;
  kind: ChargeKind;
  amount: number;
  status: ChargeStatus;
  dueDate: string | null;
  periodIndex: number | null;
  paidAt: string | null;
  checkoutUrl: string | null;
}

/** What the screen draws, already sorted and split by what the driver has to do about it. */
export interface DriverChargeGroups {
  /** Past the due date and still unpaid: red, "Pagar agora". Oldest first. */
  overdue: DriverCharge[];
  /** The one to pay next: big value, big button. `null` when nothing is waiting. */
  next: DriverCharge | null;
  /** The other unpaid ones, after `next`. */
  upcoming: DriverCharge[];
  /** Paid (and refunded) ones, most recent first. */
  history: DriverCharge[];
}
