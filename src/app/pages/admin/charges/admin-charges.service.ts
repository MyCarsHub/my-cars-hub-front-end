import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  AdminChargeTab,
  AdminChargesPage,
  TrialConversionItem,
} from '../../../types/admin-charges.types';

/**
 * Leituras do admin v2 P0 trilha B: Cobranças e "Converter testes". Só GET —
 * nenhuma ação de reemitir ou re-datar existe aqui, de propósito.
 */
@Injectable({ providedIn: 'root' })
export class AdminChargesService {
  private readonly http = inject(HttpClient);

  list(tab: AdminChargeTab, includeInternal: boolean, page = 0, size = 20): Observable<AdminChargesPage> {
    const params = new HttpParams()
      .set('tab', tab)
      .set('includeInternal', String(includeInternal))
      .set('page', String(page))
      .set('size', String(size));
    return this.http.get<AdminChargesPage>(`${environment.apiUrl}/admin/charges`, { params });
  }

  trialConversion(includeInternal: boolean): Observable<TrialConversionItem[]> {
    const params = new HttpParams().set('includeInternal', String(includeInternal));
    return this.http.get<TrialConversionItem[]>(`${environment.apiUrl}/admin/trial-conversion`, {
      params,
    });
  }
}
