import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  AdminActionRequest,
  AdminReceivedOutsideRequest,
  AdminChargeActionResult,
  AdminChargeTab,
  AdminChargesPage,
  AsaasComparison,
  AsaasCustomerSyncResult,
  DriverNameCorrectionResult,
  TrialConversionItem,
} from '../../../types/admin-charges.types';

/**
 * Cobranças do admin: leituras do P0 (lista, "Converter testes") e as ações do
 * P1 — comparar com o Asaas, recebida por fora, tentar de novo (só FAILED no
 * prazo; o backend recusa a vencida com 409), corrigir nome do motorista e
 * atualizar o cliente no Asaas. Nenhuma ação re-data cobrança.
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

  compareWithAsaas(chargeId: string): Observable<AsaasComparison> {
    return this.http.post<AsaasComparison>(
      `${environment.apiUrl}/admin/charges/${chargeId}/asaas-comparison`,
      {},
    );
  }

  markReceivedOutside(chargeId: string, body: AdminReceivedOutsideRequest): Observable<AdminChargeActionResult> {
    return this.http.post<AdminChargeActionResult>(
      `${environment.apiUrl}/admin/charges/${chargeId}/received-outside`,
      body,
    );
  }

  retry(chargeId: string, body: AdminActionRequest): Observable<AdminChargeActionResult> {
    return this.http.post<AdminChargeActionResult>(
      `${environment.apiUrl}/admin/charges/${chargeId}/retry`,
      body,
    );
  }

  correctDriverName(
    driverId: string,
    body: AdminActionRequest & { name: string },
  ): Observable<DriverNameCorrectionResult> {
    return this.http.put<DriverNameCorrectionResult>(
      `${environment.apiUrl}/admin/drivers/${driverId}/name`,
      body,
    );
  }

  syncDriverAsaasCustomer(driverId: string, body: AdminActionRequest): Observable<AsaasCustomerSyncResult> {
    return this.http.post<AsaasCustomerSyncResult>(
      `${environment.apiUrl}/admin/drivers/${driverId}/asaas-customer-sync`,
      body,
    );
  }
}
