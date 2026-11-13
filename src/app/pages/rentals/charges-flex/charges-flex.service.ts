import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  AgreementDto,
  AgreementPreviewDto,
  AgreementRequestDto,
  ReceivedOutsideRequestDto,
} from '../../../types/agreement.types';
import { RentalChargeDto } from '../../../types/rental.types';

const BASE = `${environment.apiUrl}/rentals`;

/**
 * FEAT-0573 — rotas novas das Cobranças flexíveis (contrato B3–B6). Fica num serviço próprio,
 * importado só pelo código preguiçoso do aluguel, para não engordar o bundle inicial.
 * Toda rota aqui é recusada pelo backend (403) para conta sem `CHARGES_FLEX`.
 */
@Injectable({ providedIn: 'root' })
export class ChargesFlexService {
  private readonly http = inject(HttpClient);

  /** B3 — leitura pura: nada é gravado; validação volta em `blocker` com 200. */
  agreementPreview(rentalId: string, body: AgreementRequestDto): Observable<AgreementPreviewDto> {
    return this.http.post<AgreementPreviewDto>(
      `${BASE}/${encodeURIComponent(rentalId)}/agreements/preview`,
      body,
    );
  }

  /**
   * B4 — `idempotencyKey` é do ENVIO: tentar de novo o mesmo corpo reaproveita a chave e o
   * backend devolve o acordo já criado (200), sem cancelar nem emitir nada de novo.
   */
  createAgreement(
    rentalId: string,
    body: AgreementRequestDto,
    idempotencyKey: string,
  ): Observable<AgreementDto> {
    const headers = new HttpHeaders({ 'Idempotency-Key': idempotencyKey });
    return this.http.post<AgreementDto>(
      `${BASE}/${encodeURIComponent(rentalId)}/agreements`,
      body,
      { headers },
    );
  }

  /** B5 — ordenados por `seq` decrescente. */
  listAgreements(rentalId: string): Observable<AgreementDto[]> {
    return this.http.get<AgreementDto[]>(`${BASE}/${encodeURIComponent(rentalId)}/agreements`);
  }

  getAgreement(rentalId: string, agreementId: string): Observable<AgreementDto> {
    return this.http.get<AgreementDto>(
      `${BASE}/${encodeURIComponent(rentalId)}/agreements/${encodeURIComponent(agreementId)}`,
    );
  }

  /** B6 — o valor é sempre o da cobrança; não há desfazer. */
  receivedOutside(
    rentalId: string,
    chargeId: string,
    body: ReceivedOutsideRequestDto,
  ): Observable<RentalChargeDto> {
    return this.http.post<RentalChargeDto>(
      `${BASE}/${encodeURIComponent(rentalId)}/charges/${encodeURIComponent(chargeId)}/received-outside`,
      body,
    );
  }
}
