import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, expand, map, reduce } from 'rxjs';

import { environment } from '../../environments/environment';
import { Expense, ExpenseRequest } from '../types/expense.types';
import { PagedResponse } from '../types/paged.types';

const BASE = `${environment.apiUrl}/expenses`;

/** O back-end limita a página a 100. */
export const EXPENSES_PAGE_SIZE = 100;
/** Trava de segurança: 5.000 gastos num só mês já é erro de uso, não volume. */
const MAX_PAGES = 50;

/**
 * Gastos (`/v1/expenses`). Sem cache de propósito: o estado mora no componente, então não há
 * o que vazar na troca de empresa.
 */
@Injectable({ providedIn: 'root' })
export class ExpensesService {
  private readonly http = inject(HttpClient);

  /** UMA página de um mês `yyyy-MM`. */
  page(month: string, page: number): Observable<PagedResponse<Expense>> {
    const params = new HttpParams()
      .set('month', month)
      .set('page', String(page))
      .set('size', String(EXPENSES_PAGE_SIZE));
    return this.http.get<PagedResponse<Expense>>(BASE, { params });
  }

  /**
   * O mês INTEIRO, página a página: os totais do topo (valor do mês, maior categoria, da
   * locadora toda) só são verdade com todos os lançamentos, não com a primeira página.
   */
  listMonth(month: string): Observable<Expense[]> {
    return this.page(month, 0).pipe(
      expand((res) => {
        const next = res.page + 1;
        const more = next < MAX_PAGES && next * res.size < res.total;
        return more ? this.page(month, next) : EMPTY;
      }),
      map((res) => res.content ?? []),
      reduce((all, chunk) => all.concat(chunk), [] as Expense[]),
    );
  }

  getOne(id: string): Observable<Expense> {
    return this.http.get<Expense>(`${BASE}/${id}`);
  }

  create(payload: ExpenseRequest): Observable<Expense> {
    return this.http.post<Expense>(BASE, payload);
  }

  update(id: string, payload: ExpenseRequest): Observable<Expense> {
    return this.http.put<Expense>(`${BASE}/${id}`, payload);
  }

  remove(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`, { responseType: 'text' }).pipe(map(() => void 0));
  }
}
