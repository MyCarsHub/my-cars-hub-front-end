import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  Adjustment,
  AdjustmentCreateRequest,
  AdjustmentListQuery,
  AdjustmentListResponse,
} from '../types/adjustment.types';

const BASE = `${environment.apiUrl}/adjustments`;
const RENTALS = `${environment.apiUrl}/rentals`;

/** Resultado do POST: 201 = emitido, 202 = emissão em curso, 200 = a mesma chave já criou. */
export interface AdjustmentCreateResult {
  adjustment: Adjustment;
  httpStatus: number;
}

/**
 * Ajustes (`/v1/adjustments`). Sem cache de propósito: o estado mora no componente, então não
 * há o que vazar na troca de empresa.
 */
@Injectable({ providedIn: 'root' })
export class AdjustmentsService {
  private readonly http = inject(HttpClient);

  list(query: AdjustmentListQuery): Observable<AdjustmentListResponse> {
    let params = new HttpParams()
      .set('month', query.month)
      .set('page', String(query.page))
      .set('size', String(query.size));
    if (query.status !== 'ALL') params = params.set('status', query.status);
    if (query.driverId) params = params.set('driverId', query.driverId);
    const q = query.q.trim();
    if (q) params = params.set('q', q);
    return this.http.get<AdjustmentListResponse>(BASE, { params });
  }

  getOne(id: string): Observable<Adjustment> {
    return this.http.get<Adjustment>(`${BASE}/${encodeURIComponent(id)}`);
  }

  /**
   * `idempotencyKey` é do ENVIO, não da chamada: quem tenta de novo o mesmo envio manda a mesma
   * chave (o back-end devolve o ajuste já criado, sem segundo Pix).
   */
  create(payload: AdjustmentCreateRequest, idempotencyKey: string): Observable<AdjustmentCreateResult> {
    const headers = new HttpHeaders({ 'Idempotency-Key': idempotencyKey });
    return this.http
      .post<Adjustment>(BASE, payload, { headers, observe: 'response' })
      .pipe(
        map((res) => ({ adjustment: res.body as Adjustment, httpStatus: res.status })),
      );
  }

  /** O copia-e-cola do Pix do ajuste (a cobrança dele no aluguel do motorista). */
  pix(rentalId: string, chargeId: string): Observable<string> {
    return this.http
      .get<unknown>(
        `${RENTALS}/${encodeURIComponent(rentalId)}/charges/${encodeURIComponent(chargeId)}/pix`,
      )
      .pipe(
        map((raw) => {
          const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
          const payload = typeof r['payload'] === 'string' ? r['payload'].trim() : '';
          if (!payload) throw new Error('Pix sem código');
          return payload;
        }),
      );
  }
}
