import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService, isFreePlanInForce } from './billing.service';
import { BillingAccessService } from './billing-access.service';
import { OWNED_HTTP_ERRORS } from './http-errors.context';
import { ApiErrorService } from './api-error.service';
import { NotificationService } from './notification.service';
import {
  PlanResponse,
  SubscriptionChangeResponse,
  SubscriptionResponse,
} from '../types/billing.types';

const subscription: SubscriptionResponse = {
  id: 'sub-1',
  planCode: 'PRO_MONTHLY_STRIPE',
  planName: 'PRO',
  status: 'ACTIVE',
  billingCycle: 'MONTHLY',
  trialEndsAt: null,
  currentPeriodStart: '2026-07-01T00:00:00Z',
  currentPeriodEnd: '2026-08-01T00:00:00Z',
  cancelAtPeriodEnd: false,
  externalId: 'ext-1',
  pendingPlanCode: null,
  scheduledDowngradePlanCode: null,
  scheduledDowngradeAt: null,
};

const change: SubscriptionChangeResponse = {
  outcome: 'SCHEDULED',
  currentPlanCode: 'PRO_MONTHLY_STRIPE',
  targetPlanCode: 'TRIAL_MONTHLY_STRIPE',
  effectiveAt: '2026-08-01T00:00:00Z',
  message: 'Mudança agendada.',
};

const planRow = (over: Partial<PlanResponse>): PlanResponse => ({
  id: 'id-free',
  code: 'FREE_MONTHLY_STRIPE',
  name: 'TRIAL',
  period: 'MONTHLY',
  price: 0,
  vehicleLimit: 2,
  trialDays: 7,
  productExternalId: null,
  gateway: 'stripe',
  ...over,
});

const FREE_ROW = planRow({});
const PRO_ROW = planRow({ id: 'id-pro', code: 'PRO_MONTHLY_STRIPE', name: 'PRO', price: 199 });

/**
 * The rule that decides whether a customer sees "Cancelar assinatura". Only a
 * plan row that EXISTS and costs zero may classify a subscription as free —
 * absence of data must always resolve to PAID.
 */
describe('isFreePlanInForce', () => {
  it('classifies as free only with a zero-priced row (positive evidence)', () => {
    const freeSub = { ...subscription, planCode: 'FREE_MONTHLY_STRIPE', planName: 'TRIAL' };
    expect(isFreePlanInForce(freeSub, [FREE_ROW, PRO_ROW])).toBe(true);
    expect(isFreePlanInForce(subscription, [FREE_ROW, PRO_ROW])).toBe(false);
  });

  it('never infers "free" from a missing plan row, whatever the period end', () => {
    // `/plans` empty or still in flight. Both period-end shapes must resolve to
    // PAID: a null one is what used to hide the cancel button.
    expect(isFreePlanInForce({ ...subscription, currentPeriodEnd: null }, [])).toBe(false);
    expect(isFreePlanInForce(subscription, [])).toBe(false);
    // Even the free plan CODE is not enough without its row — the price is.
    const freeSub = { ...subscription, planCode: 'FREE_MONTHLY_STRIPE', currentPeriodEnd: null };
    expect(isFreePlanInForce(freeSub, [])).toBe(false);
  });

  it('is false for anything that is not ACTIVE', () => {
    const trialing: SubscriptionResponse = { ...subscription, status: 'TRIALING' };
    expect(isFreePlanInForce(trialing, [FREE_ROW, PRO_ROW])).toBe(false);
    expect(isFreePlanInForce(null, [FREE_ROW])).toBe(false);
  });
});

describe('BillingService', () => {
  let httpPost: ReturnType<typeof vi.fn>;
  let httpGet: ReturnType<typeof vi.fn>;
  let invalidate: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let service: BillingService;

  beforeEach(() => {
    httpPost = vi.fn();
    httpGet = vi.fn(() => of(subscription));
    invalidate = vi.fn();
    notifyError = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        BillingService,
        // `ApiErrorService` de verdade: o que se quer provar é o contrato dele
        // (mensagem + `claim`), não um dublê que devolve o que eu mandar.
        ApiErrorService,
        { provide: HttpClient, useValue: { post: httpPost, get: httpGet } },
        { provide: BillingAccessService, useValue: { invalidate } },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            warning: vi.fn(),
            info: vi.fn(),
            success: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
    service = TestBed.inject(BillingService);
  });

  const postedUrls = (): string[] => httpPost.mock.calls.map((c) => String(c[0]));

  describe('downgrade', () => {
    it('posts to /downgrade and NEVER to /checkout', () => {
      httpPost.mockReturnValue(of(change));

      service.downgrade('TRIAL_MONTHLY_STRIPE').subscribe();

      expect(postedUrls().some((u) => u.endsWith('/billing/downgrade'))).toBe(true);
      expect(postedUrls().some((u) => u.includes('/checkout'))).toBe(false);
      expect(httpPost.mock.calls[0][1]).toEqual({ planCode: 'TRIAL_MONTHLY_STRIPE' });
    });

    it('sends an empty body when no plan code is given (back to free)', () => {
      httpPost.mockReturnValue(of(change));
      service.downgrade().subscribe();
      expect(httpPost.mock.calls[0][1]).toEqual({});
    });

    it('invalidates the access cache and re-reads the subscription', () => {
      httpPost.mockReturnValue(of(change));

      service.downgrade('TRIAL_MONTHLY_STRIPE').subscribe();

      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(httpGet).toHaveBeenCalledTimes(1);
      expect(service.subscription()).toEqual(subscription);
    });

    it('surfaces the backend {message} on 400', () => {
      httpPost.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { message: 'Use o checkout para fazer upgrade.' },
            }),
        ),
      );

      service.downgrade('PRO_MONTHLY_STRIPE').subscribe({ error: () => void 0 });

      expect(service.error()).toBe('Use o checkout para fazer upgrade.');
    });
  });

  describe('reactivate', () => {
    it('posts to /reactivate with no body and invalidates the cache', () => {
      httpPost.mockReturnValue(of({ ...change, outcome: 'REACTIVATED' }));

      service.reactivate().subscribe();

      expect(postedUrls().some((u) => u.endsWith('/billing/reactivate'))).toBe(true);
      expect(postedUrls().some((u) => u.includes('/checkout'))).toBe(false);
      expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it('surfaces the backend message when the period already expired', () => {
      httpPost.mockReturnValue(
        throwError(
          () => new HttpErrorResponse({ status: 400, error: { message: 'Período já vencido.' } }),
        ),
      );

      service.reactivate().subscribe({ error: () => void 0 });

      expect(service.error()).toBe('Período já vencido.');
    });
  });

  describe('cancel', () => {
    it('does NOT write cancelAtPeriodEnd optimistically', () => {
      httpPost.mockReturnValue(of(''));
      // Seed the signal through a normal load.
      service.loadSubscription().subscribe();
      expect(service.subscription()?.cancelAtPeriodEnd).toBe(false);

      service.cancel().subscribe();

      // Still false: only a re-read from the backend may flip it.
      expect(service.subscription()?.cancelAtPeriodEnd).toBe(false);
      expect(invalidate).toHaveBeenCalled();
    });
  });

  describe('startCheckout', () => {
    it('invalidates the access cache when a checkout is started', () => {
      httpPost.mockReturnValue(of({ redirectUrl: 'https://pay.example', externalId: 'x' }));
      service.startCheckout('PRO_MONTHLY_STRIPE').subscribe();
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * FIX-0087 — último retardatário do caminho de erro compartilhado.
   *
   * O serviço tinha um extrator próprio (`backendMessage`) que duplicava, mal, o
   * `flatErrorMessage`: aceitava qualquer objeto com `message`, então numa falha de
   * rede lia o `TypeError` do navegador e mostrava "Failed to fetch" na tela de
   * planos; ignorava `fieldErrors` por completo; e não reivindicava o erro, de modo
   * que o 4xx ganhava a mensagem inline E o toast da rede de segurança.
   */
  describe('caminho de erro compartilhado (FIX-0087)', () => {
    const networkFailure = () =>
      new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('falha de rede mostra o fallback em português, não "Failed to fetch"', () => {
      httpGet.mockReturnValue(throwError(networkFailure));

      service.loadPlans().subscribe({ error: () => void 0 });

      expect(service.error()).toBe('Não foi possível carregar os planos. Tente novamente.');
    });

    it('falha de rede no checkout também, e não a string do navegador', () => {
      httpPost.mockReturnValue(throwError(networkFailure));

      service.startCheckout('PRO_MONTHLY_STRIPE').subscribe({ error: () => void 0 });

      expect(service.error()).toBe('Não foi possível iniciar o pagamento. Tente novamente.');
    });

    it('surfaces fieldErrors, que o extrator local ignorava', () => {
      httpPost.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { fieldErrors: { planCode: 'Plano indisponível para esta empresa.' } },
            }),
        ),
      );

      service.downgrade('PRO_MONTHLY_STRIPE').subscribe({ error: () => void 0 });

      expect(service.error()).toBe('Plano indisponível para esta empresa.');
    });

    it('reivindica o erro — a mensagem inline não ganha um toast por cima', () => {
      vi.useFakeTimers();
      const failure = new HttpErrorResponse({
        status: 400,
        error: { message: 'Use o checkout para fazer upgrade.' },
      });
      httpPost.mockReturnValue(throwError(() => failure));

      service.downgrade('PRO_MONTHLY_STRIPE').subscribe({ error: () => void 0 });
      TestBed.inject(ApiErrorService).scheduleSafetyNet(failure);
      vi.runAllTimers();

      expect(service.error()).toBe('Use o checkout para fazer upgrade.');
      expect(notifyError).not.toHaveBeenCalled();
    });

    /** Controle: um erro que NINGUÉM reivindicou continua toastando. */
    it('controle: erro não reivindicado ainda dispara a rede de segurança', () => {
      vi.useFakeTimers();
      const orphan = new HttpErrorResponse({ status: 400, error: { message: 'Sem dono.' } });

      TestBed.inject(ApiErrorService).scheduleSafetyNet(orphan);
      vi.runAllTimers();

      expect(notifyError).toHaveBeenCalledWith('Sem dono.');
    });

    it('404 em /subscription continua sendo "sem assinatura", não erro', () => {
      httpGet.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

      service.loadSubscription().subscribe({ error: () => void 0 });

      expect(service.subscription()).toBeNull();
      expect(service.error()).toBeNull();
    });
  });

});

describe('BillingService: troca de plano', () => {
  const post = vi.fn();
  const get = vi.fn();
  const invalidate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        BillingService,
        ApiErrorService,
        { provide: HttpClient, useValue: { post, get } },
        { provide: BillingAccessService, useValue: { invalidate } },
        { provide: NotificationService, useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() } },
      ],
    });
  });

  it('planChangePreview lê a prévia pelo código do plano, e a tela é dona do erro', () => {
    const preview = { mode: 'IN_PLACE' };
    get.mockReturnValue(of(preview));
    let got: unknown;
    TestBed.inject(BillingService)
      .planChangePreview('PRO_MONTHLY_STRIPE')
      .subscribe((res) => (got = res));

    const [url, options] = get.mock.calls[0] as [string, { params: HttpParams; context: HttpContext }];
    expect(url).toMatch(/\/billing\/plan-change$/);
    expect(options.params.get('planCode')).toBe('PRO_MONTHLY_STRIPE');
    expect(options.context.get(OWNED_HTTP_ERRORS)).toBe(true);
    expect(got).toBe(preview);
  });

  it('upgrade manda só o plano, invalida o acesso e deixa o erro para a tela', () => {
    const response = { outcome: 'APPLIED' };
    post.mockReturnValue(of(response));
    let got: unknown;
    TestBed.inject(BillingService)
      .upgrade('PRO_MONTHLY_STRIPE')
      .subscribe((res) => (got = res));

    const [url, body, options] = post.mock.calls[0] as [string, unknown, { context: HttpContext }];
    expect(url).toMatch(/\/billing\/upgrade$/);
    expect(body).toEqual({ planCode: 'PRO_MONTHLY_STRIPE' });
    expect(options.context.get(OWNED_HTTP_ERRORS)).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(got).toBe(response);
  });

  it('agendar manda só o plano, invalida o acesso e a tela é dona do erro', () => {
    post.mockReturnValue(of({ outcome: 'SCHEDULED' }));
    TestBed.inject(BillingService).schedulePlanChange('STARTER_MONTHLY_STRIPE').subscribe();
    const [url, body, options] = post.mock.calls[0] as [string, unknown, { context: HttpContext }];
    expect(url).toMatch(/\/billing\/plan-change$/);
    expect(body).toEqual({ planCode: 'STARTER_MONTHLY_STRIPE' });
    expect(options.context.get(OWNED_HTTP_ERRORS)).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('desfazer não tem corpo com dados, invalida o acesso e a tela é dona do erro', () => {
    post.mockReturnValue(of({ outcome: 'UNDONE' }));
    TestBed.inject(BillingService).undoPlanChange().subscribe();
    const [url, body, options] = post.mock.calls[0] as [string, unknown, { context: HttpContext }];
    expect(url).toMatch(/\/billing\/plan-change\/undo$/);
    expect(body).toEqual({});
    expect(options.context.get(OWNED_HTTP_ERRORS)).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  const ACCOUNT_ACTIONS: [string, (s: BillingService) => Observable<unknown>][] = [
    ['cancel', (s) => s.cancel()],
    ['downgrade', (s) => s.downgrade()],
    ['reactivate', (s) => s.reactivate()],
  ];

  it.each(ACCOUNT_ACTIONS)('%s: a tela é dona do 503, sem toast repetindo o aviso', (_name, call) => {
    post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    call(TestBed.inject(BillingService)).subscribe({ error: () => undefined });
    const options = post.mock.calls[0][2] as { context: HttpContext };
    expect(options.context.get(OWNED_HTTP_ERRORS)).toBe(true);
  });

  it('upgrade recusado não toca o banner da página nem o cache de acesso', () => {
    post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    const service = TestBed.inject(BillingService);
    let failed = false;
    service.upgrade('PRO_MONTHLY_STRIPE').subscribe({ error: () => (failed = true) });
    expect(failed).toBe(true);
    expect(service.error()).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
