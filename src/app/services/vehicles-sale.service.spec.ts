import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VehiclesService } from './vehicles.service';
import { environment } from '../../environments/environment';
import type { Vehicle } from '../types/vehicle.types';

/**
 * O CONTRATO DE FIO da venda de veículo (FEAT-0072), com o `VehiclesService`
 * REAL e o `HttpTestingController` — sem mock do service.
 *
 * POR QUE ESTE ARQUIVO EXISTE: a primeira versão desta feature mockava o
 * service inteiro no spec da tela, então o spec AFIRMAVA o contrato que o
 * próprio código inventou (`soldAt`/`amount`) e passava verde — enquanto o
 * backend, que não tem `PropertyNamingStrategy` nem `@JsonAlias`, teria
 * devolvido 400 em toda venda. Um teste que só observa o que o mock recebeu
 * nunca vê o JSON. Aqui o JSON é o assunto: nomes de campo exatos do
 * `SellVehicleRequestDto` e dinheiro em CENTAVOS.
 */
describe('VehiclesService — contrato de fio da venda (FEAT-0072)', () => {
  const VEHICLE_ID = 'veh-1';
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

  afterEach(() => {
    httpMock.verify();
  });

  it('POSTa em /sale exatamente os campos do SellVehicleRequestDto, com centavos', () => {
    service
      .sell(VEHICLE_ID, {
        buyerName: 'Maria Compradora',
        saleDate: '2026-08-20',
        saleValueCents: 4_500_000,
      })
      .subscribe();

    const req = httpMock.expectOne(`${BASE}/${VEHICLE_ID}/sale`);
    expect(req.request.method).toBe('POST');

    // O JSON QUE SAI NO FIO — nomes exatos, nada de soldAt/amount/price.
    expect(req.request.body).toEqual({
      buyerName: 'Maria Compradora',
      saleDate: '2026-08-20',
      saleValueCents: 4_500_000,
    });
    const keys = Object.keys(req.request.body as Record<string, unknown>).sort();
    expect(keys).toEqual(['buyerName', 'saleDate', 'saleValueCents']);

    req.flush({ id: VEHICLE_ID } as Vehicle);
  });

  it('DELETA /sale mandando o motivo em `reason` na query', () => {
    service.undoSale(VEHICLE_ID, 'Venda desfeita pelo operador').subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${BASE}/${VEHICLE_ID}/sale`,
    );
    expect(req.request.params.get('reason')).toBe('Venda desfeita pelo operador');

    req.flush({ id: VEHICLE_ID } as Vehicle);
  });

  /**
   * O `sale` do GET é lido pela tela (banner com comprador/data/valor). Se os
   * nomes divergirem, a tela renderiza `undefined` — que foi exatamente o
   * segundo defeito desta feature. Aqui o DTO do backend entra cru.
   */
  it('lê o `sale` do GET com os nomes do VehicleSaleDto', () => {
    let received: Vehicle | undefined;
    service.getOne(VEHICLE_ID).subscribe((v) => (received = v));

    httpMock.expectOne(`${BASE}/${VEHICLE_ID}`).flush({
      id: VEHICLE_ID,
      sale: {
        id: 'sale-1',
        buyerName: 'Maria Compradora',
        saleDate: '2026-08-20',
        saleValueCents: 4_500_000,
        createdDate: '2026-08-20T10:00:00',
      },
    });

    expect(received?.sale?.buyerName).toBe('Maria Compradora');
    expect(received?.sale?.saleDate).toBe('2026-08-20');
    expect(received?.sale?.saleValueCents).toBe(4_500_000);
  });

  it('a listagem só manda `sold` quando o filtro pede os vendidos', () => {
    service.list({}).subscribe();
    const operacional = httpMock.expectOne((r) => r.url === BASE);
    expect(operacional.request.params.has('sold')).toBe(false);
    operacional.flush({ content: [], page: 0, size: 20, total: 0 });

    service.list({ sold: true }).subscribe();
    const vendidos = httpMock.expectOne((r) => r.url === BASE);
    expect(vendidos.request.params.get('sold')).toBe('true');
    vendidos.flush({ content: [], page: 0, size: 20, total: 0 });
  });
});
