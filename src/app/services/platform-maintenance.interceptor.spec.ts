import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { platformMaintenanceInterceptor } from './platform-maintenance.interceptor';
import { PlatformMaintenanceService } from './platform-maintenance.service';

describe('platformMaintenanceInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let maintenance: PlatformMaintenanceService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([platformMaintenanceInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    maintenance = TestBed.inject(PlatformMaintenanceService);
  });

  function fail(status: number, headers: Record<string, string> = {}): unknown {
    let error: unknown;
    http.get('/x').subscribe({ error: (e) => (error = e) });
    backend.expectOne('/x').flush('', { status, statusText: 'x', headers });
    return error;
  }

  it('turns maintenance mode on for a 503 with Retry-After and rethrows the error', () => {
    const error = fail(503, { 'Retry-After': '30' });

    expect(maintenance.active()).toBe(true);
    expect((error as { status: number }).status).toBe(503);
  });

  it('leaves a bare 503 and other errors alone', () => {
    fail(503);
    fail(500, { 'Retry-After': '30' });
    fail(404);

    expect(maintenance.active()).toBe(false);
  });
});
