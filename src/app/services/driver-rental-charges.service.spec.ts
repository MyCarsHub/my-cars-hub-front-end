import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { DriverRentalChargesService } from './driver-rental-charges.service';

describe('DriverRentalChargesService', () => {
  let service: DriverRentalChargesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DriverRentalChargesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('GET /rentals/{id}/charges, sem corpo nem id de motorista', () => {
    service.list('r 1').subscribe();

    const req = http.expectOne(`${environment.apiUrl}/rentals/r%201/charges`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('mapeia os campos do contrato e completa os ausentes com null', () => {
    let result: unknown;
    service.list('r-1').subscribe((r) => (result = r));

    http.expectOne(`${environment.apiUrl}/rentals/r-1/charges`).flush([
      {
        id: 'c-1',
        kind: 'CAUCAO',
        amount: 50000,
        status: 'PENDING',
        checkoutUrl: 'https://pay.example/i/1',
        providerRaw: 'não deve passar',
      },
    ]);

    expect(result).toEqual([
      {
        id: 'c-1',
        kind: 'CAUCAO',
        amount: 50000,
        status: 'PENDING',
        dueDate: null,
        periodIndex: null,
        paidAt: null,
        checkoutUrl: 'https://pay.example/i/1',
      },
    ]);
  });

  it('descarta linha sem id ou sem valor e tolera resposta que não é lista', () => {
    const results: unknown[] = [];
    service.list('r-1').subscribe((r) => results.push(r));
    service.list('r-1').subscribe((r) => results.push(r));

    const [first, second] = http.match(`${environment.apiUrl}/rentals/r-1/charges`);
    first.flush([{ kind: 'CAUCAO' }, null, 'x']);
    second.flush({ erro: true });

    expect(results).toEqual([[], []]);
  });
});
