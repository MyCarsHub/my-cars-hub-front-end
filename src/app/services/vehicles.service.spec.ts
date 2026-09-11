import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VehiclesService } from './vehicles.service';
import { OWNED_HTTP_ERRORS } from './http-errors.context';
import { environment } from '../../environments/environment';
import type { VehicleListItem } from '../types/vehicle.types';

/**
 * Contrato de FIO da LISTAGEM (FIX-0263/0264): cada item de
 * GET /v1/vehicles traz `sold: boolean` — nunca null, derivado pela própria
 * query no backend. O chip "Vendido" da lista depende deste campo; se o shape
 * mudar, é AQUI que o verde tem que quebrar, não na tela.
 */
describe('VehiclesService — contrato de fio da listagem (FIX-0263/0264)', () => {
  const BASE = `${environment.apiUrl}/vehicles`;

  /** O shape EXATO que o backend devolve por item (BE fd08531). */
  const wireItem = {
    id: 'veh-1',
    plate: 'ABC1D23',
    type: 'CAR',
    brand: 'Fiat',
    model: 'Argo',
    yearModel: 2022,
    licensingExpiration: '2026-12-31',
    status: 'AVAILABLE',
    createdDate: '2024-01-01',
    sold: true,
  };

  let service: VehiclesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [VehiclesService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(VehiclesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('expõe `sold` do item da listagem como boolean, pinando as chaves do wire', () => {
    let received: VehicleListItem[] = [];
    service.list().subscribe((res) => (received = res.content));

    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url === BASE);
    req.flush({
      content: [wireItem, { ...wireItem, id: 'veh-2', sold: false }],
      page: 0,
      size: 20,
      total: 2,
    });

    // As chaves do item no fio — se o backend renomear `sold`, quebra aqui.
    expect(Object.keys(wireItem).sort()).toEqual([
      'brand',
      'createdDate',
      'id',
      'licensingExpiration',
      'model',
      'plate',
      'sold',
      'status',
      'yearModel',
      'type',
    ].sort());

    expect(received[0].sold).toBe(true);
    expect(received[1].sold).toBe(false);
    expect(service.items()[0].sold).toBe(true);
  });

  it('não manda o parâmetro `sold` por padrão e manda `sold=true` no modo Vendidos', () => {
    service.list().subscribe();
    const plain = httpMock.expectOne((r) => r.method === 'GET' && r.url === BASE);
    expect(plain.request.params.has('sold')).toBe(false);
    plain.flush({ content: [], page: 0, size: 20, total: 0 });

    service.list({ sold: true }).subscribe();
    const soldReq = httpMock.expectOne((r) => r.method === 'GET' && r.url === BASE);
    expect(soldReq.request.params.get('sold')).toBe('true');
    soldReq.flush({ content: [], page: 0, size: 20, total: 0 });
  });
});

/**
 * FEAT-0082 — fio do plate-lookup (contrato congelado FEAT-0081):
 * 200 devolve o corpo, 204 vira null, e o 501 (feature desligada) marca
 * `plateLookupUnavailable` para o formulário parar de oferecer o botão.
 */
describe('VehiclesService — plate-lookup (FEAT-0082)', () => {
  const BASE = `${environment.apiUrl}/vehicles`;
  let service: VehiclesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [VehiclesService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(VehiclesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('200 → corpo do contrato, com o param `plate`', () => {
    const body = {
      plate: 'ABC1D23',
      brand: 'Fiat',
      model: 'Argo',
      manufactureYear: 2021,
      modelYear: 2022,
      fuel: 'Gasolina',
      color: 'Prata',
    };
    let received: unknown;
    service.plateLookup('ABC1D23').subscribe((r) => (received = r));

    const req = httpMock.expectOne((r) => r.url === `${BASE}/plate-lookup`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('plate')).toBe('ABC1D23');
    // OWNED_HTTP_ERRORS: o componente é o dono dos status de NEGÓCIO — sem a
    // marca, o errorInterceptor toastaria "Erro no servidor" no 501/503.
    expect(req.request.context.get(OWNED_HTTP_ERRORS)).toBe(true);
    req.flush(body);

    expect(received).toEqual(body);
    expect(service.plateLookupUnavailable()).toBe(false);
  });

  it('204 → null (placa não encontrada, não é erro)', () => {
    let received: unknown = 'sentinela';
    service.plateLookup('ABC1D23').subscribe((r) => (received = r));

    httpMock
      .expectOne((r) => r.url === `${BASE}/plate-lookup`)
      .flush(null, { status: 204, statusText: 'No Content' });

    expect(received).toBeNull();
  });

  it('501 → marca plateLookupUnavailable para a sessão e propaga o erro', () => {
    let status = 0;
    service.plateLookup('ABC1D23').subscribe({
      error: (err: { status: number }) => (status = err.status),
    });

    httpMock
      .expectOne((r) => r.url === `${BASE}/plate-lookup`)
      .flush({ message: 'off' }, { status: 501, statusText: 'Not Implemented' });

    expect(status).toBe(501);
    expect(service.plateLookupUnavailable()).toBe(true);
  });
});
