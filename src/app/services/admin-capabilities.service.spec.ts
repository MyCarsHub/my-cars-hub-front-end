import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { AdminCapabilitiesService } from './admin-capabilities.service';

describe('AdminCapabilitiesService', () => {
  let service: AdminCapabilitiesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(AdminCapabilitiesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('carrega uma vez e responde can() pelos códigos do servidor', async () => {
    const a = firstValueFrom(service.ensureLoaded());
    const b = firstValueFrom(service.ensureLoaded());
    http.expectOne(`${environment.apiUrl}/admin/me`).flush({
      userId: 'u', adminRole: 'READONLY', adminRoleLabel: 'Leitura', capabilities: ['ver'],
    });
    await Promise.all([a, b]);

    expect(service.can('ver')).toBe(true);
    expect(service.can('admins.gerir')).toBe(false);
    await firstValueFrom(service.ensureLoaded());
    http.expectNone(`${environment.apiUrl}/admin/me`);
  });

  it('falha fechada: erro no /admin/me = nenhuma capacidade', async () => {
    const p = firstValueFrom(service.ensureLoaded());
    http.expectOne(`${environment.apiUrl}/admin/me`).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(await p).toBeNull();
    expect(service.can('ver')).toBe(false);
  });
});
