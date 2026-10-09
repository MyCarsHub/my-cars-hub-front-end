import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authInterceptor, isInviteOnboardingRequest, isPublicInviteRequest } from './auth.interceptor';
import { InviteOnboardingTokenStore, INVITE_ONBOARDING_TOKEN_KEY } from './invite-onboarding-token.store';
import { SessionService } from './session.service';
import { environment } from '../../environments/environment';

const API = environment.apiUrl;
const ONBOARDING_TOKEN = 'onboarding-token-xyz';
const SESSION_TOKEN = 'normal-session-token';

/**
 * The onboarding token is a narrow credential. These specs drive the REAL interceptor, the
 * real `SessionService` and real `HttpClient` (only the network is faked) and check the
 * Authorization header that actually leaves for each URL.
 */
describe('authInterceptor - invite onboarding token allow-list', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  /** Sends a GET to `url` and returns the Authorization header the network would see. */
  function authorizationFor(url: string): string | null {
    http.get(url).subscribe();
    const req = backend.expectOne((r) => r.url === url);
    const header = req.request.headers.get('Authorization');
    req.flush({});
    return header;
  }

  function bothTokens(): void {
    TestBed.inject(SessionService).setToken(SESSION_TOKEN);
    TestBed.inject(InviteOnboardingTokenStore).set(ONBOARDING_TOKEN);
  }

  const allowed: readonly string[] = [
    `${API}/invite-onboarding`,
    `${API}/invite-onboarding/manager`,
    `${API}/invite-onboarding/manager?retry=1`,
    `${API}/invite-onboarding/driver`,
    `${API}/invite-onboarding/driver/step-1`,
  ];

  it.each(allowed)('attaches the ONBOARDING token (and never the session token) to %s', (url) => {
    bothTokens();
    expect(authorizationFor(url)).toBe(`Bearer ${ONBOARDING_TOKEN}`);
  });

  const forbidden: readonly string[] = [
    `${API}/auth/me`,
    `${API}/vehicles`,
    `${API}/invites`,
    `${API}/invites/accept-as-member`,
    `${API}/admin/impersonation/1`,
    `${API}/invite-onboarding-evil`,
    `${API}/invite-onboardingmanager`,
    `${API}/other/invite-onboarding/manager`,
    `${API}/invite-onboarding/../vehicles`,
    `${API}/invite-onboarding/%2e%2e/vehicles`,
    `${API}/invite-onboarding/a b`,
    `${API}/invite-onboarding//manager`,
  ];

  it.each(forbidden)('never sends the ONBOARDING token to %s', (url) => {
    bothTokens();
    // The normal session keeps working on API routes; the point is the OTHER credential.
    expect(authorizationFor(url)).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it.each([
    'https://evil.example.com/v1/invite-onboarding/manager',
    `https://evil.example.com${API}/invite-onboarding/manager`,
    `${API.replace('localhost', 'localhost.evil.example')}/invite-onboarding/manager`,
  ])('sends no credential at all to a third-party host: %s', (url) => {
    bothTokens();
    expect(authorizationFor(url)).toBeNull();
  });

  it('sends NO Authorization to an allowed route when there is no onboarding token (no fallback to the session token)', () => {
    TestBed.inject(SessionService).setToken(SESSION_TOKEN);
    expect(authorizationFor(`${API}/invite-onboarding`)).toBeNull();
  });

  it.each([`${API}/invites/validate`, `${API}/invites/accept`])(
    'keeps the public invite route %s free of any credential',
    (url) => {
      bothTokens();
      expect(authorizationFor(url)).toBeNull();
    },
  );

  it('does not treat a stale-looking public prefix as public (accept-as-member needs the Google session)', () => {
    bothTokens();
    expect(isPublicInviteRequest(`${API}/invites/accept-as-member`)).toBe(false);
    expect(authorizationFor(`${API}/invites/accept-as-member`)).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('exposes the allow-list as a pure predicate', () => {
    expect(isInviteOnboardingRequest(`${API}/invite-onboarding/manager`)).toBe(true);
    expect(isInviteOnboardingRequest(`${API}/invite-onboarding/driver`)).toBe(true);
    expect(isInviteOnboardingRequest(`${API}/vehicles`)).toBe(false);
    expect(isInviteOnboardingRequest('https://evil.example.com/invite-onboarding')).toBe(false);
  });

  it('keeps the onboarding token out of the normal auth slot, and the session out of its own', () => {
    bothTokens();
    expect(sessionStorage.getItem('token')).toBe(SESSION_TOKEN);
    expect(sessionStorage.getItem(INVITE_ONBOARDING_TOKEN_KEY)).toBe(ONBOARDING_TOKEN);

    TestBed.inject(InviteOnboardingTokenStore).clear();
    expect(sessionStorage.getItem('token')).toBe(SESSION_TOKEN);
    expect(TestBed.inject(InviteOnboardingTokenStore).has()).toBe(false);
  });
});
