import {
  HttpClient,
  HttpErrorResponse,
  HttpEvent,
  HttpParams,
} from '@angular/common/http';
import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, forkJoin, of, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PagedResponse } from '../../types/paged.types';
import {
  CancelRentalPayload,
  CompleteRentalPayload,
  CreateRentalRequest,
  RentalChargeDto,
  RentalDocumentDto,
  RentalFilters,
  RentalListItemDto,
  RentalPhotoAngle,
  RentalPhotoDto,
  RentalPhotoKind,
  RentalResponseDto,
  RentalStatusHistoryDto,
  RentalUpdateRequest,
  SignatureStatusDto,
  SignedUrlDto,
  SignerRequest,
} from '../../types/rental.types';

const BASE = `${environment.apiUrl}/rentals`;

/**
 * Consolidated per-rental snapshot cached by {@link RentalService}. Compiled
 * from the documents + photos + signature endpoints so consumers
 * (checklist / contract card / inspection card) share a single fetch.
 */
export interface RentalStateSnapshot {
  documents: RentalDocumentDto[];
  checkinPhotos: RentalPhotoDto[];
  checkoutPhotos: RentalPhotoDto[];
  contractSignature: SignatureStatusDto | null;
}

@Injectable({ providedIn: 'root' })
export class RentalService {
  private readonly http = inject(HttpClient);

  private readonly _items = signal<RentalListItemDto[]>([]);
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

  // ------- Per-rental shared state (source of truth for docs/photos/signature) -------
  private readonly stateStore = new Map<string, WritableSignal<RentalStateSnapshot | null>>();
  private readonly inFlight = new Map<string, boolean>();

  private stateSlot(rentalId: string): WritableSignal<RentalStateSnapshot | null> {
    let slot = this.stateStore.get(rentalId);
    if (!slot) {
      slot = signal<RentalStateSnapshot | null>(null);
      this.stateStore.set(rentalId, slot);
    }
    return slot;
  }

  /**
   * Read-only view of the shared snapshot. Returns `null` until the first
   * {@link loadRentalState} completes for this id.
   */
  rentalState(rentalId: string): Signal<RentalStateSnapshot | null> {
    return this.stateSlot(rentalId).asReadonly();
  }

  /**
   * Fetch (or refetch) documents + photos + signature in parallel and populate
   * the shared signal. Safe to call from every consumer's ngOnInit — repeated
   * concurrent calls for the same id are coalesced.
   */
  loadRentalState(rentalId: string): void {
    if (this.inFlight.get(rentalId)) return;
    this.inFlight.set(rentalId, true);
    const slot = this.stateSlot(rentalId);
    forkJoin({
      documents: this.listDocuments(rentalId).pipe(catchError(() => of([] as RentalDocumentDto[]))),
      checkinPhotos: this.listPhotos(rentalId, 'CHECKIN').pipe(catchError(() => of([] as RentalPhotoDto[]))),
      checkoutPhotos: this.listPhotos(rentalId, 'CHECKOUT').pipe(catchError(() => of([] as RentalPhotoDto[]))),
    }).subscribe({
      next: ({ documents, checkinPhotos, checkoutPhotos }) => {
        const hasContract = documents.some((d) => d.kind === 'CONTRACT');
        if (!hasContract) {
          slot.set({ documents, checkinPhotos, checkoutPhotos, contractSignature: null });
          this.inFlight.set(rentalId, false);
          return;
        }
        this.getContractSignatureStatus(rentalId).subscribe({
          next: (contractSignature) => {
            slot.set({ documents, checkinPhotos, checkoutPhotos, contractSignature });
            this.inFlight.set(rentalId, false);
          },
          error: () => {
            // Preserva assinatura anterior em erros transitórios de rede — evita
            // rebaixar um PENDING pra NOT_REQUIRED silenciosamente no UI.
            const prev = slot();
            slot.set({
              documents,
              checkinPhotos,
              checkoutPhotos,
              contractSignature: prev?.contractSignature ?? null,
            });
            this.inFlight.set(rentalId, false);
          },
        });
      },
      error: () => {
        this.inFlight.set(rentalId, false);
      },
    });
  }

  /** Alias for {@link loadRentalState} — bypasses the in-flight guard by resetting it. */
  refreshRentalState(rentalId: string): void {
    this.inFlight.set(rentalId, false);
    this.loadRentalState(rentalId);
  }

  /**
   * Lighter refresh triggered by the contract card's 30s Autentique poll — only
   * updates `contractSignature` on the shared snapshot, avoids re-fetching docs
   * and photos.
   */
  refreshContractSignature(rentalId: string): void {
    const slot = this.stateSlot(rentalId);
    const current = slot();
    if (!current) {
      this.loadRentalState(rentalId);
      return;
    }
    this.getContractSignatureStatus(rentalId).subscribe({
      next: (contractSignature) => slot.set({ ...current, contractSignature }),
      error: () => {
        /* keep previous status — transient network failures shouldn't flip UI. */
      },
    });
  }

  list(filters: RentalFilters = {}): Observable<PagedResponse<RentalListItemDto>> {
    this._loading.set(true);
    this._error.set(null);

    let params = new HttpParams();
    if (filters.status) params = params.set('status', filters.status);
    if (filters.vehicleId) params = params.set('vehicleId', filters.vehicleId);
    if (filters.driverId) params = params.set('driverId', filters.driverId);
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.page !== undefined) params = params.set('page', String(filters.page));
    if (filters.size !== undefined) params = params.set('size', String(filters.size));

    return this.http
      .get<PagedResponse<RentalListItemDto>>(BASE, { params })
      .pipe(
        tap((res) => {
          this._items.set(res.content ?? []);
          this._page.set(res.page ?? 0);
          this._size.set(res.size ?? 20);
          this._total.set(res.total ?? 0);
        }),
        catchError((err: HttpErrorResponse) => {
          this._error.set('Não foi possível carregar os aluguéis.');
          return throwError(() => err);
        }),
        finalize(() => this._loading.set(false)),
      );
  }

  getById(id: string): Observable<RentalResponseDto> {
    return this.http.get<RentalResponseDto>(`${BASE}/${id}`);
  }

  create(payload: CreateRentalRequest): Observable<RentalResponseDto> {
    return this.http.post<RentalResponseDto>(BASE, payload);
  }

  update(id: string, payload: RentalUpdateRequest): Observable<RentalResponseDto> {
    return this.http.put<RentalResponseDto>(`${BASE}/${id}`, payload);
  }

  cancel(id: string, payload?: CancelRentalPayload): Observable<RentalResponseDto> {
    return this.http.post<RentalResponseDto>(`${BASE}/${id}/cancel`, payload ?? {});
  }

  /**
   * Manually activate a RESERVED rental created with automaticCharge=false.
   * Skips the Asaas webhook path entirely.
   */
  activate(id: string): Observable<RentalResponseDto> {
    return this.http.post<RentalResponseDto>(`${BASE}/${id}/activate`, {});
  }

  complete(id: string, payload?: CompleteRentalPayload): Observable<RentalResponseDto> {
    return this.http.post<RentalResponseDto>(`${BASE}/${id}/complete`, payload ?? {});
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/${id}`);
  }

  /**
   * Histórico de transições de status. Ordenado do mais recente pro mais antigo.
   * Cross-tenant retorna 404 no backend.
   */
  history(id: string): Observable<RentalStatusHistoryDto[]> {
    return this.http.get<RentalStatusHistoryDto[]>(`${BASE}/${id}/history`);
  }

  /**
   * Regerar cobrança FAILED. Backend: POST /v1/rentals/{rentalId}/charges/{chargeId}/retry.
   * Retorna outcome ('RETRIED' | 'ALREADY_PAID' | 'ALREADY_REFUNDED') e novo external id.
   */
  // -------- Documentos (contrato + laudos gerados) --------

  /**
   * Upload do PDF de contrato via multipart. Substitui contrato anterior
   * quando já existe (backend faz replace atômico).
   */
  uploadContract(rentalId: string, file: File): Observable<RentalDocumentDto> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<RentalDocumentDto>(`${BASE}/${rentalId}/contract`, form);
  }

  /**
   * Versão do upload que emite HttpEvents (progresso + resposta final).
   * Caller usa `event.type === HttpEventType.UploadProgress` pra barra
   * e `HttpEventType.Response` pra recuperar o DTO. `unsubscribe()` na
   * Subscription aborta o request no browser.
   */
  uploadContractWithProgress(
    rentalId: string,
    file: File,
  ): Observable<HttpEvent<RentalDocumentDto>> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<RentalDocumentDto>(`${BASE}/${rentalId}/contract`, form, {
      reportProgress: true,
      observe: 'events',
    });
  }

  listDocuments(rentalId: string): Observable<RentalDocumentDto[]> {
    return this.http.get<RentalDocumentDto[]>(`${BASE}/${rentalId}/documents`);
  }

  /** URL assinada de curta duração (TTL definido pelo backend). */
  documentSignedUrl(rentalId: string, documentId: string): Observable<SignedUrlDto> {
    return this.http.get<SignedUrlDto>(
      `${BASE}/${rentalId}/documents/${documentId}/signed-url`,
    );
  }

  deleteDocument(rentalId: string, documentId: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/${rentalId}/documents/${documentId}`);
  }

  // -------- Assinatura eletrônica (Autentique) --------

  requestContractSignature(
    rentalId: string,
    signers: SignerRequest[],
  ): Observable<SignatureStatusDto> {
    return this.http.post<SignatureStatusDto>(
      `${BASE}/${rentalId}/contract/signature`,
      { signers },
    );
  }

  getContractSignatureStatus(rentalId: string): Observable<SignatureStatusDto> {
    return this.http.get<SignatureStatusDto>(`${BASE}/${rentalId}/contract/signature`);
  }

  // -------- Vistoria (fotos + PDF de laudo) --------

  uploadPhoto(
    rentalId: string,
    kind: RentalPhotoKind,
    angle: RentalPhotoAngle,
    file: File,
  ): Observable<RentalPhotoDto> {
    const form = new FormData();
    form.append('file', file);
    const params = new HttpParams().set('kind', kind).set('angle', angle);
    return this.http.post<RentalPhotoDto>(`${BASE}/${rentalId}/photos`, form, { params });
  }

  /** Variante com progresso + cancel. Ver {@link uploadContractWithProgress}. */
  uploadPhotoWithProgress(
    rentalId: string,
    kind: RentalPhotoKind,
    angle: RentalPhotoAngle,
    file: File,
  ): Observable<HttpEvent<RentalPhotoDto>> {
    const form = new FormData();
    form.append('file', file);
    const params = new HttpParams().set('kind', kind).set('angle', angle);
    return this.http.post<RentalPhotoDto>(`${BASE}/${rentalId}/photos`, form, {
      params,
      reportProgress: true,
      observe: 'events',
    });
  }

  listPhotos(rentalId: string, kind: RentalPhotoKind): Observable<RentalPhotoDto[]> {
    const params = new HttpParams().set('kind', kind);
    return this.http.get<RentalPhotoDto[]>(`${BASE}/${rentalId}/photos`, { params });
  }

  deletePhoto(rentalId: string, photoId: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/${rentalId}/photos/${photoId}`);
  }

  /**
   * Gera o PDF do laudo a partir das fotos já enviadas. Substitui o PDF
   * anterior se existir. Backend valida status do rental (CHECKOUT exige ACTIVE).
   */
  generateInspectionPdf(
    rentalId: string,
    kind: RentalPhotoKind,
  ): Observable<RentalDocumentDto> {
    return this.http.post<RentalDocumentDto>(
      `${BASE}/${rentalId}/inspections/${kind}/generate-pdf`,
      {},
    );
  }

  /**
   * Gera uma cobrança one-off do valor da caução (Asaas). Backend valida:
   * `caucaoAmount > 0`, `caucaoPaid === false`, sem CAUCAO aberta.
   */
  createCaucaoCharge(rentalId: string): Observable<RentalChargeDto> {
    return this.http.post<RentalChargeDto>(`${BASE}/${rentalId}/caucao-charge`, {});
  }

  /**
   * Manual mark-as-paid for a rental charge — only allowed when the rental
   * was created with `automaticCharge=false` (i.e. Asaas is not managing it).
   * Backend rejects with 400 for automatic rentals or non-eligible statuses.
   * `paidAt` is the yyyy-MM-dd date the operator confirms as the payment date.
   */
  markChargeAsPaid(
    rentalId: string,
    chargeId: string,
    paidAt: string,
  ): Observable<RentalChargeDto> {
    return this.http.post<RentalChargeDto>(
      `${BASE}/${rentalId}/charges/${chargeId}/mark-paid`,
      { paidAt },
    );
  }

  /**
   * Undo a manual mark-as-paid. Only meaningful when the rental was created
   * with `automaticCharge=false` — automatic (Asaas-managed) rentals reject.
   */
  unmarkChargeAsPaid(rentalId: string, chargeId: string): Observable<RentalChargeDto> {
    return this.http.post<RentalChargeDto>(
      `${BASE}/${rentalId}/charges/${chargeId}/unmark-paid`,
      {},
    );
  }

  retryCharge(rentalId: string, chargeId: string): Observable<{
    outcome: 'RETRIED' | 'ALREADY_PAID' | 'ALREADY_REFUNDED';
    externalId: string;
    checkoutUrl: string;
    retryCount: number;
  }> {
    return this.http.post<{
      outcome: 'RETRIED' | 'ALREADY_PAID' | 'ALREADY_REFUNDED';
      externalId: string;
      checkoutUrl: string;
      retryCount: number;
    }>(`${BASE}/${rentalId}/charges/${chargeId}/retry`, {});
  }
}
