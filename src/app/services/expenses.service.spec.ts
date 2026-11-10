import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../environments/environment';
import { Expense, ExpenseRequest } from '../types/expense.types';
import { ExpensesService } from './expenses.service';

const BASE = `${environment.apiUrl}/expenses`;

function exp(id: string): Expense {
  return {
    id,
    createdDate: null,
    modifyDate: null,
    companyId: 'c',
    vehicleId: null,
    vehicleLabel: null,
    category: 'FUEL',
    categoryLabel: 'Abastecimento',
    description: id,
    expenseDate: '2026-11-08',
    amountCents: 100,
  };
}

describe('ExpensesService', () => {
  let svc: ExpensesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(ExpensesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('listMonth pede o mês e anda por TODAS as páginas (o back-end limita a 100)', () => {
    let result: Expense[] = [];
    svc.listMonth('2026-11').subscribe((r) => (result = r));

    const first = http.expectOne((r) => r.url === BASE && r.params.get('page') === '0');
    expect(first.request.params.get('month')).toBe('2026-11');
    expect(first.request.params.get('size')).toBe('100');
    first.flush({ content: [exp('a'), exp('b')], page: 0, size: 100, total: 150 });

    const second = http.expectOne((r) => r.url === BASE && r.params.get('page') === '1');
    second.flush({ content: [exp('c')], page: 1, size: 100, total: 150 });

    expect(result.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('um mês de uma página só faz uma requisição', () => {
    let result: Expense[] = [];
    svc.listMonth('2026-10').subscribe((r) => (result = r));
    http.expectOne((r) => r.url === BASE).flush({ content: [exp('a')], page: 0, size: 100, total: 1 });
    expect(result).toHaveLength(1);
  });

  it('create envia o corpo do contrato: centavos, data e veículo nulo', () => {
    const body: ExpenseRequest = {
      vehicleId: null,
      category: 'ACCOUNTING_ADMIN',
      description: 'Honorário',
      expenseDate: '2026-11-01',
      amountCents: 45000,
    };
    svc.create(body).subscribe();
    const req = http.expectOne(BASE);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    expect(req.request.body.vehicleId).toBeNull();
    req.flush(exp('n'));
  });

  it('update é PUT no id e remove é DELETE no id', () => {
    const body: ExpenseRequest = {
      vehicleId: 'v1',
      category: 'FUEL',
      description: 'x',
      expenseDate: '2026-11-02',
      amountCents: 1,
    };
    svc.update('e1', body).subscribe();
    const put = http.expectOne(`${BASE}/e1`);
    expect(put.request.method).toBe('PUT');
    put.flush(exp('e1'));

    svc.remove('e1').subscribe();
    const del = http.expectOne(`${BASE}/e1`);
    expect(del.request.method).toBe('DELETE');
    del.flush('');
  });
});
