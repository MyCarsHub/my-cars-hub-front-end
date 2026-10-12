import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';

import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../services/notification.service';
import { AsaasIntegration } from './asaas-integration';
import type { AsaasIntegrationStatus } from './asaas-integration.types';

const BASE = `${environment.apiUrl}/companies/current/integrations/asaas`;

const CONNECTED: AsaasIntegrationStatus = {
  connected: true,
  environment: 'PRODUCTION',
  connectedAt: '2026-08-01T12:00:00',
  lastVerifiedAt: '2026-08-02T12:00:00',
  webhookAutoConfigured: true,
  webhookStatus: 'REGISTERED',
  webhookFailureReason: null,
};

const BROKEN: AsaasIntegrationStatus = {
  ...CONNECTED,
  webhookAutoConfigured: false,
  webhookStatus: 'FAILED',
  webhookFailureReason: 'A URL de callback não está acessível pelo Asaas.',
};

/**
 * O Asaas pode RECUSAR o webhook com o `connect` devolvendo 200. Antes a tela só
 * lia o booleano: a empresa ficava "conectada" sem nenhum pagamento chegando e
 * ninguém via o motivo nem tinha como consertar sem desconectar.
 */
describe('AsaasIntegration — estado do webhook', () => {
  let fixture: ComponentFixture<AsaasIntegration>;
  let http: HttpTestingController;

  async function open(status: AsaasIntegrationStatus): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AsaasIntegration],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    fixture = TestBed.createComponent(AsaasIntegration);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(BASE).flush(status);
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ');
  }

  function reregisterButton(): HTMLButtonElement | null {
    return host().querySelector('[data-testid="webhook-reregister"]');
  }

  function toasts(): { kind: string; message: string }[] {
    return TestBed.inject(NotificationService)
      .notifications()
      .map((n) => ({ kind: n.kind, message: n.message }));
  }

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('REGISTERED: mantém a linha de sucesso e não mostra faixa nem botão', async () => {
    await open(CONNECTED);

    expect(text()).toContain('Webhook configurado automaticamente');
    expect(host().querySelector('[data-testid="webhook-broken"]')).toBeNull();
    expect(reregisterButton()).toBeNull();
  });

  it('FAILED: mostra o aviso com a consequência, o motivo e o botão — e NÃO a linha de sucesso', async () => {
    await open(BROKEN);

    const copy = text();
    expect(copy).toContain('O webhook do Asaas não está registrado.');
    expect(copy).toContain('Sem o webhook, os pagamentos feitos no Asaas não aparecem aqui.');
    expect(copy).toContain(
      'Motivo informado pelo Asaas: A URL de callback não está acessível pelo Asaas.',
    );
    expect(copy).not.toContain('Webhook configurado automaticamente');
    expect(reregisterButton()?.textContent?.trim()).toBe('Registrar webhook novamente');
    expect(host().querySelector('[data-testid="webhook-broken"] [role="alert"]')).not.toBeNull();
  });

  it('FAILED sem motivo (linha antiga): não inventa um', async () => {
    await open({ ...BROKEN, webhookFailureReason: null });

    expect(host().querySelector('[data-testid="webhook-broken"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="webhook-reason"]')).toBeNull();
    expect(text()).not.toContain('Motivo informado');
  });

  it('backend antigo: sem webhookStatus, o booleano falso também acusa', async () => {
    await open({
      connected: true,
      environment: 'PRODUCTION',
      connectedAt: null,
      lastVerifiedAt: null,
      webhookAutoConfigured: false,
    });
    expect(host().querySelector('[data-testid="webhook-broken"]')).not.toBeNull();
  });

  it('sem nenhum sinal do webhook não afirma nem sucesso nem falha', async () => {
    await open({
      connected: true,
      environment: 'PRODUCTION',
      connectedAt: null,
      lastVerifiedAt: null,
    });
    expect(host().querySelector('[data-testid="webhook-broken"]')).toBeNull();
    expect(text()).not.toContain('Webhook configurado automaticamente');
  });

  describe('Registrar webhook novamente', () => {
    it('POSTa em /webhook, desabilita e mostra "Registrando…" enquanto espera', async () => {
      await open(BROKEN);

      reregisterButton()?.click();
      await settle();

      const req = http.expectOne(`${BASE}/webhook`);
      expect(req.request.method).toBe('POST');
      expect(reregisterButton()?.disabled).toBe(true);
      expect(reregisterButton()?.textContent?.trim()).toBe('Registrando…');
      req.flush(CONNECTED);
      await settle();
    });

    it('clique repetido durante a espera não dispara um segundo registro', async () => {
      await open(BROKEN);

      const button = reregisterButton();
      button?.click();
      button?.click();
      await settle();

      const pending = http.match(`${BASE}/webhook`);
      expect(pending).toHaveLength(1);
      pending[0].flush(CONNECTED);
      await settle();
    });

    it('registrado: a faixa some, volta a linha de sucesso e há toast de sucesso', async () => {
      await open(BROKEN);

      reregisterButton()?.click();
      await settle();
      http.expectOne(`${BASE}/webhook`).flush(CONNECTED);
      await settle();

      expect(host().querySelector('[data-testid="webhook-broken"]')).toBeNull();
      expect(text()).toContain('Webhook configurado automaticamente');
      expect(toasts()).toContainEqual({ kind: 'success', message: 'Webhook registrado no Asaas.' });
    });

    it('recusado de novo (200 com FAILED): a faixa fica com o motivo MAIS RECENTE e sem toast de sucesso', async () => {
      await open(BROKEN);

      reregisterButton()?.click();
      await settle();
      http
        .expectOne(`${BASE}/webhook`)
        .flush({ ...BROKEN, webhookFailureReason: 'Limite de webhooks atingido na conta.' });
      await settle();

      expect(text()).toContain('Motivo informado pelo Asaas: Limite de webhooks atingido na conta.');
      expect(host().querySelector('[data-testid="webhook-retry-failed"]')).not.toBeNull();
      expect(toasts().some((t) => t.kind === 'success')).toBe(false);
      expect(reregisterButton()?.disabled).toBe(false);
    });

    it('falha HTTP: mostra a mensagem do servidor na faixa e libera o botão', async () => {
      await open(BROKEN);

      reregisterButton()?.click();
      await settle();
      http
        .expectOne(`${BASE}/webhook`)
        .flush({ message: 'Sem permissão para registrar o webhook.' }, { status: 403, statusText: 'Forbidden' });
      await settle();

      expect(host().querySelector('[data-testid="webhook-broken"]')?.textContent).toContain(
        'Sem permissão para registrar o webhook.',
      );
      expect(reregisterButton()?.disabled).toBe(false);
      expect(toasts().some((t) => t.kind === 'success')).toBe(false);
    });
  });

  describe('conectar com o webhook recusado', () => {
    it('avisa que o webhook não foi registrado em vez de "conectada com sucesso"', async () => {
      await open({
        connected: false,
        environment: null,
        connectedAt: null,
        lastVerifiedAt: null,
      });
      const cmp = fixture.componentInstance as unknown as {
        connectForm: { patchValue: (v: Record<string, unknown>) => void };
        submitConnect: () => void;
      };
      cmp.connectForm.patchValue({ accessToken: 'chave-longa-o-suficiente', environment: 'PRODUCTION' });

      cmp.submitConnect();
      await settle();
      http.expectOne(BASE).flush(BROKEN);
      await settle();

      const kinds = toasts();
      expect(kinds.some((t) => t.kind === 'success')).toBe(false);
      expect(kinds).toContainEqual({
        kind: 'warning',
        message: 'Integração conectada, mas o webhook não foi registrado. Veja o aviso na página.',
      });
      // E a página, já conectada, mostra o aviso com o botão.
      expect(host().querySelector('[data-testid="webhook-broken"]')).not.toBeNull();
    });
  });
});
