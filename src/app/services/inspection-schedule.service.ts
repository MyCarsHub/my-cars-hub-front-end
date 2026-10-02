import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CreateInspectionScheduleRequest,
  InspectionScheduleResponse,
} from '../types/inspection-schedule.types';

/**
 * `/v1/vehicles/{vehicleId}/inspection-schedule` — the periodic inspection of ONE vehicle.
 *
 * ## Sem cache, de proposito
 *
 * Os outros servicos deste app guardam a lista da empresa num signal e se registram no
 * `TenantResetRegistry`. Aqui nao ha lista: cada chamada e sobre UM veiculo, a tela do
 * veiculo vive pouco, e um cache por id so criaria a chance de mostrar o agendamento do
 * carro anterior. Quem precisa do estado e o cartao, que o guarda no proprio componente.
 *
 * ## O 404 do GET nao e erro
 *
 * Veiculo sem agendamento responde 404, e isso e a resposta NORMAL para "este carro ainda
 * nao tem agendamento" — e o caso da maioria dos carros hoje. Quem chama trata 404 como
 * "nao ha", nunca como falha.
 */
@Injectable({ providedIn: 'root' })
export class InspectionScheduleService {
  private readonly http = inject(HttpClient);

  /** `GET` — devolve UM agendamento. 404 significa "este veiculo nao tem". */
  get(vehicleId: string): Observable<InspectionScheduleResponse> {
    return this.http.get<InspectionScheduleResponse>(this.url(vehicleId));
  }

  /** `POST` — cria ou substitui o agendamento do veiculo. */
  create(
    vehicleId: string,
    payload: CreateInspectionScheduleRequest,
  ): Observable<InspectionScheduleResponse> {
    return this.http.post<InspectionScheduleResponse>(this.url(vehicleId), payload);
  }

  /** `DELETE` — desativa. 204 sem corpo. */
  deactivate(vehicleId: string): Observable<void> {
    return this.http.delete<void>(this.url(vehicleId));
  }

  private url(vehicleId: string): string {
    return `${environment.apiUrl}/vehicles/${vehicleId}/inspection-schedule`;
  }
}
