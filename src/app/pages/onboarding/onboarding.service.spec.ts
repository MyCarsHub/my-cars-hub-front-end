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
    expect(notifyError).toHaveBeenCalledOnce();
  });

  it('falls back to INITIAL_STATE silently on 404 (fresh user)', () => {
    httpGet.mockReturnValue(throwError(() => httpError(404)));

    let resolved: unknown = null;
    service.loadState().subscribe({ next: (s) => (resolved = s) });

    expect(resolved).toEqual({ step: 1, isCompleted: false, data: {} });
    expect(service.state()).toEqual({ step: 1, isCompleted: false, data: {} });
    // 404 = expected fresh-user case; no toast.
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
    expect(notifyError).toHaveBeenCalledOnce();
  });

  it('fires the error toast at most once across two concurrent failing loads', () => {
    httpGet.mockReturnValue(throwError(() => httpError(500)));

    service.loadState().subscribe();
    service.loadState().subscribe();

    expect(notifyError).toHaveBeenCalledOnce();
  });
});
