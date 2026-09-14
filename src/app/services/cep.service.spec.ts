import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CepService } from './cep.service';
import { errorInterceptor } from './error.interceptor';
import { ApiErrorService } from './api-error.service';
import { ImpersonationService } from './impersonation.service';
import { NotificationService } from './notification.service';
import { SessionService } from './session.service';

const VIACEP = 'https://viacep.com.br/ws/01310100/json/';

/**
 * FIX-0107 — a busca de CEP e de outro host, e o interceptor nao pode falar por ela.
 *
 * A chamada ao ViaCEP atravessava o `errorInterceptor` sem marca: status 0 virava
 * "Sem conexao com o servidor." e 4xx nao reivindicado caia na rede de seguranca. O
 * `catchError` do `CepService` so engolia o erro DEPOIS do interceptor, entao em rede
 * instavel o usuario via o aviso inline correto E um toast vermelho culpando a API do
 * MyCarsHub, que estava no ar.
 *
 * O teste e de ponta a ponta de proposito: passa pelo interceptor de verdade. Assertar
 * so que o token esta no contexto provaria que a marca existe, nao que ela cala o toast.
 */
describe('CepService — falha da integracao externa nao vira toast (FIX-0107)', () => {
  let http: HttpTestingController;
  let cep: CepService;
  let client: HttpClient;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifyWarning: ReturnType<typeof vi.fn>;
  let scheduleSafetyNet: ReturnType<typeof vi.fn>;
  let sessionClear: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    notifyError = vi.fn();
    notifyWarning = vi.fn();
    scheduleSafetyNet = vi.fn();
    sessionClear = vi.fn();
    navigate = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: SessionService, useValue: { clear: sessionClear } },
        { provide: Router, useValue: { navigate } },
        { provide: ApiErrorService, useValue: { scheduleSafetyNet, claim: vi.fn() } },
        {
          provide: ImpersonationService,
          useValue: { active: () => false, expire: vi.fn() },
        },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            warning: notifyWarning,
            info: vi.fn(),
            success: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    cep = TestBed.inject(CepService);
    client = TestBed.inject(HttpClient);
  });

  it('rede fora (status 0): devolve null e NAO toasta', () => {
    let result: unknown = 'nao emitiu';
    cep.lookup('01310-100').subscribe((value) => (result = value));

    http.expectOne(VIACEP).error(new ProgressEvent('error'), { status: 0 });

    expect(result).toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyWarning).not.toHaveBeenCalled();
    expect(scheduleSafetyNet).not.toHaveBeenCalled();
  });

  it('4xx do ViaCEP: devolve null, NAO toasta e nao aciona a rede de seguranca', () => {
    let result: unknown = 'nao emitiu';
    cep.lookup('01310-100').subscribe((value) => (result = value));

    http.expectOne(VIACEP).flush('Bad Request', { status: 400, statusText: 'Bad Request' });

    expect(result).toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
    expect(scheduleSafetyNet).not.toHaveBeenCalled();
  });

  /**
   * A sessao do MyCarsHub nao pode depender do status de OUTRO host: um 401 vindo do
   * ViaCEP jamais pode deslogar o usuario.
   */
  it('401 do ViaCEP nao limpa a sessao nem redireciona', () => {
    cep.lookup('01310-100').subscribe();

    http.expectOne(VIACEP).flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(sessionClear).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(notifyWarning).not.toHaveBeenCalled();
  });

  /**
   * Controle: o MESMO interceptor, na MESMA suite, toasta uma chamada nao marcada.
   * Sem isto, os testes acima passariam tambem se o interceptor estivesse desligado.
   */
  it('controle: chamada nao marcada continua toastando status 0', () => {
    client.get('/v1/qualquer').subscribe({ error: () => undefined });

    http.expectOne('/v1/qualquer').error(new ProgressEvent('error'), { status: 0 });

    expect(notifyError).toHaveBeenCalledWith('Sem conexão com o servidor.');
  });

  afterEach(() => {
    http.verify();
  });
});
