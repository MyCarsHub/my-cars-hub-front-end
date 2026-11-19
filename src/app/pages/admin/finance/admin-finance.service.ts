import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import type {
  PlatformCost,
  PlatformCostAmountChange,
  PlatformCostCreate,
  PlatformCostMonth,
  PlatformCostSchedule,
  PlatformCostScheduleEnd,
  PlatformCostScheduleRequest,
  PlatformCostScheduleUpdate,
  PlatformCostUpdate,
  PlatformVendor,
  PlatformVendorRequest,
} from '../../../types/admin-finance.types';

const BASE = `${environment.apiUrl}/admin/finance`;
const id = (value: string): string => encodeURIComponent(value);

/**
 * Fornecedores, custos fixos e lançamentos do mês da plataforma (contrato
 * `2026-11-18_CONTRACT_admin-costs.md`). Sem estado: a página de Custos guarda as respostas e
 * recarrega depois de cada escrita.
 */
@Injectable({ providedIn: 'root' })
export class AdminFinanceService {
  private readonly http = inject(HttpClient);

  // ---------------------------------------------------------------- fornecedores

  vendors(): Observable<PlatformVendor[]> {
    return this.http.get<PlatformVendor[]>(`${BASE}/vendors`);
  }

  createVendor(body: PlatformVendorRequest): Observable<PlatformVendor> {
    return this.http.post<PlatformVendor>(`${BASE}/vendors`, body);
  }

  updateVendor(vendorId: string, body: PlatformVendorRequest): Observable<PlatformVendor> {
    return this.http.put<PlatformVendor>(`${BASE}/vendors/${id(vendorId)}`, body);
  }

  // ---------------------------------------------------------------- custos fixos

  schedules(): Observable<PlatformCostSchedule[]> {
    return this.http.get<PlatformCostSchedule[]>(`${BASE}/cost-schedules`);
  }

  createSchedule(body: PlatformCostScheduleRequest): Observable<PlatformCostSchedule> {
    return this.http.post<PlatformCostSchedule>(`${BASE}/cost-schedules`, body);
  }

  /** Serviço e dia de cobrança da cadeia inteira; o valor não muda aqui. */
  updateSchedule(scheduleId: string, body: PlatformCostScheduleUpdate): Observable<PlatformCostSchedule> {
    return this.http.put<PlatformCostSchedule>(`${BASE}/cost-schedules/${id(scheduleId)}`, body);
  }

  /** "Mudar daqui para frente": devolve o custo fixo que cobre `fromMonth` (id novo, ou o mesmo). */
  changeAmount(scheduleId: string, body: PlatformCostAmountChange): Observable<PlatformCostSchedule> {
    return this.http.post<PlatformCostSchedule>(`${BASE}/cost-schedules/${id(scheduleId)}/amount-change`, body);
  }

  /** Encerra em `endMonth` (inclusive); `null` reabre. */
  endSchedule(scheduleId: string, body: PlatformCostScheduleEnd): Observable<PlatformCostSchedule> {
    return this.http.post<PlatformCostSchedule>(`${BASE}/cost-schedules/${id(scheduleId)}/end`, body);
  }

  // ---------------------------------------------------------------- lançamentos do mês

  /** `month` = `yyyy-MM`. */
  costs(month: string): Observable<PlatformCostMonth> {
    return this.http.get<PlatformCostMonth>(`${BASE}/costs`, { params: new HttpParams().set('month', month) });
  }

  /** "Lançar custo avulso". */
  createCost(body: PlatformCostCreate): Observable<PlatformCost> {
    return this.http.post<PlatformCost>(`${BASE}/costs`, body);
  }

  /** "Editar lançamento": muda só este mês. */
  updateCost(costId: string, body: PlatformCostUpdate): Observable<PlatformCost> {
    return this.http.put<PlatformCost>(`${BASE}/costs/${id(costId)}`, body);
  }

  /** "Tirar do mês": avulso some; fixo vira lápide e nunca mais é lançado naquele mês. */
  deleteCost(costId: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/costs/${id(costId)}`);
  }

  /** "Voltar ao fixo": só `FIXED`. */
  revertCost(costId: string): Observable<PlatformCost> {
    return this.http.post<PlatformCost>(`${BASE}/costs/${id(costId)}/revert`, {});
  }
}
