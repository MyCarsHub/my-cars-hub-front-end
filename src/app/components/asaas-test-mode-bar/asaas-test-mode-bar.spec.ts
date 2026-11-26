import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../environments/environment';
import { AsaasIntegrationService } from '../../pages/company-settings/integrations/asaas-integration.service';
import type { AsaasIntegrationStatus } from '../../pages/company-settings/integrations/asaas-integration.types';
import { TenantResetRegistry } from '../../services/tenant-reset.registry';
import { AsaasTestModeBar } from './asaas-test-mode-bar';

const BASE = `${environment.apiUrl}/companies/current/integrations/asaas`;

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'HS256' })}.${enc({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload })}.sig`;
}
const COMPANY = '11111111-1111-1111-1111-111111111111';

const ADMIN_PROD: AsaasIntegrationStatus = {
  connected: true,
  environment: 'PRODUCTION',
  connectedAt: '2026-11-20T12:00:00',
  lastVerifiedAt: null,
  webhookStatus: 'REGISTERED',
  activeEnvironment: 'PRODUCTION',
  environments: [],
};

describe('AsaasTestModeBar', () => {
  let fixture: ComponentFixture<AsaasTestModeBar>;
  let http: HttpTestingController;

  function mount(token: string): void {
    sessionStorage.setItem('token', token);
    TestBed.configureTestingModule({
      imports: [AsaasTestModeBar],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AsaasTestModeBar);
    fixture.detectChanges();
  }

  const bar = () =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-testid="asaas-testbar"]');

  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });

  it('dono: nenhuma requisição e nenhuma faixa', () => {
    mount(jwt({ system_role: 'USER', role: 'OWNER', companyId: COMPANY }));
    http.expectNone(BASE);
    expect(bar()).toBeNull();
  });

  it('motorista: nenhuma requisição', () => {
    mount(jwt({ system_role: 'USER', role: 'DRIVER', companyId: COMPANY }));
    http.expectNone(BASE);
  });

  it('sessão "ver como empresa": nenhuma requisição (o claim de impersonação vem antes)', () => {
    mount(jwt({ system_role: 'PLATFORM_ADMIN', impersonation: true, companyId: COMPANY }));
    http.expectNone(BASE);
  });

  it('admin sem empresa no token: nenhuma requisição', () => {
    mount(jwt({ system_role: 'PLATFORM_ADMIN' }));
    http.expectNone(BASE);
  });

  it('admin em produção: pede o status UMA vez e não mostra a faixa; acende depois da troca para Testes', () => {
    mount(jwt({ system_role: 'PLATFORM_ADMIN', companyId: COMPANY }));
    http.expectOne({ method: 'GET', url: BASE }).flush(ADMIN_PROD);
    fixture.detectChanges();
    expect(bar()).toBeNull();

    // Uma segunda faixa (outra navegação) não pede de novo.
    TestBed.createComponent(AsaasTestModeBar).detectChanges();
    http.expectNone(BASE);

    TestBed.inject(AsaasIntegrationService).switchEnvironment('SANDBOX').subscribe();
    http
      .expectOne({ method: 'PUT', url: `${BASE}/active-environment` })
      .flush({ ...ADMIN_PROD, environment: 'SANDBOX', activeEnvironment: 'SANDBOX' });
    fixture.detectChanges();
    expect(bar()?.textContent).toContain('Asaas de testes');
  });

  it('falha do status: sem faixa e sem erro', () => {
    mount(jwt({ system_role: 'PLATFORM_ADMIN', companyId: COMPANY }));
    http.expectOne(BASE).flush('x', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(bar()).toBeNull();
  });

  describe('troca de contexto com a casca já montada (o token troca no lugar)', () => {
    const SANDBOX = {
      ...ADMIN_PROD,
      environment: 'SANDBOX' as const,
      activeEnvironment: 'SANDBOX' as const,
    };

    it('entrar em "ver como empresa": a faixa some e nenhuma requisição sai', () => {
      mount(jwt({ system_role: 'PLATFORM_ADMIN', companyId: COMPANY }));
      http.expectOne(BASE).flush(SANDBOX);
      fixture.detectChanges();
      expect(bar()).not.toBeNull();

      // ImpersonationService.begin(): reset dos caches e, em seguida, o token de suporte
      TestBed.inject(TenantResetRegistry).run();
      sessionStorage.setItem(
        'token',
        jwt({ system_role: 'USER', impersonation: true, companyId: 'cliente' }),
      );
      fixture.detectChanges();
      expect(bar()).toBeNull();
      http.expectNone(BASE);
    });

    it('a página do cliente carregando SANDBOX durante a sessão de suporte não acende a faixa', () => {
      mount(jwt({ system_role: 'USER', impersonation: true, companyId: 'cliente' }));
      http.expectNone(BASE);
      TestBed.inject(AsaasIntegrationService).load().subscribe();
      http.expectOne(BASE).flush(SANDBOX);
      fixture.detectChanges();
      expect(bar()).toBeNull();
    });

    it('sair da sessão de suporte: volta a pedir o status do admin e a faixa reflete a empresa dele', () => {
      mount(jwt({ system_role: 'USER', impersonation: true, companyId: 'cliente' }));
      http.expectNone(BASE);

      TestBed.inject(TenantResetRegistry).run();
      sessionStorage.setItem('token', jwt({ system_role: 'PLATFORM_ADMIN', companyId: COMPANY }));
      fixture.detectChanges();
      http.expectOne(BASE).flush(SANDBOX);
      fixture.detectChanges();
      expect(bar()).not.toBeNull();
    });

    it('admin troca de empresa: o status da anterior não vale; pede de novo e só mostra o da nova', () => {
      mount(jwt({ system_role: 'PLATFORM_ADMIN', companyId: COMPANY }));
      http.expectOne(BASE).flush(SANDBOX);
      fixture.detectChanges();
      expect(bar()).not.toBeNull();

      TestBed.inject(TenantResetRegistry).run();
      sessionStorage.setItem('token', jwt({ system_role: 'PLATFORM_ADMIN', companyId: 'outra' }));
      fixture.detectChanges();
      expect(bar()).toBeNull();
      http.expectOne(BASE).flush(ADMIN_PROD);
      fixture.detectChanges();
      expect(bar()).toBeNull();
    });
  });
});
