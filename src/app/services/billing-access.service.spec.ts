import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
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
