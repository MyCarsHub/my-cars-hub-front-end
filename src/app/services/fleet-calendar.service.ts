import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { FleetCalendarQuery, FleetCalendarResponse } from '../types/fleet-calendar.types';

const BASE = `${environment.apiUrl}/fleet/calendar`;

/**
 * Ocupação da frota no tempo.
 *
 * Serviço deliberadamente sem estado: a tela é uma única leitura por janela e
 * guardar a resposta aqui só criaria cache a invalidar a cada navegação de
 * período. Erro e loading ficam no componente, que é quem sabe qual janela
 * pediu.
 */
@Injectable({ providedIn: 'root' })
export class FleetCalendarService {
  private readonly http = inject(HttpClient);

  /**
   * Os três parâmetros são opcionais. Sem `from`/`to` o backend aplica o mês
   * corrente em `America/Sao_Paulo` e ecoa a janela efetiva na resposta — é a
   * janela da RESPOSTA que deve alimentar a grade.
   *
   * Recusas conhecidas: janela acima de 366 dias e janela invertida voltam 400
   * com a mensagem de negócio; `vehicleId` de outra empresa volta 404.
   */
  calendar(query: FleetCalendarQuery = {}): Observable<FleetCalendarResponse> {
    let params = new HttpParams();
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.vehicleId) params = params.set('vehicleId', query.vehicleId);

    return this.http.get<FleetCalendarResponse>(BASE, { params });
  }
}
