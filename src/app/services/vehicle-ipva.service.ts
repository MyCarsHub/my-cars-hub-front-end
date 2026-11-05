import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  GenerateIpvaInstallmentsRequest,
  IpvaInstallmentRequest,
  IpvaYear,
  PayIpvaInstallmentRequest,
} from '../types/vehicle-ipva.types';

/**
 * IPVA por exercício de um veículo (`/v1/vehicles/{vehicleId}/ipva`).
 *
 * Sem cache: toda mutação devolve o `IpvaYear` COMPLETO do exercício, então a
 * tela repinta com a resposta e nenhum GET de confirmação é necessário.
 */
@Injectable({ providedIn: 'root' })
export class VehicleIpvaService {
  private readonly http = inject(HttpClient);

  private base(vehicleId: string): string {
    return `${environment.apiUrl}/vehicles/${vehicleId}/ipva`;
  }

  /** Exercícios com parcelas, do mais novo para o mais antigo. */
  listYears(vehicleId: string): Observable<IpvaYear[]> {
    return this.http.get<IpvaYear[]>(this.base(vehicleId));
  }

  generate(
    vehicleId: string,
    year: number,
    payload: GenerateIpvaInstallmentsRequest,
  ): Observable<IpvaYear> {
    return this.http.post<IpvaYear>(
      `${this.base(vehicleId)}/${year}/installments/generate`,
      payload,
    );
  }

  add(vehicleId: string, year: number, payload: IpvaInstallmentRequest): Observable<IpvaYear> {
    return this.http.post<IpvaYear>(`${this.base(vehicleId)}/${year}/installments`, payload);
  }

  update(
    vehicleId: string,
    year: number,
    installmentId: string,
    payload: IpvaInstallmentRequest,
  ): Observable<IpvaYear> {
    return this.http.put<IpvaYear>(
      `${this.base(vehicleId)}/${year}/installments/${installmentId}`,
      payload,
    );
  }

  remove(vehicleId: string, year: number, installmentId: string): Observable<IpvaYear> {
    return this.http.delete<IpvaYear>(
      `${this.base(vehicleId)}/${year}/installments/${installmentId}`,
    );
  }

  pay(
    vehicleId: string,
    year: number,
    installmentId: string,
    payload: PayIpvaInstallmentRequest,
  ): Observable<IpvaYear> {
    return this.http.patch<IpvaYear>(
      `${this.base(vehicleId)}/${year}/installments/${installmentId}/pay`,
      payload,
    );
  }

  unpay(vehicleId: string, year: number, installmentId: string): Observable<IpvaYear> {
    return this.http.patch<IpvaYear>(
      `${this.base(vehicleId)}/${year}/installments/${installmentId}/unpay`,
      {},
    );
  }
}
