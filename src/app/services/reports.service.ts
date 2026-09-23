import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ReportsOverviewResponse, VehicleRoiResponse } from '../types/reports.types';
import { TenantResetRegistry } from './tenant-reset.registry';

const BASE = `${environment.apiUrl}/reports`;

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly http = inject(HttpClient);

  private readonly _overview = signal<ReportsOverviewResponse | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  private readonly _vehicleRoi = signal<VehicleRoiResponse | null>(null);
  private readonly _vehicleRoiLoading = signal(false);
  private readonly _vehicleRoiError = signal<string | null>(null);

  readonly overview = this._overview.asReadonly();
  readonly vehicleRoi = this._vehicleRoi.asReadonly();
  readonly vehicleRoiLoading = this._vehicleRoiLoading.asReadonly();
  readonly vehicleRoiError = this._vehicleRoiError.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor() {
    // Troca de empresa e fim de sessao zeram este cache (FIX-0272).
    inject(TenantResetRegistry).register(() => this.reset());
  }

  /**
   * Zera o cache para o estado inicial. Registrado no `TenantCachesService`:
   * o serviço é `providedIn: 'root'` e sobrevive tanto ao fim da sessão quanto
   * à TROCA DE EMPRESA, que não passa por `SessionService.clear()`. Sem isto a
   * empresa nova abre mostrando os relatórios da anterior (FIX-0272).
   */
  reset(): void {
    this._overview.set(null);
    this._loading.set(false);
    this._error.set(null);
    // O ROI e por TENANT como o overview: sem zerar aqui, a empresa nova abre
    // mostrando o payback dos carros da anterior.
    this._vehicleRoi.set(null);
    this._vehicleRoiLoading.set(false);
    this._vehicleRoiError.set(null);
  }

  loadOverview(from: string, to: string): Observable<ReportsOverviewResponse> {
    this._loading.set(true);
    this._error.set(null);
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<ReportsOverviewResponse>(`${BASE}/overview`, { params }).pipe(
      tap((res) => {
        this._overview.set(res);
        this._loading.set(false);
      }),
      catchError((err) => {
        this._error.set('Não foi possível carregar o relatório.');
        this._loading.set(false);
        return throwError(() => err);
      }),
    );
  }

  /**
   * ROI acumulado por veiculo. SEM `from`/`to` de proposito — ver
   * `VehicleRoiResponse`: e a vida inteira do carro, nao um periodo. Se voce
   * veio copiar `loadOverview`, e aqui que os dois divergem.
   *
   * Erro vira mensagem no sinal E propaga: o card do dashboard mostra a falha
   * inline, sem derrubar o resto da tela.
   */
  loadVehicleRoi(): Observable<VehicleRoiResponse> {
    this._vehicleRoiLoading.set(true);
    this._vehicleRoiError.set(null);
    return this.http.get<VehicleRoiResponse>(`${BASE}/vehicle-roi`).pipe(
      tap((res) => {
        this._vehicleRoi.set(res);
        this._vehicleRoiLoading.set(false);
      }),
      catchError((err) => {
        this._vehicleRoiError.set('Nao foi possivel carregar o retorno por veiculo.');
        this._vehicleRoiLoading.set(false);
        return throwError(() => err);
      }),
    );
  }
}
