import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import type { AdminCompanyListItem } from '../../../types/admin-company.types';
import type {
  AdminHome,
  AdminHomePeriod,
  AdminHomeScope,
  AdminUpcoming,
  AdminUsage,
  CompanySort,
  MovementGroup,
  PlatformMovement,
} from '../../../types/admin-home.types';
import type { PagedResponse } from '../../../types/paged.types';

const API = environment.apiUrl;

/**
 * Visão geral do admin v2 (contrato `2026-11-17_CONTRACT_admin-home.md`). Sem estado: cada bloco
 * guarda a sua resposta e cancela a anterior (switchMap) quando o período ou o escopo mudam, para
 * um número de "30 dias" nunca aparecer sob "12 meses".
 */
@Injectable({ providedIn: 'root' })
export class AdminHomeService {
  private readonly http = inject(HttpClient);

  home(period: AdminHomePeriod, scope: AdminHomeScope): Observable<AdminHome> {
    return this.http.get<AdminHome>(`${API}/admin/metrics/home`, {
      params: new HttpParams().set('period', period).set('scope', scope),
    });
  }

  usage(period: AdminHomePeriod, scope: AdminHomeScope): Observable<AdminUsage> {
    return this.http.get<AdminUsage>(`${API}/admin/metrics/usage`, {
      params: new HttpParams().set('period', period).set('scope', scope),
    });
  }

  upcoming(scope: AdminHomeScope, days = 30): Observable<AdminUpcoming> {
    return this.http.get<AdminUpcoming>(`${API}/admin/finance/upcoming`, {
      params: new HttpParams().set('days', String(days)).set('scope', scope),
    });
  }

  /** A mesma lista da tela de empresas, ordenada no servidor; não mexe no estado daquela tela. */
  companies(sort: CompanySort, size: number): Observable<PagedResponse<AdminCompanyListItem>> {
    return this.http.get<PagedResponse<AdminCompanyListItem>>(`${API}/admin/companies`, {
      params: new HttpParams().set('sort', sort).set('dir', 'desc').set('page', '0').set('size', String(size)),
    });
  }

  movements(options: {
    group: MovementGroup | null;
    includeInternal: boolean;
    from: string | null;
    size: number;
  }): Observable<PagedResponse<PlatformMovement>> {
    let params = new HttpParams()
      .set('includeInternal', String(options.includeInternal))
      .set('page', '0')
      .set('size', String(options.size));
    if (options.group) params = params.set('group', options.group);
    if (options.from) params = params.set('from', options.from);
    return this.http.get<PagedResponse<PlatformMovement>>(`${API}/admin/audit/movements`, { params });
  }
}
