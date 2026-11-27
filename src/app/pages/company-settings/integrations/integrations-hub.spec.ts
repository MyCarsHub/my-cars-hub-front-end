import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { IntegrationsHub } from './integrations-hub';
import { AsaasIntegrationService } from './asaas-integration.service';
import { AsaasIntegrationStatus, AsaasOverview } from './asaas-integration.types';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';

const OFF: AsaasIntegrationStatus = {
  connected: false,
  environment: null,
  connectedAt: null,
  lastVerifiedAt: null,
};

function connected(over: Partial<AsaasIntegrationStatus> = {}): AsaasIntegrationStatus {
  return {
    connected: true,
    environment: 'PRODUCTION',
    connectedAt: '2026-01-01T00:00:00Z',
    lastVerifiedAt: '2026-01-01T00:00:00Z',
    webhookStatus: 'REGISTERED',
    ...over,
  };
}

function overview(over: Partial<AsaasOverview> = {}): AsaasOverview {
  return {
    asaas: { accountName: 'Locadora', cpfCnpjMasked: null, balanceCents: 128450, fees: null },
    asaasError: null,
    month: {
      sentCount: 4,
      sentCents: 400000,
      paidCount: 3,
      paidCents: 300000,
      overdueCount: 0,
      overdueCents: 0,
      autoSettledCount: 3,
      feesPaidCents: null,
    },
    lastPaymentNoticeAt: null,
    awaitingSettlementCount: 0,
    openCharges: null,
    recentReceipts: null,
    ...over,
  };
}

describe('IntegrationsHub — vitrine', () => {
  const status = signal<AsaasIntegrationStatus | null>(null);
  const overviewSig = signal<AsaasOverview | null>(null);
  const overviewLoading = signal(false);
  const asaas = {
    status,
    overview: overviewSig,
    overviewLoading,
    load: vi.fn(),
    loadOverview: vi.fn(),
  };

  /** O service real grava o status ao responder; o dublê faz o mesmo. */
  function respondWith(s: AsaasIntegrationStatus): void {
    asaas.load.mockImplementation(() => {
      status.set(s);
      return of(s);
    });
  }

  function respondOverview(ov: AsaasOverview | null): void {
    asaas.loadOverview.mockImplementation(() => {
      overviewSig.set(ov);
      return ov ? of(ov) : throwError(() => new HttpErrorResponse({ status: 500 }));
    });
  }

  beforeEach(() => {
    status.set(null);
    overviewSig.set(null);
    overviewLoading.set(false);
    asaas.load.mockReset();
    asaas.loadOverview.mockReset();
    respondWith(OFF);
    respondOverview(overview());

    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AsaasIntegrationService, useValue: asaas }],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(IntegrationsHub);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const q = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it('título no plural, igual ao menu', () => {
    const el = render();
    expect(el.textContent).toContain('Integrações');
  });

  it('mostra o esqueleto enquanto o status não chegou', () => {
    asaas.load.mockReturnValue(of(OFF)); // não grava o status: ainda carregando
    const el = render();
    expect(q(el, 'hub-asaas-loading')).not.toBeNull();
    expect(q(el, 'hub-asaas-on')).toBeNull();
  });

  it('desligado: cartão neutro com "Ligar" para a página do Asaas e sem pedir números', () => {
    const el = render();
    expect(q(el, 'hub-asaas-off')).not.toBeNull();
    const link = q(el, 'hub-asaas-connect') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/configuracoes/integracoes/asaas');
    expect(link.textContent?.trim()).toBe('Ligar');
    expect(asaas.loadOverview).not.toHaveBeenCalled();
  });

  it('ligado em produção: cartão pintado que abre a página, chip Ligado, saldo e recebido no mês', () => {
    respondWith(connected());
    const el = render();
    const card = q(el, 'hub-asaas-on') as HTMLAnchorElement;
    expect(card.getAttribute('href')).toBe('/configuracoes/integracoes/asaas');
    expect(card.classList).toContain('paint');
    expect(q(el, 'hub-asaas-chip')?.textContent?.trim()).toBe('Ligado');
    expect(asaas.loadOverview).toHaveBeenCalledOnce();
    expect(q(el, 'hub-asaas-balance')?.textContent).toContain('1.284');
    expect(q(el, 'hub-asaas-balance')?.textContent).toContain(',50');
    expect(card.textContent).toContain('Saldo no Asaas');
    expect(card.textContent).toContain('Recebido em');
    expect(card.textContent).toContain('3.000,00');
    expect(card.querySelectorAll('.mini i').length).toBe(4);
    expect(card.querySelectorAll('.mini i.off').length).toBe(0);
  });

  it('chave de testes: chip Testes e saldo da conta de testes', () => {
    respondWith(connected({ environment: 'SANDBOX' }));
    const el = render();
    expect(q(el, 'hub-asaas-chip')?.textContent?.trim()).toBe('Testes');
    expect(q(el, 'hub-asaas-on')?.textContent).toContain('Saldo na conta de testes');
  });

  it('aviso parado: chip, alerta no cartão e as duas últimas paradas apagadas', () => {
    respondWith(connected({ webhookStatus: 'FAILED' }));
    const el = render();
    const card = q(el, 'hub-asaas-on') as HTMLElement;
    expect(q(el, 'hub-asaas-chip')?.textContent?.trim()).toBe('Aviso parado');
    expect(q(el, 'hub-asaas-broken')).not.toBeNull();
    expect(card.querySelectorAll('.mini i.off').length).toBe(2);
    expect(card.textContent).not.toContain('Recebido em');
  });

  it('sem webhookStatus, cai em webhookAutoConfigured=false como aviso parado', () => {
    respondWith(connected({ webhookStatus: undefined, webhookAutoConfigured: false }));
    const el = render();
    expect(q(el, 'hub-asaas-chip')?.textContent?.trim()).toBe('Aviso parado');
  });

  it('pagamento esperando baixa apaga só a última parada', () => {
    respondWith(connected());
    respondOverview(overview({ awaitingSettlementCount: 2 }));
    const el = render();
    const offs = q(el, 'hub-asaas-on')!.querySelectorAll('.mini i.off');
    expect(offs.length).toBe(1);
  });

  it('o Asaas não deu o saldo: diz que não leu, nunca inventa número', () => {
    respondWith(connected());
    respondOverview(overview({ asaas: null, asaasError: 'UNAVAILABLE' }));
    const el = render();
    expect(q(el, 'hub-asaas-balance')).toBeNull();
    expect(q(el, 'hub-asaas-on')?.textContent).toContain('Saldo não lido agora');
  });

  it('falha ao ler os números não vira erro da tela', () => {
    respondWith(connected());
    respondOverview(null);
    const el = render();
    expect(el.querySelector('app-alert-banner')).toBeNull();
    expect(q(el, 'hub-asaas-on')).not.toBeNull();
    expect(q(el, 'hub-asaas-on')?.textContent).toContain('Saldo não lido agora');
  });

  it('tolera erro no load() sem quebrar o template', () => {
    asaas.load.mockReturnValue(throwError(() => new Error('boom')));
    expect(() => render()).not.toThrow();
  });
});

/**
 * Feedback standard (phase 3): a falha de carregamento do status aparece inline — e nunca
 * vira toast, porque a tela reivindica o erro.
 */
describe('IntegrationsHub — falha ao carregar o status', () => {
  const status = signal<AsaasIntegrationStatus | null>(null);
  let load: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;

  function render() {
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
        {
          provide: AsaasIntegrationService,
          useValue: {
            status,
            overview: signal(null),
            overviewLoading: signal(false),
            load,
            loadOverview: vi.fn(() => of(null)),
          },
        },
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
    // status não lido: nunca oferece "Ligar" para uma conta que talvez já esteja ligada
    expect(fixture.nativeElement.querySelector('[data-testid="hub-asaas-connect"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="hub-asaas-unknown"]')).not.toBeNull();

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('trata 404 como "não ligado": sem banner, sem toast, com o botão Ligar', () => {
    const error = new HttpErrorResponse({ status: 404, error: { message: 'Não encontrado.' } });
    load.mockReturnValue(throwError(() => error));
    status.set(OFF);

    const fixture = render();

    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="hub-asaas-connect"]')).not.toBeNull();

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('não renderiza banner quando o load funciona', () => {
    load.mockReturnValue(of<AsaasIntegrationStatus>(connected()));
    const fixture = render();
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
  });
});
