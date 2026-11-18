import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import type { AdminHomeRange } from '../../../types/admin-home.types';
import { AdminRevenue } from '../../../types/admin-revenue.types';
import { rangeParams } from '../home/admin-home.service';

/**
 * Receita da plataforma para a Visão geral do admin, no período da tela (`from`/`to`, contrato
 * `changed:` 18/11). Sem estado: quem chama guarda a resposta e cancela a anterior ao trocar de
 * período, para um período nunca aparecer sob as datas de outro.
 */
@Injectable({ providedIn: 'root' })
export class AdminRevenueService {
  private readonly http = inject(HttpClient);

  fetch(range: AdminHomeRange): Observable<AdminRevenue> {
    return this.http.get<AdminRevenue>(`${environment.apiUrl}/admin/billing/revenue`, {
      params: rangeParams(range),
    });
  }
}
