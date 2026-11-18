import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import type {
  PlatformCost,
  PlatformCostRequest,
  PlatformVendor,
  PlatformVendorRequest,
} from '../../../types/admin-finance.types';

const BASE = `${environment.apiUrl}/admin/finance`;

/**
 * Fornecedores e custos mensais da plataforma. Sem estado: a Visão geral guarda as respostas e
 * recarrega depois de cada lançamento.
 */
@Injectable({ providedIn: 'root' })
export class AdminFinanceService {
  private readonly http = inject(HttpClient);

  vendors(): Observable<PlatformVendor[]> {
    return this.http.get<PlatformVendor[]>(`${BASE}/vendors`);
  }

  createVendor(body: PlatformVendorRequest): Observable<PlatformVendor> {
    return this.http.post<PlatformVendor>(`${BASE}/vendors`, body);
  }

  updateVendor(id: string, body: PlatformVendorRequest): Observable<PlatformVendor> {
    return this.http.put<PlatformVendor>(`${BASE}/vendors/${encodeURIComponent(id)}`, body);
  }

  /** `from`/`to` = `yyyy-MM`, inclusive (o servidor aceita até 60 meses). */
  costs(from: string, to: string): Observable<PlatformCost[]> {
    return this.http.get<PlatformCost[]>(`${BASE}/costs`, {
      params: new HttpParams().set('from', from).set('to', to),
    });
  }

  /** Lança ou corrige UM mês de UM fornecedor. */
  setCost(vendorId: string, month: string, body: PlatformCostRequest): Observable<PlatformCost> {
    return this.http.put<PlatformCost>(
      `${BASE}/vendors/${encodeURIComponent(vendorId)}/costs/${encodeURIComponent(month)}`,
      body,
    );
  }
}
