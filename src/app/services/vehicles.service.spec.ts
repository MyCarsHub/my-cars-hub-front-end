import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VehiclesService } from './vehicles.service';
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
