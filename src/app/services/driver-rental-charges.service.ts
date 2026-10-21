import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { DriverCharge } from '../types/driver-charges.types';

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
}

/** Keeps only what the screen reads; a row without id or amount is dropped, not guessed. */
function toCharge(raw: unknown): DriverCharge | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || typeof r['amount'] !== 'number') return null;
  return {
    id: r['id'],
    kind: r['kind'] as DriverCharge['kind'],
    amount: r['amount'],
    status: r['status'] as DriverCharge['status'],
    dueDate: typeof r['dueDate'] === 'string' ? r['dueDate'] : null,
    periodIndex: typeof r['periodIndex'] === 'number' ? r['periodIndex'] : null,
    paidAt: typeof r['paidAt'] === 'string' ? r['paidAt'] : null,
    checkoutUrl: typeof r['checkoutUrl'] === 'string' && r['checkoutUrl'] ? r['checkoutUrl'] : null,
  };
}

function isCharge(value: DriverCharge | null): value is DriverCharge {
  return value !== null;
}
