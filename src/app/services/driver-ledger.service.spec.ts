import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { LedgerEntryRequest } from '../types/driver-ledger.types';
import { DriverLedgerService } from './driver-ledger.service';

const LEDGER = `${environment.apiUrl}/driver/ledger`;
const DASHBOARD = `${environment.apiUrl}/driver/dashboard`;

const wireEntry = {
  id: 'e-1',
  kind: 'INCOME',
  category: 'RIDES',
  amountCents: 25000,
  occurredOn: '2026-10-09',
  description: null,
  rentalId: null,
  createdDate: '2026-10-09T10:00:00',
  modifyDate: null,
};

describe('DriverLedgerService', () => {
  let service: DriverLedgerService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DriverLedgerService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lista com os filtros do contrato e a paginação, e NUNCA manda id de motorista', () => {
    service
      .list({
        from: '2026-10-01',
        to: '2026-10-31',
        kind: 'EXPENSE',
        category: 'FUEL',
        rentalId: 'r-1',
        page: 2,
        size: 10,
      })
      .subscribe();

    const req = http.expectOne((r) => r.url === LEDGER);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('from')).toBe('2026-10-01');
    expect(req.request.params.get('to')).toBe('2026-10-31');
    expect(req.request.params.get('kind')).toBe('EXPENSE');
    expect(req.request.params.get('category')).toBe('FUEL');
    expect(req.request.params.get('rentalId')).toBe('r-1');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('size')).toBe('10');
    expect(req.request.params.has('driverId')).toBe(false);
    req.flush({ content: [], page: 2, size: 10, total: 0 });
  });

  it('filtro ausente ou nulo não vai na query', () => {
    service.list({ kind: null, category: null }).subscribe();

    const req = http.expectOne((r) => r.url === LEDGER);
    expect(req.request.params.has('kind')).toBe(false);
    expect(req.request.params.has('category')).toBe(false);
    expect(req.request.params.get('page')).toBe('0');
    expect(req.request.params.get('size')).toBe('20');
    req.flush({ content: [], page: 0, size: 20, total: 0 });
  });

  it('devolve o envelope paginado com as linhas adaptadas e descarta a que não dá para editar', () => {
    let received: { content: unknown[]; total: number } | undefined;
    service.list().subscribe((res) => (received = res));

    http
      .expectOne((r) => r.url === LEDGER)
      .flush({
        content: [wireEntry, { ...wireEntry, id: null }],
        page: 0,
        size: 20,
        total: 2,
      });

    expect(received?.content).toHaveLength(1);
    expect(received?.total).toBe(2);
  });

  it('cria com POST, o corpo de seis campos e sem identidade no corpo', () => {
    const payload: LedgerEntryRequest = {
      kind: 'INCOME',
      category: 'RIDES',
      amountCents: 25000,
      occurredOn: '2026-10-09',
      description: null,
      rentalId: null,
    };
    let created: { id: string } | undefined;
    service.create(payload).subscribe((e) => (created = e));

    const req = http.expectOne(LEDGER);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    expect(Object.keys(req.request.body as object).sort()).toEqual(
      ['amountCents', 'category', 'description', 'kind', 'occurredOn', 'rentalId'].sort(),
    );
    req.flush(wireEntry, { status: 201, statusText: 'Created' });
    expect(created?.id).toBe('e-1');
  });

  it('edita com PUT no id, substituindo o lançamento inteiro', () => {
    const payload: LedgerEntryRequest = {
      kind: 'EXPENSE',
      category: 'FUEL',
      amountCents: 9000,
      occurredOn: '2026-10-09',
      description: 'Posto',
      rentalId: 'r-1',
    };
    service.update('e-1', payload).subscribe();

    const req = http.expectOne(`${LEDGER}/e-1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(payload);
    req.flush({ ...wireEntry, kind: 'EXPENSE', category: 'FUEL' });
  });

  it('apaga com DELETE no id', () => {
    service.remove('e-1').subscribe();

    const req = http.expectOne(`${LEDGER}/e-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('uma resposta de gravação sem forma de lançamento é erro, não um lançamento fantasma', () => {
    let failed = false;
    service
      .create({
        kind: 'INCOME',
        category: 'RIDES',
        amountCents: 1,
        occurredOn: '2026-10-09',
        description: null,
        rentalId: null,
      })
      .subscribe({ error: () => (failed = true) });

    http.expectOne(LEDGER).flush({ ok: true });
    expect(failed).toBe(true);
  });

  it('o painel pede o período e entrega o DTO adaptado', () => {
    let totals: unknown;
    service.dashboard('2026-10-01', '2026-10-31').subscribe((d) => (totals = d.totals));

    const req = http.expectOne((r) => r.url === DASHBOARD);
    expect(req.request.params.get('from')).toBe('2026-10-01');
    expect(req.request.params.get('to')).toBe('2026-10-31');
    req.flush({
      from: '2026-10-01',
      to: '2026-10-31',
      totals: { incomeCents: 1000, expenseCents: 400, netCents: 600, entryCount: 3 },
    });
    expect(totals).toEqual({ incomeCents: 1000, expenseCents: 400, netCents: 600, entryCount: 3 });
  });
});
