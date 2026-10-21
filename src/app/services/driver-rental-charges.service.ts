import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { DriverCharge, DriverChargePix } from '../types/driver-charges.types';
import { ChargeStatus } from '../types/rental.types';

const RENTALS = `${environment.apiUrl}/rentals`;

/**
 * HTTP port of the DRIVER's own view of a rental's charges.
 *
 * Stateless on purpose: the screen that asks owns the signals. The endpoint answers only for
 * the caller's own rental (anyone else's is a 404), so the client never sends a driver id.
 * It is NOT the `charges` the rental detail carries for the operator — that one has fields
 * a driver must not see.
 */
@Injectable({ providedIn: 'root' })
export class DriverRentalChargesService {
  private readonly http = inject(HttpClient);

  list(rentalId: string): Observable<DriverCharge[]> {
    return this.http
      .get<unknown>(`${RENTALS}/${encodeURIComponent(rentalId)}/charges`)
      .pipe(map((res) => (Array.isArray(res) ? res.map(toCharge).filter(isCharge) : [])));
  }

  /**
   * The Pix "copia e cola" of one open charge. A body without a usable `payload` is an
   * error, not an empty code: the screen must never offer to copy nothing.
   */
  pix(rentalId: string, chargeId: string): Observable<DriverChargePix> {
    return this.http
      .get<unknown>(
        `${RENTALS}/${encodeURIComponent(rentalId)}/charges/${encodeURIComponent(chargeId)}/pix`,
      )
      .pipe(map(toPix));
  }
}

function toPix(raw: unknown): DriverChargePix {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const payload = typeof r['payload'] === 'string' ? r['payload'].trim() : '';
  if (!payload) throw new Error('Pix sem código');
  return {
    payload,
    qrCodeBase64: typeof r['qrCodeBase64'] === 'string' ? r['qrCodeBase64'] : null,
    expiresAt: typeof r['expiresAt'] === 'string' ? r['expiresAt'] : null,
  };
}

const STATUSES: readonly ChargeStatus[] = [
  'PENDING',
  'PAST_DUE',
  'PAID',
  'FAILED',
  'CANCELED',
  'REFUNDED',
  'RELEASED',
  'DISPUTED',
];

/** The payment link opens in the driver's browser: only https, never http, `javascript:` and co. */
function safeLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** Keeps only what the screen reads; a row without id or amount is dropped, not guessed. */
function toCharge(raw: unknown): DriverCharge | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || typeof r['amount'] !== 'number') return null;
  const knownStatus = STATUSES.find((s) => s === r['status']) ?? null;
  return {
    id: r['id'],
    kind: r['kind'] as DriverCharge['kind'],
    amount: r['amount'],
    status: knownStatus ?? 'PENDING',
    dueDate: typeof r['dueDate'] === 'string' ? r['dueDate'] : null,
    periodIndex: typeof r['periodIndex'] === 'number' ? r['periodIndex'] : null,
    paidAt: typeof r['paidAt'] === 'string' ? r['paidAt'] : null,
    // A status this build does not know is an OPEN charge with no button: it stays on the
    // screen (the driver still owes it) but nothing here can say how to pay it.
    checkoutUrl: knownStatus ? safeLink(r['checkoutUrl']) : null,
  };
}

function isCharge(value: DriverCharge | null): value is DriverCharge {
  return value !== null;
}
