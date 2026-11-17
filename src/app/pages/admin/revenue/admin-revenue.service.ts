import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AdminRevenue, AdminRevenuePeriod } from '../../../types/admin-revenue.types';

/**
 * Receita da plataforma para a Visão geral do admin. Sem estado: quem chama guarda a resposta e
 * cancela a anterior ao trocar de período, para um período nunca aparecer sob a pílula de outro.
 */
@Injectable({ providedIn: 'root' })
export class AdminRevenueService {
  private readonly http = inject(HttpClient);

  fetch(period: AdminRevenuePeriod): Observable<AdminRevenue> {
    return this.http.get<AdminRevenue>(`${environment.apiUrl}/admin/billing/revenue`, {
      params: new HttpParams().set('period', period),
    });
  }
}
