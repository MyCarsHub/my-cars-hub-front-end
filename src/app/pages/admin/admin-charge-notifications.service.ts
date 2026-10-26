import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  AsaasNotificationsOverview,
  ChargeEmailResendResult,
  ChargeNotificationDay,
  ChargeNotificationsQuery,
} from '../../types/admin-charge-notifications.types';

const BASE = `${environment.apiUrl}/admin/charge-notifications`;

/**
 * Aba Notificações: se os motoristas estão sendo avisados das cobranças.
 * Sem estado próprio — a página guarda o que mostra, para que um erro num bloco
 * (dia × Asaas) não apague o outro.
 */
@Injectable({ providedIn: 'root' })
export class AdminChargeNotificationsService {
  private readonly http = inject(HttpClient);

  loadDay(query: ChargeNotificationsQuery = {}): Observable<ChargeNotificationDay> {
    let params = new HttpParams();
    if (query.date) params = params.set('date', query.date);
    if (query.companyId) params = params.set('companyId', query.companyId);
    if (query.onlyNotNotified) params = params.set('onlyNotNotified', 'true');
    return this.http.get<ChargeNotificationDay>(BASE, { params });
  }

  loadAsaas(): Observable<AsaasNotificationsOverview> {
    return this.http.get<AsaasNotificationsOverview>(`${BASE}/asaas`);
  }

  resendEmail(chargeId: string): Observable<ChargeEmailResendResult> {
    return this.http.post<ChargeEmailResendResult>(
      `${BASE}/${encodeURIComponent(chargeId)}/resend-email`,
      {},
    );
  }
}
