import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MaintenancesService } from './maintenances.service';
import { environment } from '../../environments/environment';
import type { Maintenance } from '../types/maintenance.types';

const BASE = `${environment.apiUrl}/maintenances`;

const DONE = { id: 'm-1', status: 'DONE' } as unknown as Maintenance;

/**
 * Contrato HTTP das transições. `cancel` não tem corpo no backend: se o
 * `null` virasse `{}` (ou sumisse) o Spring recusaria/interpretaria diferente,
 * então o corpo vazio é assertado explicitamente.
 */
describe('MaintenancesService — transições', () => {
  let service: MaintenancesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [MaintenancesService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MaintenancesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('conclude posta em /{id}/conclude com a leitura no corpo', () => {
    const received = vi.fn();
    service.conclude('m-1', { hodometerReading: 52000 }).subscribe(received);

    const req = http.expectOne(`${BASE}/m-1/conclude`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ hodometerReading: 52000 });

    req.flush(DONE);
    expect(received).toHaveBeenCalledWith(DONE);
  });

  it('conclude sem payload manda um objeto vazio (o backend usa a leitura gravada)', () => {
    service.conclude('m-1').subscribe();

    const req = http.expectOne(`${BASE}/m-1/conclude`);
    expect(req.request.body).toEqual({});
    req.flush(DONE);
  });

  it('cancel posta em /{id}/cancel genuinamente sem corpo', () => {
    service.cancel('m-1').subscribe();

    const req = http.expectOne(`${BASE}/m-1/cancel`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    req.flush({ ...DONE, status: 'CANCELED' });
  });
});
