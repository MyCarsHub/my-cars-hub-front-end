import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChargeIntegration } from './charge-integration';
import { ChargeIntegrationService } from './charge-integration.service';
import type { ChargeIntegrationStatus } from './charge-integration.types';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';

const DISCONNECTED: ChargeIntegrationStatus = {
  connected: false,
  provider: null,
  environment: null,
  connectedAt: null,
  lastVerifiedAt: null,
  webhookAutoConfigured: false,
};

/**
 * FIX-0087 — a tela de integracao de cobrancas era um dos tres retardatarios do
 * caminho de erro compartilhado.
 *
 * Tinha um `extractError` proprio, copia literal do que havia no hub de gerencia,
 * que aceitava QUALQUER objeto com `message`: numa falha de rede escrevia
 * "Failed to fetch" embaixo do formulario. Ignorava `fieldErrors` — justamente
 * onde o backend diz QUAL campo da chave esta errado — e nao reivindicava o erro,
 * entao um 400 ganhava a mensagem inline E o toast da rede de seguranca.
 */
describe('ChargeIntegration — caminho de erro compartilhado (FIX-0087)', () => {
  let fixture: ComponentFixture<ChargeIntegration>;
  let connect: ReturnType<typeof vi.fn>;
  let disconnect: ReturnType<typeof vi.fn>;
  let notifyPush: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ');
  }

  /** Preenche o formulario com uma chave valida e submete. */
  function submitConnect(): void {
    const component = fixture.componentInstance as unknown as {
      connectForm: { patchValue: (v: Record<string, unknown>) => void };
      submit: () => void;
    };
    component.connectForm.patchValue({
      provider: 'asaas',
      accessToken: 'chave-longa-o-suficiente',
      environment: 'PRODUCTION',
    });
    component.submit();
    fixture.detectChanges();
  }

  beforeEach(() => {
    connect = vi.fn();
    disconnect = vi.fn();
    notifyPush = vi.fn();
    notifyError = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: ChargeIntegrationService,
          useValue: {
            status: signal(DISCONNECTED),
            loading: signal(false),
            saving: signal(false),
            error: signal(null),
            load: vi.fn().mockReturnValue(of(DISCONNECTED)),
            connect,
            disconnect,
          },
        },
        { provide: SessionService, useValue: { isPlatformAdmin: () => false } },
        {
          provide: NotificationService,
          useValue: {
            push: notifyPush,
            error: notifyError,
            warning: vi.fn(),
            info: vi.fn(),
            success: vi.fn(),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(ChargeIntegration);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falha de rede mostra o fallback em portugues, nao "Failed to fetch"', () => {
    connect.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') })),
    );

    submitConnect();

    expect(text()).toContain('Não foi possível conectar. Tente novamente.');
    expect(text()).not.toContain('Failed to fetch');
  });

  it('mostra fieldErrors, que o extrator local ignorava', () => {
    connect.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { fieldErrors: { accessToken: 'Chave sem permissão de escrita.' } },
          }),
      ),
    );

    submitConnect();

    expect(text()).toContain('Chave sem permissão de escrita.');
  });

  it('o 400 mantem o fallback especifico da chave rejeitada quando o backend nao explica', () => {
    connect.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: {} })));

    submitConnect();

    expect(text()).toContain('Chave rejeitada pelo provedor.');
  });

  it('reivindica o erro — a mensagem inline nao ganha um toast por cima', () => {
    vi.useFakeTimers();
    const failure = new HttpErrorResponse({
      status: 400,
      error: { message: 'Chave invalida para este ambiente.' },
    });
    connect.mockReturnValue(throwError(() => failure));

    submitConnect();
    TestBed.inject(ApiErrorService).scheduleSafetyNet(failure);
    vi.runAllTimers();

    expect(text()).toContain('Chave invalida para este ambiente.');
    expect(notifyError).not.toHaveBeenCalled();
  });

  /**
   * O desconectar mostra o erro num toast PROPRIO. Sem reivindicar, o usuario
   * levava DOIS toasts vermelhos pela mesma falha.
   */
  it('desconectar: um unico toast, nao dois', () => {
    vi.useFakeTimers();
    const failure = new HttpErrorResponse({
      status: 409,
      error: { message: 'Existem cobrancas em aberto.' },
    });
    disconnect.mockReturnValue(throwError(() => failure));

    const component = fixture.componentInstance as unknown as { confirmDisconnect: () => void };
    component.confirmDisconnect();
    fixture.detectChanges();

    TestBed.inject(ApiErrorService).scheduleSafetyNet(failure);
    vi.runAllTimers();

    expect(notifyPush).toHaveBeenCalledWith('error', 'Existem cobrancas em aberto.');
    expect(notifyError).not.toHaveBeenCalled();
  });

  /** Controle: um erro que NINGUEM reivindicou continua toastando. */
  it('controle: erro nao reivindicado ainda dispara a rede de seguranca', () => {
    vi.useFakeTimers();
    const orphan = new HttpErrorResponse({ status: 400, error: { message: 'Sem dono.' } });

    TestBed.inject(ApiErrorService).scheduleSafetyNet(orphan);
    vi.runAllTimers();

    expect(notifyError).toHaveBeenCalledWith('Sem dono.');
  });
});
