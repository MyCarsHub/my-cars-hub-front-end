import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FipeService } from './fipe.service';
import { OWNED_HTTP_ERRORS } from './http-errors.context';
import { environment } from '../../environments/environment';

/**
 * FEAT-0084 — catálogo FIPE: listas cacheadas em memória (o catálogo muda uma
 * vez por mês), erro NUNCA fica cacheado (a próxima tentativa pergunta de novo).
 */
describe('FipeService — cache do catálogo', () => {
  const BRANDS_URL = `${environment.apiUrl}/fipe/brands`;

  let service: FipeService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(FipeService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('cacheia por caminho: segunda chamada não custa request', () => {
    let first: unknown;
    service.brands().subscribe((r) => (first = r));
    const req = httpMock.expectOne(BRANDS_URL);
    // OWNED_HTTP_ERRORS: catálogo é acessório; 5xx é fallback silencioso do
    // formulário, nunca toast do interceptor.
    expect(req.request.context.get(OWNED_HTTP_ERRORS)).toBe(true);
    req.flush([{ code: '21', name: 'Fiat' }]);
    expect(first).toEqual([{ code: '21', name: 'Fiat' }]);

    let second: unknown;
    service.brands().subscribe((r) => (second = r));
    expect(second).toEqual([{ code: '21', name: 'Fiat' }]);
    httpMock.expectNone(BRANDS_URL);

    // Modelos são outro caminho — request próprio, com o code na URL.
    service.models('21').subscribe();
    httpMock.expectOne(`${environment.apiUrl}/fipe/brands/21/models`).flush([]);
  });

  it('chamadas concorrentes compartilham UMA requisição em voo', () => {
    let a: unknown;
    let b: unknown;
    service.brands().subscribe((r) => (a = r));
    service.brands().subscribe((r) => (b = r));

    httpMock.expectOne(BRANDS_URL).flush([{ code: '21', name: 'Fiat' }]);
    expect(a).toEqual([{ code: '21', name: 'Fiat' }]);
    expect(b).toEqual([{ code: '21', name: 'Fiat' }]);
  });

  it('resposta VAZIA não fica cacheada: a tentativa seguinte refaz o request', () => {
    let first: unknown;
    service.brands().subscribe((r) => (first = r));
    httpMock.expectOne(BRANDS_URL).flush([]);
    expect(first).toEqual([]);

    // Sem isto, o "Selecionar da tabela FIPE" viraria controle morto: clica,
    // volta [] do cache para sempre e cai para manual sem nunca reperguntar.
    let second: unknown;
    service.brands().subscribe((r) => (second = r));
    httpMock.expectOne(BRANDS_URL).flush([{ code: '21', name: 'Fiat' }]);
    expect(second).toEqual([{ code: '21', name: 'Fiat' }]);
  });

  it('cache expira após o TTL: sessão longa não serve catálogo velho para sempre', () => {
    vi.useFakeTimers();
    try {
      service.brands().subscribe();
      httpMock.expectOne(BRANDS_URL).flush([{ code: '21', name: 'Fiat' }]);

      // Dentro do TTL (3h): cache responde, sem request.
      vi.advanceTimersByTime(60 * 60 * 1000);
      service.brands().subscribe();
      httpMock.expectNone(BRANDS_URL);

      // Além do TTL: a tabela FIPE vira mensalmente — nova consulta.
      vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1);
      service.brands().subscribe();
      httpMock.expectOne(BRANDS_URL).flush([{ code: '21', name: 'Fiat' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('erro não fica cacheado: a tentativa seguinte refaz o request', () => {
    let failed = false;
    service.brands().subscribe({ error: () => (failed = true) });
    httpMock.expectOne(BRANDS_URL).flush({ message: 'boom' }, { status: 503, statusText: 'Unavailable' });
    expect(failed).toBe(true);

    let recovered: unknown;
    service.brands().subscribe((r) => (recovered = r));
    httpMock.expectOne(BRANDS_URL).flush([{ code: '21', name: 'Fiat' }]);
    expect(recovered).toEqual([{ code: '21', name: 'Fiat' }]);
  });
});
