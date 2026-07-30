import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InsurancesService } from './insurances.service';
import type { InsuranceListItem } from '../types/insurance.types';

/**
 * Cobre o cache em signals da listagem consolidada e, principalmente, o
 * `reset()`: o serviço é `providedIn: 'root'` e o logout não recarrega a
 * página, então sem zerar o cache o próximo usuário da MESMA aba veria as
 * apólices (com placa) do usuário anterior.
 */
describe('InsurancesService', () => {
  const row = {
    id: 'i-1',
    vehicleId: 'v-1',
    plate: 'ABC1D23',
    insurerName: 'Seguradora Alpha',
    status: 'ACTIVE',
  } as unknown as InsuranceListItem;

  const page = {
    content: [row],
    page: 1,
    size: 5,
    total: 1,
  };

  let httpGet: ReturnType<typeof vi.fn>;
  let service: InsurancesService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    httpGet = vi.fn(() => of(page));

    TestBed.configureTestingModule({
      providers: [InsurancesService, { provide: HttpClient, useValue: { get: httpGet } }],
    });
    service = TestBed.inject(InsurancesService);
  });

  it('publica a página nos signals de cache', () => {
    service.list({ page: 1, size: 5 }).subscribe();

    expect(service.insurances()).toEqual([row]);
    expect(service.page()).toBe(1);
    expect(service.size()).toBe(5);
    expect(service.total()).toBe(1);
    expect(service.loading()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('reset devolve todos os signals ao estado inicial', () => {
    service.list({ page: 1, size: 5 }).subscribe();
    expect(service.insurances()).toEqual([row]);

    service.reset();

    expect(service.insurances()).toEqual([]);
    expect(service.page()).toBe(0);
    expect(service.size()).toBe(20);
    expect(service.total()).toBe(0);
    expect(service.loading()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('reset limpa também a mensagem de erro herdada', () => {
    httpGet.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    service.list().subscribe({ error: () => void 0 });
    expect(service.error()).toBe('Não foi possível carregar os seguros.');

    service.reset();

    expect(service.error()).toBeNull();
  });
});
