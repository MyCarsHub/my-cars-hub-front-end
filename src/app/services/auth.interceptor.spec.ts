import { TestBed } from '@angular/core/testing';
import {
  HttpHandlerFn,
  HttpParams,
  HttpRequest,
  HttpResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { of, firstValueFrom } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { authInterceptor } from './auth.interceptor';
import { environment } from '../../environments/environment';
import { SessionService } from './session.service';

const API = environment.apiUrl;
const SIGNED_URL = 'https://wxgvknttzynnycijmoeu.supabase.co/storage/v1/object/sign/docs/a.pdf?token=xyz';

describe('authInterceptor', () => {
  let getToken: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getToken = vi.fn().mockReturnValue(null);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        { provide: SessionService, useValue: { getToken } },
      ],
    });
  });

  /** Runs the interceptor and returns the request it actually forwarded downstream. */
  async function forward(req: HttpRequest<unknown>): Promise<HttpRequest<unknown>> {
    let seen: HttpRequest<unknown> | undefined;
    const next: HttpHandlerFn = (forwarded) => {
      seen = forwarded;
      return of(new HttpResponse({ status: 200 }));
    };
    const result$ = TestBed.runInInjectionContext(() => authInterceptor(req, next));
    await firstValueFrom(result$);
    if (!seen) {
      throw new Error('Interceptor did not forward the request.');
    }
    return seen;
  }

  it('adds ngsw-bypass=1 to API requests', async () => {
    const seen = await forward(new HttpRequest('POST', `${API}/contracts/1/file`, new FormData()));

    expect(seen.params.get('ngsw-bypass')).toBe('1');
    expect(seen.urlWithParams).toContain('ngsw-bypass=1');
  });

  it('adds ngsw-bypass=1 even when there is no token, without an Authorization header', async () => {
    getToken.mockReturnValue(null);

    const seen = await forward(new HttpRequest('POST', `${API}/auth/login`, {}));

    expect(seen.params.get('ngsw-bypass')).toBe('1');
    expect(seen.headers.has('Authorization')).toBe(false);
  });

  it('keeps attaching the bearer token alongside the bypass param', async () => {
    getToken.mockReturnValue('jwt-123');

    const seen = await forward(new HttpRequest('GET', `${API}/auth/me`));

    expect(seen.headers.get('Authorization')).toBe('Bearer jwt-123');
    expect(seen.params.get('ngsw-bypass')).toBe('1');
  });

  it('leaves non-API requests untouched (e.g. a Supabase signed URL)', async () => {
    getToken.mockReturnValue('jwt-123');

    const seen = await forward(new HttpRequest('GET', SIGNED_URL));

    expect(seen.params.get('ngsw-bypass')).toBeNull();
    expect(seen.urlWithParams).toBe(SIGNED_URL);
    expect(seen.headers.has('Authorization')).toBe(false);
  });

  it('leaves a hostile URL that merely CONTAINS the apiUrl fragment untouched', async () => {
    getToken.mockReturnValue('jwt-123');
    // In prod `apiUrl` is the relative `/api/v1`; a substring match would hand
    // this third-party host both the bearer token and the bypass param.
    const hostile = `https://evil.example.com${API}/steal`;

    const seen = await forward(new HttpRequest('GET', hostile));

    expect(seen.headers.has('Authorization')).toBe(false);
    expect(seen.params.get('ngsw-bypass')).toBeNull();
    expect(seen.urlWithParams).toBe(hostile);
  });

  it('does not treat a sibling base that only shares a prefix as the API', async () => {
    getToken.mockReturnValue('jwt-123');
    const lookalike = `${API}-public/vehicles`;

    const seen = await forward(new HttpRequest('GET', lookalike));

    expect(seen.headers.has('Authorization')).toBe(false);
    expect(seen.params.get('ngsw-bypass')).toBeNull();
  });

  it('preserves query params already embedded in the URL', async () => {
    const seen = await forward(new HttpRequest('GET', `${API}/vehicles?status=ACTIVE&page=2`));

    expect(seen.urlWithParams).toContain('status=ACTIVE');
    expect(seen.urlWithParams).toContain('page=2');
    expect(seen.urlWithParams).toContain('ngsw-bypass=1');
  });

  it('preserves HttpParams already set on the request', async () => {
    const params = new HttpParams().set('status', 'ACTIVE').set('page', '2');
    const seen = await forward(new HttpRequest('GET', `${API}/vehicles`, { params }));

    expect(seen.params.get('status')).toBe('ACTIVE');
    expect(seen.params.get('page')).toBe('2');
    expect(seen.params.get('ngsw-bypass')).toBe('1');
  });
});
