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

  /**
   * `POST /v1/inspection-schedules/fleet` — a regra da FROTA, uma linha sem veiculo.
   *
   * Rota propria, nao a por veiculo com id opcional: o backend decidiu assim para uma URL
   * nao significar duas coisas. 400 quando a empresa JA tem uma regra de frota vigente —
   * o UNIQUE parcial garante no maximo uma, e a tela trata isso como "ja existe", nao como
   * falha.
   */
  createForFleet(
    payload: CreateInspectionScheduleRequest,
  ): Observable<InspectionScheduleResponse> {
    return this.http.post<InspectionScheduleResponse>(
      `${environment.apiUrl}/inspection-schedules/fleet`,
      payload,
    );
  }

  /**
   * `GET /v1/inspection-schedules` — frota E veiculos, vigentes, da empresa do token.
   *
   * Empresa sem nenhum devolve LISTA VAZIA, nao 404 — ao contrario do `get` por veiculo.
   * As duas rotas respondem perguntas diferentes e por isso respondem o vazio de formas
   * diferentes; tratar esta como aquela faria a tela achar que a leitura falhou.
   */
  listForCompany(): Observable<InspectionScheduleResponse[]> {
    return this.http.get<InspectionScheduleResponse[]>(
      `${environment.apiUrl}/inspection-schedules`,
    );
  }

  /** `DELETE` — desativa o agendamento DE UM VEICULO. 204 sem corpo. */
  deactivate(vehicleId: string): Observable<void> {
    return this.http.delete<void>(this.url(vehicleId));
  }

  private url(vehicleId: string): string {
    return `${environment.apiUrl}/vehicles/${vehicleId}/inspection-schedule`;
  }
}
