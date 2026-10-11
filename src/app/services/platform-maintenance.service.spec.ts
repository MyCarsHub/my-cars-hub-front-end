import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { environment } from '../../environments/environment';
import { PlatformMaintenanceService, isMaintenanceSignal } from './platform-maintenance.service';

describe('isMaintenanceSignal', () => {
  const err = (status: number, headers?: Record<string, string>, body?: unknown) =>
    new HttpErrorResponse({ status, headers: new HttpHeaders(headers), error: body });

  it('is a 503 with Retry-After', () => {
    expect(isMaintenanceSignal(err(503, { 'Retry-After': '120' }))).toBe(true);
  });

  it('is a 503 whose body says maintenance: true', () => {
    expect(isMaintenanceSignal(err(503, undefined, { maintenance: true }))).toBe(true);
  });

  it('is NOT a bare 503 (a gateway or a cold start would take the whole app down)', () => {
    expect(isMaintenanceSignal(err(503))).toBe(false);
    expect(isMaintenanceSignal(err(503, undefined, { maintenance: false }))).toBe(false);
  });

  it('is NOT any other status, even with the header or the flag', () => {
    expect(isMaintenanceSignal(err(500, { 'Retry-After': '1' }))).toBe(false);
    expect(isMaintenanceSignal(err(429, undefined, { maintenance: true }))).toBe(false);
    expect(isMaintenanceSignal(new Error('boom'))).toBe(false);
  });
});

describe('PlatformMaintenanceService', () => {
  let service: PlatformMaintenanceService;
  let http: HttpTestingController;
  const url = `${environment.apiUrl}/status`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PlatformMaintenanceService);
    http = TestBed.inject(HttpTestingController);
  });

  it('toggles the active signal', () => {
    expect(service.active()).toBe(false);
    service.enter();
    expect(service.active()).toBe(true);
    service.leave();
    expect(service.active()).toBe(false);
  });

  function check(respond: (r: ReturnType<HttpTestingController['expectOne']>) => void): boolean | undefined {
    let result: boolean | undefined;
    service.isBackUp().subscribe((up) => (result = up));
    respond(http.expectOne(url));
    return result;
  }

  it('is back up on 200', () => {
    expect(check((r) => r.flush('ok'))).toBe(true);
  });

  it('is back up on a 404: the server answers, the endpoint just does not exist yet', () => {
    expect(check((r) => r.flush('', { status: 404, statusText: 'Not Found' }))).toBe(true);
  });

  it('is NOT back up on the maintenance signal', () => {
    expect(
      check((r) =>
        r.flush('', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Retry-After': '60' },
        }),
      ),
    ).toBe(false);
  });

  it('is NOT back up on a 5xx', () => {
    expect(check((r) => r.flush('', { status: 502, statusText: 'Bad Gateway' }))).toBe(false);
  });

  it('is NOT back up when the network fails', () => {
    expect(check((r) => r.error(new ProgressEvent('error')))).toBe(false);
  });
});
