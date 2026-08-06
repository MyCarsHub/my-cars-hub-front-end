import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface NotificationTestResponse {
  to: string;
  dispatched: string[];
  count: number;
}

/** Resposta de `POST /admin/rentals/{id}/regenerate-schedule` (AdminRentalScheduleController). */
export interface RegenerateScheduleResponse {
  rentalId: string;
  /** Cobranças materializadas agora. `0` significa cronograma já completo (operação idempotente). */
  inserted: number;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  testNotifications(email: string): Observable<NotificationTestResponse> {
    const url = `${environment.apiUrl}/admin/notifications/test?email=${encodeURIComponent(email)}`;
    return this.http.post<NotificationTestResponse>(url, null);
  }

  /** Ação operacional: reconstrói o cronograma de cobrança de um aluguel. Idempotente. */
  regenerateRentalSchedule(rentalId: string): Observable<RegenerateScheduleResponse> {
    const url = `${environment.apiUrl}/admin/rentals/${encodeURIComponent(rentalId)}/regenerate-schedule`;
    return this.http.post<RegenerateScheduleResponse>(url, null);
  }
}
