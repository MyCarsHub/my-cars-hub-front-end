import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingAccessService } from './billing-access.service';
import { SessionService } from './session.service';
import { AccessStatus } from '../types/billing-access.types';

const OK: AccessStatus = {
  status: 'ACTIVE',
  trialEndsAt: null,
  graceEndsAt: null,
  plan: null,
  blocked: false,
  reason: null,
};

describe('BillingAccessService', () => {
  let httpGet: ReturnType<typeof vi.fn>;
  let service: BillingAccessService;

  beforeEach(() => {
    httpGet = vi.fn(() => of(OK));
    TestBed.configureTestingModule({
      providers: [
        BillingAccessService,
        { provide: HttpClient, useValue: { get: httpGet } },
        {
          provide: SessionService,
          useValue: { isPlatformAdmin: () => false, isOnboardingCompleted: () => true },
        },
      ],
    });
    service = TestBed.inject(BillingAccessService);
  });

  it('caches the status so a second load() does not hit the backend', () => {
    service.load().subscribe();
    service.load().subscribe();
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after invalidate()', () => {
    service.load().subscribe();
    service.invalidate();
    service.load().subscribe();
    expect(httpGet).toHaveBeenCalledTimes(2);
  });

  it('fails OPEN on a network error so a flaky backend cannot lock everyone out', () => {
    httpGet.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    service.load().subscribe();
    expect(service.isBlocked()).toBe(false);
  });

  it('fails OPEN on 5xx', () => {
    httpGet.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    service.load().subscribe();
    expect(service.isBlocked()).toBe(false);
  });

  it('fails CLOSED on 403 — we could not prove access', () => {
    httpGet.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    service.load().subscribe();
    expect(service.isBlocked()).toBe(true);
    expect(service.reason()).toBe('NO_SUBSCRIPTION');
  });

  it('leaves 401 to the auth layer instead of showing a paywall', () => {
    httpGet.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
    service.load().subscribe();
    expect(service.isBlocked()).toBe(false);
  });
});

/**
 * FIX-0273 — cache de raiz que se invalida sozinho e deixa a requisição JÁ EM
 * VOO gravar o valor anterior.
 *
 * Aqui dói assim: o usuário assina o plano, `BillingService` chama
 * `invalidate()`, mas o `refresh()` que o guard tinha disparado ANTES da compra
 * ainda está voando. Ele responde BLOCKED, grava por cima e marca o cache como
 * carregado — o paywall fica de pé depois do pagamento, até um F5.
 */
describe('BillingAccessService — resposta em voo aposentada (FIX-0273)', () => {
  const BLOCKED: AccessStatus = {
    status: 'BLOCKED',
    trialEndsAt: null,
    graceEndsAt: null,
    plan: null,
    blocked: true,
    reason: 'NO_SUBSCRIPTION',
  };

  let httpGet: ReturnType<typeof vi.fn>;
  let pending: Subject<AccessStatus>;
  let service: BillingAccessService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    pending = new Subject<AccessStatus>();
    httpGet = vi.fn(() => pending);
    TestBed.configureTestingModule({
      providers: [
        BillingAccessService,
        { provide: HttpClient, useValue: { get: httpGet } },
        {
          provide: SessionService,
          useValue: { isPlatformAdmin: () => false, isOnboardingCompleted: () => true },
        },
      ],
    });
    service = TestBed.inject(BillingAccessService);
  });

  /** Responde a requisição que ficou pendurada no `beforeEach`. */
  function land(status: AccessStatus): void {
    pending.next(status);
    pending.complete();
  }

  it('invalidate() durante o voo descarta a resposta velha', () => {
    service.load().subscribe();
    service.invalidate();

    land(BLOCKED);

    expect(service.status()).toBeNull();
    // Continua vencido: o guard PRECISA perguntar de novo, agora pós-transição.
    expect(service.loaded()).toBe(false);
    expect(service.isBlocked()).toBe(false);
  });

  it('quem assinou a requisição aposentada recebe a decisão corrente, não a velha', () => {
    let received: AccessStatus | null | undefined;
    service.load().subscribe((status) => (received = status));
    service.invalidate();

    land(BLOCKED);

    expect(received).toBeNull();
  });

  it('reset() na troca de empresa também aposenta o voo da empresa anterior', () => {
    service.load().subscribe();
    service.reset();

    land(BLOCKED);

    expect(service.status()).toBeNull();
    expect(service.loaded()).toBe(false);
  });

  it('sem invalidação no meio, a resposta continua sendo gravada normalmente', () => {
    service.load().subscribe();

    land(BLOCKED);

    expect(service.status()).toEqual(BLOCKED);
    expect(service.loaded()).toBe(true);
    expect(service.isBlocked()).toBe(true);
  });

  it('depois da aposentadoria o próximo load() volta a consultar o backend', () => {
    service.load().subscribe();
    service.invalidate();
    land(BLOCKED);

    httpGet.mockReturnValue(of(OK));
    service.load().subscribe();

    expect(httpGet).toHaveBeenCalledTimes(2);
    expect(service.status()).toEqual(OK);
    expect(service.loaded()).toBe(true);
  });
});
