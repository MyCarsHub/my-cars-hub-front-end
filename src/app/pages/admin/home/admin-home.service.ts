import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import type { AdminCompanyListItem } from '../../../types/admin-company.types';
import type {
  AdminHome,
  AdminHomeRange,
  AdminHomeScope,
  AdminUpcoming,
  AdminUsage,
  CompanySort,
  MovementGroup,
  PlatformMovementsPage,
} from '../../../types/admin-home.types';
import type { PagedResponse } from '../../../types/paged.types';

const API = environment.apiUrl;

/** `from`/`to` of a range (contract `changed:` 18/11): the server takes them instead of `period`. */
export function rangeParams(range: AdminHomeRange, params = new HttpParams()): HttpParams {
  return params.set('from', range.from).set('to', range.to);
}

/**
 * Visão geral do admin v2 (contrato `2026-11-17_CONTRACT_admin-home.md`). Sem estado: cada bloco
 * guarda a sua resposta e cancela a anterior (switchMap) quando o período ou o escopo mudam, para
 * um número de um período nunca aparecer sob as datas de outro.
 */
@Injectable({ providedIn: 'root' })
export class AdminHomeService {
  private readonly http = inject(HttpClient);

  home(range: AdminHomeRange, scope: AdminHomeScope): Observable<AdminHome> {
    return this.http.get<AdminHome>(`${API}/admin/metrics/home`, {
      params: rangeParams(range).set('scope', scope),
    });
  }

  usage(range: AdminHomeRange, scope: AdminHomeScope): Observable<AdminUsage> {
    return this.http.get<AdminUsage>(`${API}/admin/metrics/usage`, {
      params: rangeParams(range).set('scope', scope),
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
    to: string | null;
    size: number;
  }): Observable<PlatformMovementsPage> {
    let params = new HttpParams()
      .set('includeInternal', String(options.includeInternal))
      .set('page', '0')
      .set('size', String(options.size));
    if (options.group) params = params.set('group', options.group);
    if (options.from) params = params.set('from', options.from);
    if (options.to) params = params.set('to', options.to);
    return this.http.get<PlatformMovementsPage>(`${API}/admin/audit/movements`, { params });
  }
}
