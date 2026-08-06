import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import {
  ChangeInsuranceStatusRequest,
  ChangeResolutionStatusRequest,
  CreateVehicleIncidentRequest,
  IncidentDocument,
  IncidentDocumentKind,
  IncidentDocumentUrl,
  UpdateVehicleIncidentRequest,
  VehicleIncident,
  VehicleIncidentFilters,
  VehicleIncidentListItem,
  VehicleIncidentSummary,
} from '../types/vehicle-incident.types';

const BASE = `${environment.apiUrl}/vehicle-incidents`;

/**
 * Sinistros da frota. Mesmo desenho de cache em signals de `FinesService` /
 * `InsurancesService`: a listagem consolidada escreve nos signals privados,
 * expostos readonly para as telas.
 *
 * As DUAS transições de estado ficam em métodos próprios porque o backend as
 * separa de propósito — nem o POST nem o PUT aceitam status. Reproduza essa
 * separação aqui: um `update()` que mandasse status voltaria a existir como
 * atalho e a máquina de estados existiria só no papel.
 */
@Injectable({ providedIn: 'root' })
export class VehicleIncidentsService {
  private readonly http = inject(HttpClient);

  private readonly _items = signal<VehicleIncidentListItem[]>([]);
  private readonly _page = signal(0);
  private readonly _size = signal(20);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly items = this._items.asReadonly();
  readonly page = this._page.asReadonly();
  readonly size = this._size.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Zera o cache. Obrigatório em toda troca de contexto: o serviço é
   * `providedIn: 'root'` e sobrevive ao `sessionStorage.clear()`, então sem
   * isso o próximo usuário da MESMA aba veria os sinistros do anterior.
   */
  reset(): void {
    this._items.set([]);
    this._page.set(0);
    this._size.set(20);
    this._total.set(0);
    this._loading.set(false);
    this._error.set(null);
  }

  /**
   * Listagem consolidada cross-veículos. `resolutionStatus=ACTIVE` é o atalho
   * do backend para OPEN + IN_REPAIR — uma chamada só, que é o que o celular
   * precisa.
   */
  list(filters: VehicleIncidentFilters = {}): Observable<PagedResponse<VehicleIncidentListItem>> {
    this._loading.set(true);
    this._error.set(null);

    let params = new HttpParams();
    if (filters.vehicleId) params = params.set('vehicleId', filters.vehicleId);
    if (filters.driverId) params = params.set('driverId', filters.driverId);
    if (filters.rentalId) params = params.set('rentalId', filters.rentalId);
    if (filters.incidentType) params = params.set('incidentType', filters.incidentType);
    if (filters.resolutionStatus) {
      params = params.set('resolutionStatus', filters.resolutionStatus);
    }
    if (filters.insuranceStatus) params = params.set('insuranceStatus', filters.insuranceStatus);
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.sort) params = params.set('sort', filters.sort);
    if (filters.page !== undefined) params = params.set('page', String(filters.page));
    if (filters.size !== undefined) params = params.set('size', String(filters.size));

    return this.http.get<PagedResponse<VehicleIncidentListItem>>(BASE, { params }).pipe(
      tap((res) => {
        this._items.set(res.content ?? []);
        this._page.set(res.page ?? 0);
        this._size.set(res.size ?? 20);
        this._total.set(res.total ?? 0);
      }),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar os sinistros.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  /**
   * Agregados (contagens + totais financeiros). Existe para poupar uma segunda
   * rodada de rede no mobile — a tela de lista monta o card de resumo com isto,
   * não somando a página corrente (que é só uma página).
   */
  summary(range: { from?: string; to?: string } = {}): Observable<VehicleIncidentSummary> {
    let params = new HttpParams();
    if (range.from) params = params.set('from', range.from);
    if (range.to) params = params.set('to', range.to);
    return this.http.get<VehicleIncidentSummary>(`${BASE}/summary`, { params });
  }

  /** Detalhe. ÚNICO lugar de onde vêm os dados do terceiro envolvido (LGPD). */
  getOne(id: string): Observable<VehicleIncident> {
    return this.http.get<VehicleIncident>(`${BASE}/${id}`);
  }

  /** Nasce sempre OPEN / NOT_FILED — o corpo não carrega status. */
  create(payload: CreateVehicleIncidentRequest): Observable<VehicleIncident> {
    return this.http.post<VehicleIncident>(BASE, payload);
  }

  /** Só dados descritivos: sem status e sem troca de veículo. */
  update(id: string, payload: UpdateVehicleIncidentRequest): Observable<VehicleIncident> {
    return this.http.put<VehicleIncident>(`${BASE}/${id}`, payload);
  }

  remove(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`, { responseType: 'text' }).pipe(
      map(() => void 0),
      tap(() => this._items.update((list) => list.filter((i) => i.id !== id))),
    );
  }

  /**
   * Transição do ciclo OPERACIONAL (o veículo).
   *
   * 409 tem DOIS significados distintos e a tela precisa separá-los: com
   * `fieldErrors.status` é transição inválida; sem ele é a trava otimista —
   * alguém mudou o estado no meio. Ver `isOptimisticLockConflict`.
   */
  changeResolutionStatus(
    id: string,
    payload: ChangeResolutionStatusRequest,
  ): Observable<VehicleIncident> {
    return this.http.patch<VehicleIncident>(`${BASE}/${id}/resolution-status`, payload);
  }

  /** Transição do ciclo do PROCESSO (a seguradora). Mesmo contrato de 409. */
  changeInsuranceStatus(
    id: string,
    payload: ChangeInsuranceStatusRequest,
  ): Observable<VehicleIncident> {
    return this.http.patch<VehicleIncident>(`${BASE}/${id}/insurance-status`, payload);
  }

  // ------------------------------------------------------------------ anexos

  listDocuments(incidentId: string): Observable<IncidentDocument[]> {
    return this.http.get<IncidentDocument[]>(`${BASE}/${incidentId}/documents`);
  }

  /**
   * Anexa um arquivo (multipart: `file` + `kind`). Sem `reportProgress` DE
   * PROPÓSITO: o app usa `withFetch()` e o `FetchBackend` nunca emite
   * `UploadProgress` — pedir progresso só produziria uma barra falsa. A UI
   * mostra estado indeterminado com cancelamento real.
   */
  uploadDocument(
    incidentId: string,
    kind: IncidentDocumentKind,
    file: File,
  ): Observable<IncidentDocument> {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    return this.http.post<IncidentDocument>(`${BASE}/${incidentId}/documents`, form);
  }

  /** URL assinada de TTL curto — o bucket é privado, o path nunca sai do backend. */
  documentSignedUrl(incidentId: string, documentId: string): Observable<IncidentDocumentUrl> {
    return this.http.get<IncidentDocumentUrl>(
      `${BASE}/${incidentId}/documents/${documentId}/signed-url`,
    );
  }

  deleteDocument(incidentId: string, documentId: string): Observable<void> {
    return this.http
      .delete(`${BASE}/${incidentId}/documents/${documentId}`, { responseType: 'text' })
      .pipe(map(() => void 0));
  }
}
