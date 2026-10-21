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

  describe('pix()', () => {
    const url = `${environment.apiUrl}/rentals/r%201/charges/c%2F1/pix`;

    it('GET .../charges/{chargeId}/pix com os ids codificados, e mapeia o contrato', () => {
      let result: unknown;
      service.pix('r 1', 'c/1').subscribe((r) => (result = r));

      const req = http.expectOne(url);
      expect(req.request.method).toBe('GET');
      req.flush({ payload: ' 000201PIX ', qrCodeBase64: 'iVBOR', expiresAt: '2026-10-22T03:00:00Z' });

      expect(result).toEqual({
        payload: '000201PIX',
        qrCodeBase64: 'iVBOR',
        expiresAt: '2026-10-22T03:00:00Z',
      });
    });

    it('resposta sem código é ERRO, nunca um código vazio para copiar', () => {
      let failed = false;
      service.pix('r 1', 'c/1').subscribe({ error: () => (failed = true) });

      http.expectOne(url).flush({ payload: '   ', qrCodeBase64: null });

      expect(failed).toBe(true);
    });

    it('o 503 do provedor chega ao chamador com o corpo intacto', () => {
      let status = 0;
      service.pix('r 1', 'c/1').subscribe({
        error: (err: { status: number }) => (status = err.status),
      });

      http
        .expectOne(url)
        .flush({ message: 'Pix indisponível agora.' }, { status: 503, statusText: 'Unavailable' });

      expect(status).toBe(503);
    });
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

  it('link de pagamento só http(s): javascript:, texto solto e vazio viram null', () => {
    let result: { checkoutUrl: string | null }[] = [];
    service.list('r-1').subscribe((r) => (result = r));

    const row = (id: string, checkoutUrl: unknown) => ({
      id,
      kind: 'RENTAL_PERIOD',
      amount: 1,
      status: 'PENDING',
      checkoutUrl,
    });
    http.expectOne(`${environment.apiUrl}/rentals/r-1/charges`).flush([
      row('a', 'javascript:alert(1)'),
      row('b', 'pagar aqui'),
      row('c', ''),
      row('d', 'https://pay.example/i/1'),
      row('e', 'http://pay.example/i/2'),
    ]);

    expect(result.map((c) => c.checkoutUrl)).toEqual([
      null,
      null,
      null,
      'https://pay.example/i/1',
      'http://pay.example/i/2',
    ]);
  });

  it('status que esta versão não conhece vira cobrança aberta sem botão, e não some', () => {
    let result: { status: string; checkoutUrl: string | null }[] = [];
    service.list('r-1').subscribe((r) => (result = r));

    http.expectOne(`${environment.apiUrl}/rentals/r-1/charges`).flush([
      {
        id: 'x',
        kind: 'RENTAL_PERIOD',
        amount: 1,
        status: 'IN_ANALYSIS',
        checkoutUrl: 'https://pay.example/i/1',
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({ id: 'x', status: 'PENDING', checkoutUrl: null }),
    ]);
  });
});
