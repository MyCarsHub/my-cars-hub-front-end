import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  FinancingsSummary,
  InsurancesSummary,
  IpvaFleetFilters,
  IpvaFleetRow,
  IpvaFleetSummary,
  VehiclePickerFilter,
} from '../types/fleet-finance.types';
import { PagedResponse } from '../types/paged.types';
import { VehicleListItem } from '../types/vehicle.types';

/** Quantos carros o seletor traz de uma vez; a busca estreita o resto. */
export const PICKER_PAGE_SIZE = 50;

/**
 * Leituras da frota inteira para IPVA, financiamentos e seguros. Sem estado: cada tela guarda
 * o que recebeu. O seletor de veículo NÃO passa por `VehiclesService.list()`, que escreve na
 * lista compartilhada que a tela de Veículos desenha.
 */
@Injectable({ providedIn: 'root' })
export class FleetFinanceService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  ipvaSummary(year: number): Observable<IpvaFleetSummary> {
    const params = new HttpParams().set('year', String(year));
    return this.http.get<IpvaFleetSummary>(`${this.api}/ipva/summary`, { params });
  }

  ipvaList(filters: IpvaFleetFilters): Observable<PagedResponse<IpvaFleetRow>> {
    let params = new HttpParams().set('year', String(filters.year));
    if (filters.status) params = params.set('status', filters.status);
    if (filters.q?.trim()) params = params.set('q', filters.q.trim());
    if (filters.page !== undefined) params = params.set('page', String(filters.page));
    if (filters.size !== undefined) params = params.set('size', String(filters.size));
    return this.http.get<PagedResponse<IpvaFleetRow>>(`${this.api}/ipva`, { params });
  }

  financingsSummary(): Observable<FinancingsSummary> {
    return this.http.get<FinancingsSummary>(`${this.api}/financings/summary`);
  }

  insurancesSummary(expiringInDays: number): Observable<InsurancesSummary> {
    const params = new HttpParams().set('expiringInDays', String(expiringInDays));
    return this.http.get<InsurancesSummary>(`${this.api}/insurances/summary`, { params });
  }

  pickVehicles(filter: VehiclePickerFilter, q = ''): Observable<PagedResponse<VehicleListItem>> {
    let params = new HttpParams().set('size', String(PICKER_PAGE_SIZE)).set('sort', 'plate_asc');
    if (q.trim()) params = params.set('q', q.trim());
    switch (filter.kind) {
      case 'withoutIpvaYear':
        params = params.set('withoutIpvaYear', String(filter.year));
        break;
      case 'withoutActiveFinancing':
        params = params.set('withoutActiveFinancing', 'true');
        break;
      case 'withoutActiveInsurance':
        params = params.set('withoutActiveInsurance', 'true');
        break;
    }
    return this.http.get<PagedResponse<VehicleListItem>>(`${this.api}/vehicles`, { params });
  }
}
