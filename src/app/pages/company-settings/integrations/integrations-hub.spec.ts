import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { IntegrationsHub } from './integrations-hub';
import { AsaasIntegrationService } from './asaas-integration.service';
import { AsaasIntegrationStatus } from './asaas-integration.types';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';

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

/**
 * Feedback standard (phase 3): a falha de carregamento do status era ENGOLIDA
 * (`error: () => void 0`), deixando um empty state enganoso. Agora aparece
 * inline — e nunca vira toast, porque o screen reivindica o erro.
 */
describe('IntegrationsHub — falha ao carregar o status', () => {
  const status = signal<AsaasIntegrationStatus | null>(null);
  let load: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;

  function render(): ReturnType<typeof TestBed.createComponent<IntegrationsHub>> {
    const fixture = TestBed.createComponent(IntegrationsHub);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    status.set(null);
    load = vi.fn();
    notifyError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [IntegrationsHub],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: AsaasIntegrationService, useValue: { status, load } },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            warning: vi.fn(),
            info: vi.fn(),
            success: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renderiza o erro inline e não dispara toast', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { message: 'Falha ao consultar o provedor de integração.' },
    });
    load.mockReturnValue(throwError(() => error));

    const fixture = render();
    const banner = fixture.nativeElement.querySelector('app-alert-banner');

    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Falha ao consultar o provedor de integração.');
    expect(banner?.querySelector('[role="alert"]')).not.toBeNull();

    // nunca toast — a rede de segurança do interceptor fica quieta
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('trata 404 como "não configurado": sem banner e sem toast', () => {
    const error = new HttpErrorResponse({ status: 404, error: { message: 'Não encontrado.' } });
    load.mockReturnValue(throwError(() => error));
    status.set({
      connected: false,
      environment: null,
      connectedAt: null,
      lastVerifiedAt: null,
    });

    const fixture = render();

    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Não configurado');

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('não renderiza banner quando o load funciona', () => {
    load.mockReturnValue(
      of<AsaasIntegrationStatus>({
        connected: true,
        environment: 'PRODUCTION',
        connectedAt: '2026-01-01T00:00:00Z',
        lastVerifiedAt: '2026-01-01T00:00:00Z',
      }),
    );

    const fixture = render();
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
  });
});
