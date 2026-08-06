import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import {
  CancelInsuranceRequest,
  CreateInsuranceRequest,
  GenerateInsuranceInstallmentsRequest,
  Insurance,
  InsuranceDetail,
  InsuranceFilters,
  InsuranceInstallment,
  InsuranceListItem,
  InsurancePolicyDocument,
  InsuranceSignedUrl,
  PayInsuranceInstallmentRequest,
  UpdateInsuranceRequest,
} from '../types/insurance.types';

const VEHICLES_BASE = `${environment.apiUrl}/vehicles`;
const FLEET_BASE = `${environment.apiUrl}/insurances`;

/**
 * Apólices de seguro da frota. Mesmo padrão de cache em signals usado por
 * `VehiclesService` para financiamentos: a listagem consolidada escreve nos
 * signals privados, expostos como readonly para as telas.
 */
@Injectable({ providedIn: 'root' })
export class InsurancesService {
  private readonly http = inject(HttpClient);

  private readonly _insurances = signal<InsuranceListItem[]>([]);
  private readonly _page = signal(0);
  private readonly _size = signal(20);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly insurances = this._insurances.asReadonly();
  readonly page = this._page.asReadonly();
  readonly size = this._size.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Zera o cache para o estado inicial. Obrigatório no logout: o serviço é
   * `providedIn: 'root'` e sobrevive ao `sessionStorage.clear()`, então sem
   * isso o próximo usuário logado na MESMA aba veria as apólices do anterior.
   */
  reset(): void {
    this._insurances.set([]);
    this._page.set(0);
    this._size.set(20);
    this._total.set(0);
    this._loading.set(false);
    this._error.set(null);
  }

  /** Histórico completo do veículo (ACTIVE primeiro, depois `end_date` desc). */
  listByVehicle(vehicleId: string): Observable<Insurance[]> {
    return this.http.get<Insurance[]>(`${VEHICLES_BASE}/${vehicleId}/insurances`);
  }

  /** 409 quando o veículo já possui uma apólice ACTIVE — trate inline, nunca em toast. */
  create(vehicleId: string, payload: CreateInsuranceRequest): Observable<Insurance> {
    return this.http.post<Insurance>(`${VEHICLES_BASE}/${vehicleId}/insurances`, payload);
  }

  /** Apólice CANCELLED ou EXPIRED não pode ser editada (backend recusa). */
  update(
    vehicleId: string,
    insuranceId: string,
    payload: UpdateInsuranceRequest,
  ): Observable<Insurance> {
    return this.http.patch<Insurance>(
      `${VEHICLES_BASE}/${vehicleId}/insurances/${insuranceId}`,
      payload,
    );
  }

  /** `cancelledDate` precisa estar em [startDate, hoje]. */
  cancel(
    vehicleId: string,
    insuranceId: string,
    payload: CancelInsuranceRequest,
  ): Observable<Insurance> {
    return this.http.patch<Insurance>(
      `${VEHICLES_BASE}/${vehicleId}/insurances/${insuranceId}/cancel`,
      payload,
    );
  }

  remove(vehicleId: string, insuranceId: string): Observable<void> {
    return this.http
      .delete(`${VEHICLES_BASE}/${vehicleId}/insurances/${insuranceId}`, { responseType: 'text' })
      .pipe(map(() => void 0));
  }

  getOne(id: string): Observable<InsuranceDetail> {
    return this.http.get<InsuranceDetail>(`${FLEET_BASE}/${id}`);
  }

  /**
   * Listagem consolidada (`GET /v1/insurances`).
   *
   * `expiringInDays` já implica ACTIVE no backend e é mutuamente exclusivo com
   * `status` — quando presente, `status` NÃO é enviado.
   */
  list(filters: InsuranceFilters = {}): Observable<PagedResponse<InsuranceListItem>> {
    this._loading.set(true);
    this._error.set(null);

    let params = new HttpParams();
    if (filters.vehicleId) params = params.set('vehicleId', filters.vehicleId);
    if (filters.expiringInDays != null) {
      params = params.set('expiringInDays', String(filters.expiringInDays));
    } else if (filters.status) {
      params = params.set('status', filters.status);
    }
    if (filters.sort) params = params.set('sort', filters.sort);
    if (filters.page !== undefined) params = params.set('page', String(filters.page));
    if (filters.size !== undefined) params = params.set('size', String(filters.size));

    return this.http.get<PagedResponse<InsuranceListItem>>(FLEET_BASE, { params }).pipe(
      tap((res) => {
        this._insurances.set(res.content ?? []);
        this._page.set(res.page ?? 0);
        this._size.set(res.size ?? 20);
        this._total.set(res.total ?? 0);
      }),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar os seguros.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  // ---------------------------------------------------- apólice em PDF

  /**
   * Anexa o PDF da apólice (multipart, campo `file`). Sem `reportProgress`
   * DE PROPÓSITO: o app usa `withFetch()` e o `FetchBackend` nunca emite
   * `UploadProgress`, então pedir progresso só produziria uma barra falsa.
   * A UI mostra estado indeterminado. Substitui o documento existente.
   */
  uploadPolicyDocument(insuranceId: string, file: File): Observable<InsurancePolicyDocument> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<InsurancePolicyDocument>(
      `${FLEET_BASE}/${insuranceId}/policy-document`,
      form,
    );
  }

  /** URL assinada de curta duração para abrir/baixar o PDF da apólice. */
  policyDocumentSignedUrl(insuranceId: string): Observable<InsuranceSignedUrl> {
    return this.http.get<InsuranceSignedUrl>(
      `${FLEET_BASE}/${insuranceId}/policy-document/signed-url`,
    );
  }

  /** 204. Apaga o arquivo do storage — irreversível, exige confirmação na UI. */
  deletePolicyDocument(insuranceId: string): Observable<void> {
    return this.http
      .delete(`${FLEET_BASE}/${insuranceId}/policy-document`, { responseType: 'text' })
      .pipe(map(() => void 0));
  }

  // ------------------------------------------- parcelamento do prêmio

  /**
   * Cronograma atual. Só é necessário como fallback — o `GET /v1/insurances/{id}`
   * já devolve `installments`, e toda mutação devolve o cronograma inteiro.
   */
  listInstallments(insuranceId: string): Observable<InsuranceInstallment[]> {
    return this.http.get<InsuranceInstallment[]>(`${FLEET_BASE}/${insuranceId}/installments`);
  }

  /**
   * Gera o cronograma (`installments` entre 1 e 120). Devolve o cronograma
   * COMPLETO — nunca faça um GET depois disto.
   */
  generateInstallments(
    insuranceId: string,
    payload: GenerateInsuranceInstallmentsRequest,
  ): Observable<InsuranceInstallment[]> {
    return this.http.post<InsuranceInstallment[]>(
      `${FLEET_BASE}/${insuranceId}/installments`,
      payload,
    );
  }

  /** Marca uma parcela como paga. Body opcional. Devolve o cronograma COMPLETO. */
  payInstallment(
    insuranceId: string,
    installmentId: string,
    payload: PayInsuranceInstallmentRequest = {},
  ): Observable<InsuranceInstallment[]> {
    return this.http.patch<InsuranceInstallment[]>(
      `${FLEET_BASE}/${insuranceId}/installments/${installmentId}/pay`,
      payload,
    );
  }

  /** Desfaz o pagamento de uma parcela. Devolve o cronograma COMPLETO. */
  unpayInstallment(
    insuranceId: string,
    installmentId: string,
  ): Observable<InsuranceInstallment[]> {
    return this.http.patch<InsuranceInstallment[]>(
      `${FLEET_BASE}/${insuranceId}/installments/${installmentId}/unpay`,
      {},
    );
  }

  /**
   * Apaga o cronograma inteiro (204). O backend RECUSA com 409/400 quando
   * existe parcela já paga — a tela precisa traduzir isso, não deixar cair no
   * erro genérico.
   */
  deleteInstallments(insuranceId: string): Observable<void> {
    return this.http
      .delete(`${FLEET_BASE}/${insuranceId}/installments`, { responseType: 'text' })
      .pipe(map(() => void 0));
  }
}
