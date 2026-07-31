import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { OnboardingService } from './onboarding.service';
import { SessionService } from '../../services/session.service';
import { NotificationService } from '../../services/notification.service';

/**
 * Ensures loadState() never traps the user on an empty card: on any HTTP error
 * it falls back to INITIAL_STATE and resolves successfully so the page can
 * render step 1. See onboarding-container.html:66 (loaded() gate).
 */
describe('OnboardingService.loadState error handling', () => {
  let httpGet: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let service: OnboardingService;

  beforeEach(() => {
    httpGet = vi.fn();
    notifyError = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        OnboardingService,
        { provide: HttpClient, useValue: { get: httpGet, post: vi.fn() } },
        { provide: SessionService, useValue: { setOnboardingCompleted: vi.fn(), setToken: vi.fn(), setItem: vi.fn() } },
        { provide: NotificationService, useValue: { error: notifyError, info: vi.fn(), success: vi.fn(), warning: vi.fn() } },
      ],
    });
    service = TestBed.inject(OnboardingService);
  });

  function httpError(status: number): HttpErrorResponse {
    return new HttpErrorResponse({ status, statusText: 'error', error: {} });
  }

  it('falls back to INITIAL_STATE and does NOT throw on 500', () => {
    httpGet.mockReturnValue(throwError(() => httpError(500)));

    let resolved: unknown = null;
    let errored = false;
    service.loadState().subscribe({
      next: (s) => (resolved = s),
      error: () => (errored = true),
    });

    expect(errored).toBe(false);
    expect(resolved).toEqual({ step: 1, isCompleted: false, data: {} });
    expect(service.state()).toEqual({ step: 1, isCompleted: false, data: {} });
    // Inline banner, never a toast — the container renders `loadError`.
    expect(service.loadError()).not.toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('falls back to INITIAL_STATE silently on 404 (fresh user)', () => {
    httpGet.mockReturnValue(throwError(() => httpError(404)));

    let resolved: unknown = null;
    service.loadState().subscribe({ next: (s) => (resolved = s) });

    expect(resolved).toEqual({ step: 1, isCompleted: false, data: {} });
    expect(service.state()).toEqual({ step: 1, isCompleted: false, data: {} });
    // 404 = expected fresh-user case; nothing to show anywhere.
    expect(service.loadError()).toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('preserves success path (populates from BE response)', () => {
    const beState = { step: 3, isCompleted: false, data: { fullName: 'Ada' } };
    httpGet.mockReturnValue(of(beState));

    service.loadState().subscribe();

    expect(service.state()).toEqual(beState);
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('does NOT reset populated state when a subsequent load errors', () => {
    const beState = { step: 3, isCompleted: false, data: { fullName: 'Ada' } };
    httpGet.mockReturnValueOnce(of(beState));
    service.loadState().subscribe();
    expect(service.state()).toEqual(beState);

    // Second call: BE goes 500. State must be preserved.
    httpGet.mockReturnValueOnce(throwError(() => httpError(500)));
    let resolved: unknown = null;
    service.loadState().subscribe({ next: (s) => (resolved = s) });

    expect(service.state()).toEqual(beState);
    expect(resolved).toEqual(beState);
    expect(service.loadError()).not.toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('shows one banner message and no toast across two concurrent failing loads', () => {
    httpGet.mockReturnValue(throwError(() => httpError(500)));

    service.loadState().subscribe();
    service.loadState().subscribe();

    // A signal holds one value: concurrent failures cannot stack up messages.
    expect(service.loadError()).not.toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
  });
});

/**
 * `POST /onboarding/cnpj-availability` — advisory pre-flight. POST, not GET, because the
 * document is PII: it must never reach a query string, access log or `Referer`.
 * Rate-limited to 5 requests / 60s per IP, hence the memoisation.
 */
describe('OnboardingService.checkCnpjAvailability', () => {
  let httpPost: ReturnType<typeof vi.fn>;
  let service: OnboardingService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    httpPost = vi.fn().mockReturnValue(of({ available: true }));
    TestBed.configureTestingModule({
      providers: [
        OnboardingService,
        { provide: HttpClient, useValue: { get: vi.fn(), post: httpPost } },
        {
          provide: SessionService,
          useValue: { setOnboardingCompleted: vi.fn(), setToken: vi.fn(), setItem: vi.fn() },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
        },
      ],
    });
    service = TestBed.inject(OnboardingService);
  });

  it('envia o CNPJ canônico no corpo, nunca na URL', () => {
    service.checkCnpjAvailability('12.abc.345/01de-35').subscribe();

    const [url, body] = httpPost.mock.calls[0];
    expect(url).toContain('/onboarding/cnpj-availability');
    expect(url).not.toContain('12');
    expect(body).toEqual({ cnpj: '12ABC34501DE35' });
    expect(typeof (body as { cnpj: unknown }).cnpj).toBe('string');
  });

  it('memoiza um CNPJ já aprovado — o segundo clique não gasta o rate limit', () => {
    service.checkCnpjAvailability('12.345.678/0001-95').subscribe();
    service.checkCnpjAvailability('12345678000195').subscribe();

    expect(httpPost).toHaveBeenCalledTimes(1);
  });

  it('marca e desmarca checkingCnpj em volta da chamada', () => {
    const states: boolean[] = [];
    httpPost.mockImplementation(() => {
      states.push(service.checkingCnpj());
      return of({ available: true });
    });

    service.checkCnpjAvailability('12.345.678/0001-95').subscribe();

    expect(states).toEqual([true]);
    expect(service.checkingCnpj()).toBe(false);
  });

  it('libera checkingCnpj mesmo quando a chamada falha', () => {
    httpPost.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));

    service.checkCnpjAvailability('12.345.678/0001-95').subscribe({ error: () => undefined });

    expect(service.checkingCnpj()).toBe(false);
  });

  it('não memoiza uma recusa — um novo clique volta a perguntar', () => {
    httpPost.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    service.checkCnpjAvailability('12.345.678/0001-95').subscribe({ error: () => undefined });
    service.checkCnpjAvailability('12.345.678/0001-95').subscribe({ error: () => undefined });

    expect(httpPost).toHaveBeenCalledTimes(2);
  });
});
