import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FleetActivationService } from './fleet-activation.service';
import { SessionService } from './session.service';
import { environment } from '../../environments/environment';

/**
 * FEAT-0080 — a corrida que devolveria o gate DEPOIS do cadastro: uma consulta
 * em voo não pode sobrescrever o `markHasVehicles()` disparado pelo POST de
 * criação enquanto ela voava.
 */
describe('FleetActivationService — corrida markHasVehicles vs consulta em voo', () => {
  const VEHICLES_URL = `${environment.apiUrl}/vehicles`;

  let httpMock: HttpTestingController;
  let service: FleetActivationService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    sessionStorage.clear();
    TestBed.inject(SessionService).setItem('selectedCompanyId', 'empresa-a');
    service = TestBed.inject(FleetActivationService);
  });

  afterEach(() => {
    httpMock.verify();
    sessionStorage.clear();
  });

  it('resposta velha (frota vazia) NÃO sobrescreve o markHasVehicles feito durante o voo', () => {
    let stale: boolean | undefined;
    service.hasVehicles().subscribe((v) => (stale = v));

    // O POST de criação acontece ENQUANTO a consulta voa.
    service.markHasVehicles();

    // A resposta velha chega depois: operacional 0 → sonda de vendidos 0.
    httpMock
      .expectOne((r) => r.url === VEHICLES_URL && r.params.get('sold') === null)
      .flush({ content: [], page: 0, size: 1, total: 0 });
    httpMock
      .expectOne((r) => r.url === VEHICLES_URL && r.params.get('sold') === 'true')
      .flush({ content: [], page: 0, size: 1, total: 0 });

    // O assinante antigo TAMBÉM recebe a verdade mais fresca: um guard que
    // assinou antes do POST não pode redirecionar com o `false` velho depois
    // de o veículo existir.
    expect(stale).toBe(true);

    // E o cache segue com a verdade: sem nova requisição, `true`.
    let fresh: boolean | undefined;
    service.hasVehicles().subscribe((v) => (fresh = v));
    expect(fresh).toBe(true);
    httpMock.expectNone((r) => r.url === VEHICLES_URL);
  });

  /**
   * Relogin na MESMA empresa: `SessionService.clear()` é o único caminho que a
   * chave por empresa não pega (a chave não muda). O gancho no
   * `SessionResetRegistry` existe exatamente para isso — este spec é o que
   * impede alguém de apagar o `register()` sem quebrar nada.
   */
  it('SessionService.clear() derruba o cache: próximo hasVehicles() volta a requisitar', () => {
    let first: boolean | undefined;
    service.hasVehicles().subscribe((v) => (first = v));
    httpMock
      .expectOne((r) => r.url === VEHICLES_URL && r.params.get('sold') === null)
      .flush({ content: [], page: 0, size: 1, total: 2 });
    expect(first).toBe(true);

    // Logout + relogin na MESMA empresa, sem nenhuma chamada entre os dois.
    const session = TestBed.inject(SessionService);
    session.clear();
    session.setItem('selectedCompanyId', 'empresa-a');

    let second: boolean | undefined;
    service.hasVehicles().subscribe((v) => (second = v));
    httpMock
      .expectOne((r) => r.url === VEHICLES_URL && r.params.get('sold') === null)
      .flush({ content: [], page: 0, size: 1, total: 0 });
    httpMock
      .expectOne((r) => r.url === VEHICLES_URL && r.params.get('sold') === 'true')
      .flush({ content: [], page: 0, size: 1, total: 0 });
    expect(second).toBe(false);
  });
});
