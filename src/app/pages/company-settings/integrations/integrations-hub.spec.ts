import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { IntegrationsHub } from './integrations-hub';
import { AsaasIntegrationService } from './asaas-integration.service';
import { AsaasIntegrationStatus } from './asaas-integration.types';

describe('IntegrationsHub', () => {
  const status = signal<AsaasIntegrationStatus | null>(null);
  const asaas = {
    status,
    load: vi.fn(() => of<AsaasIntegrationStatus>({
      connected: false,
      environment: null,
      connectedAt: null,
      lastVerifiedAt: null,
    })),
  };

  beforeEach(() => {
    status.set(null);
    asaas.load.mockClear();
    asaas.load.mockReturnValue(
      of<AsaasIntegrationStatus>({
        connected: false,
        environment: null,
        connectedAt: null,
        lastVerifiedAt: null,
      }),
    );

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AsaasIntegrationService, useValue: asaas },
      ],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(IntegrationsHub);
    fixture.detectChanges();
    return fixture;
  }

  it('renderiza card Asaas com título e link para /configuracoes/integracoes/asaas', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain('Asaas');
    expect(el.textContent).toContain('Integração');

    const link = el.querySelector<HTMLAnchorElement>(
      'a[href="/configuracoes/integracoes/asaas"]',
    );
    expect(link).not.toBeNull();
  });

  it('chama asaas.load() no ngOnInit', () => {
    render();
    expect(asaas.load).toHaveBeenCalledOnce();
  });

  it('exibe badge "Não configurado" quando status.connected é falso', () => {
    status.set({
      connected: false,
      environment: null,
      connectedAt: null,
      lastVerifiedAt: null,
    });
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Não configurado');
    expect(el.textContent).not.toContain('Conectado');
  });

  it('atualiza badge para "Conectado" quando o signal muda', () => {
    const fixture = render();
    status.set({
      connected: true,
      environment: 'PRODUCTION',
      connectedAt: '2026-01-01T00:00:00Z',
      lastVerifiedAt: '2026-01-01T00:00:00Z',
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Conectado');
    expect(el.textContent).not.toContain('Não configurado');
  });

  it('tolera erro no load() sem quebrar o template', () => {
    asaas.load.mockReturnValue(throwError(() => new Error('boom')));
    expect(() => render()).not.toThrow();
  });
});
