import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { RentalResponseDto } from '../../../types/rental.types';
import { RenewRentalRequest, RenewalPreviewDto } from '../../../types/rental-renewal.types';

const BASE = `${environment.apiUrl}/rentals`;

/**
 * V151 — renovação de aluguel ATIVO. Serviço próprio, importado só pelo detalhe do aluguel
 * (código preguiçoso), para não engordar o bundle inicial. O backend recusa (403) quem não tem
 * `CHARGES_FLEX`, o motorista e a sessão de suporte.
 */
@Injectable({ providedIn: 'root' })
export class RentalRenewalService {
  private readonly http = inject(HttpClient);

  /** Leitura pura: sempre 200; a recusa vem em `blocker`. */
  preview(rentalId: string, body: RenewRentalRequest): Observable<RenewalPreviewDto> {
    return this.http.post<RenewalPreviewDto>(`${BASE}/${encodeURIComponent(rentalId)}/renew-preview`, body);
  }

  /** Renova; a resposta é o aluguel já renovado, com `chargeSync` quando houve emissão. */
  renew(rentalId: string, body: RenewRentalRequest): Observable<RentalResponseDto> {
    return this.http.post<RentalResponseDto>(`${BASE}/${encodeURIComponent(rentalId)}/renew`, body);
  }
}
