import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../services/notification.service';
import { OWNED_HTTP_ERRORS } from '../../../services/http-errors.context';
import { AsaasIntegration } from './asaas-integration';
import type { AsaasIntegrationStatus, AsaasOverview } from './asaas-integration.types';
import { checkAsaasKey } from './asaas-integration.view';
import { deriveAsaasViewer, isImpersonationToken } from './asaas-integration.viewer';

const BASE = `${environment.apiUrl}/companies/current/integrations/asaas`;
const OVERVIEW = `${BASE}/overview`;
const PROD_KEY = '$aact_prod_000000000000000000000000000000';
const TEST_KEY = '$aact_hmlg_000000000000000000000000000000';

/** JWT só com o payload que a tela lê (a assinatura não é conferida no navegador). */
function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'HS256' })}.${enc({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload })}.sig`;
}
const OWNER_TOKEN = jwt({ system_role: 'USER', role: 'OWNER' });
const ADMIN_TOKEN = jwt({ system_role: 'PLATFORM_ADMIN' });
const SUPPORT_TOKEN = jwt({ system_role: 'USER', impersonation: true });

const CONNECTED: AsaasIntegrationStatus = {
  connected: true,
  environment: 'PRODUCTION',
  connectedAt: '2026-11-20T12:00:00',
  lastVerifiedAt: '2026-11-25T12:00:00',
  webhookAutoConfigured: true,
  webhookStatus: 'REGISTERED',
  webhookFailureReason: null,
};

const CONNECTED_ADMIN: AsaasIntegrationStatus = {
  ...CONNECTED,
  activeEnvironment: 'PRODUCTION',
  environments: [
    {
      environment: 'PRODUCTION',
      active: true,
      connectedAt: '2026-11-25T09:00:00',
      lastVerifiedAt: null,
      webhookAutoConfigured: true,
      webhookStatus: 'REGISTERED',
      webhookFailureReason: null,
    },
    {
      environment: 'SANDBOX',
      active: false,
      connectedAt: '2026-11-20T09:00:00',
      lastVerifiedAt: null,
      webhookAutoConfigured: true,
      webhookStatus: 'REGISTERED',
      webhookFailureReason: null,
    },
  ],
};

const BROKEN: AsaasIntegrationStatus = {
  ...CONNECTED,
  webhookAutoConfigured: false,
  webhookStatus: 'FAILED',
  webhookFailureReason: 'URL inválida',
};

const NOT_CONNECTED: AsaasIntegrationStatus = {
  connected: false,
  environment: null,
  connectedAt: null,
  lastVerifiedAt: null,
  webhookAutoConfigured: false,
  webhookStatus: 'NOT_CONNECTED',
  webhookFailureReason: null,
};

const FULL: AsaasOverview = {
  asaas: {
    accountName: 'Mycarshub Locações',
    cpfCnpjMasked: '••.•••.•••/0001-23',
    balanceCents: 128450,
    fees: { pixFixedCents: 199, boletoFixedCents: 199, cardPercent: 2.99, cardFixedCents: 49 },
  },
  asaasError: null,
  month: {
    sentCount: 12,
    sentCents: 580000,
    paidCount: 5,
    paidCents: 215000,
    overdueCount: 1,
    overdueCents: 65000,
    autoSettledCount: 5,
    // o backend não guarda o netValue do Asaas: sempre null hoje
    feesPaidCents: null,
  },
  lastPaymentNoticeAt: '2026-11-23T11:22:00',
  awaitingSettlementCount: 2,
  openCharges: { charges: 0, rentals: 0 },
  recentReceipts: [
    {
      paidAt: '2026-11-19',
      driverName: 'Rafael Souza',
      plate: 'TES2T02',
      chargeLabel: 'Semana 3',
      method: null, // nunca guardado
      amountCents: 65000,
      rentalId: '33333333-3333-3333-3333-333333333333',
    },
  ],
};

describe('AsaasIntegration', () => {
  let fixture: ComponentFixture<AsaasIntegration>;
  let http: HttpTestingController;

  async function open(
    token: string,
    status: AsaasIntegrationStatus,
    overview?: AsaasOverview,
  ): Promise<void> {
    sessionStorage.setItem('token', token);
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
    http.expectOne({ method: 'GET', url: BASE }).flush(status);
    if (overview) http.expectOne(OVERVIEW).flush(overview);
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends Element = HTMLElement>(testId: string): T | null =>
    host().querySelector<T>(`[data-testid="${testId}"]`);
  const text = (el: Element | null = host()): string =>
    (el?.textContent ?? '').replace(/\s+/g, ' ');
  const toasts = () =>
    TestBed.inject(NotificationService)
      .notifications()
      .map((n) => ({ kind: n.kind, message: n.message }));

  async function typeKey(value: string): Promise<void> {
    const input = q<HTMLInputElement>('asaas-key')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  /** A folha sai com animação (BOTTOM_SHEET_LEAVE_MS) e só então avisa que fechou. */
  async function sheetGone(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 260));
    await settle();
    expect(q('asaas-switch-confirm')).toBeNull();
  }

  beforeEach(() => sessionStorage.clear());

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });

  // ------------------------------------------------------------------ quatro estados
  describe('estados da página', () => {
    it('carregando: esqueleto enquanto o status não chega', () => {
      sessionStorage.setItem('token', OWNER_TOKEN);
      TestBed.configureTestingModule({
        imports: [AsaasIntegration],
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      });
      fixture = TestBed.createComponent(AsaasIntegration);
      http = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      expect(q('asaas-loading')).not.toBeNull();
      http.expectOne(BASE).flush(NOT_CONNECTED);
    });

    it('erro: mostra a falha com "Tentar de novo", que pede o status outra vez', async () => {
      sessionStorage.setItem('token', OWNER_TOKEN);
      TestBed.configureTestingModule({
        imports: [AsaasIntegration],
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      });
      fixture = TestBed.createComponent(AsaasIntegration);
      http = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      http.expectOne(BASE).flush('boom', { status: 500, statusText: 'Server Error' });
      await settle();
      expect(q('asaas-load-error')).not.toBeNull();

      q<HTMLButtonElement>('asaas-retry')!.click();
      await settle();
      http.expectOne(BASE).flush(CONNECTED);
      http.expectOne(OVERVIEW).flush(FULL);
      await settle();
      expect(q('asaas-load-error')).toBeNull();
      expect(q('asaas-flow')).not.toBeNull();
    });

    it('vazio (não ligado): a esteira de 4 passos com o campo, sem pedir o overview', async () => {
      await open(OWNER_TOKEN, NOT_CONNECTED);
      expect(text()).toContain('Ligar em 4 passos');
      expect(q('asaas-key')).not.toBeNull();
      expect(text(q('asaas-chip'))).toContain('Desligado');
      expect(q('asaas-menu')).toBeNull();
    });

    it('dados: saldo em mono, caminho do dinheiro, recebimentos e taxas', async () => {
      await open(OWNER_TOKEN, CONNECTED, FULL);
      expect(text(q('asaas-chip'))).toContain('Ligado');
      expect(text(q('asaas-balance-amount'))).toContain('1.284');
      expect(text(q('asaas-balance-amount'))).toContain(',50');
      expect(text(q('asaas-account'))).toContain('Mycarshub Locações');
      const flow = text(q('asaas-flow'));
      expect(flow).toContain('Cobrança enviada');
      expect(flow).toContain('R$ 5.800,00');
      expect(flow).toContain('5 pagas · 1 atrasada');
      expect(flow).toContain('Asaas avisou');
      expect(flow).toContain('5 marcadas como pagas');
      expect(host().querySelectorAll('[data-testid="asaas-receipt"]').length).toBe(1);
      expect(text(q('asaas-fees'))).toContain('2,99% + R$ 0,49');
      // feesPaidCents null (sempre, hoje): a linha "Pagas em …" não aparece
      expect(q('asaas-fees-paid')).toBeNull();
      expect(text()).not.toContain('Pagas em');
    });

    it('recebimentos: sem forma de pagamento (nunca guardada) e o link leva ao aluguel pelo UUID', async () => {
      await open(OWNER_TOKEN, CONNECTED, FULL);
      const headers = Array.from(host().querySelectorAll('.tbl th')).map((th) => text(th).trim());
      expect(headers).toEqual(['Carro', 'Motorista', 'Cobrança', 'Pago', 'Valor']);
      expect(text(q('asaas-receipts'))).not.toContain('Pix');
      expect(text()).not.toContain('Forma');
      const link = q<HTMLAnchorElement>('asaas-receipt')!;
      expect(link.getAttribute('href')).toBe('/alugueis/33333333-3333-3333-3333-333333333333');
    });

    it('sem acesso (402 no overview): estado de sem acesso, sem quebrar a página', async () => {
      await open(OWNER_TOKEN, CONNECTED);
      const req = http.expectOne(OVERVIEW);
      // 402 aqui é "papel sem acesso", não o paywall: a tela é dona do status, sem toast genérico
      expect(req.request.context.get(OWNED_HTTP_ERRORS)).toBe(true);
      req.flush({ message: 'Sem acesso' }, { status: 402, statusText: 'Payment Required' });
      await settle();
      expect(q('asaas-denied')).not.toBeNull();
      expect(text(q('asaas-denied'))).toContain('Só o dono e o gerente');
      expect(toasts()).toEqual([]);
      expect(q('asaas-flow')).toBeNull();
      expect(q('asaas-menu')).toBeNull();
    });

    it('sem acesso (402 no status): mesmo estado, e não o de erro com "Tentar de novo"', async () => {
      sessionStorage.setItem('token', OWNER_TOKEN);
      TestBed.configureTestingModule({
        imports: [AsaasIntegration],
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      });
      fixture = TestBed.createComponent(AsaasIntegration);
      http = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      http.expectOne(BASE).flush({ message: 'x' }, { status: 402, statusText: 'Payment Required' });
      await settle();
      expect(q('asaas-denied')).not.toBeNull();
      expect(q('asaas-load-error')).toBeNull();
    });

    it('recebimentos vazios: diz que ainda não há, sem lista nem tabela', async () => {
      await open(OWNER_TOKEN, CONNECTED, { ...FULL, recentReceipts: [] });
      expect(q('asaas-receipts-empty')).not.toBeNull();
      expect(host().querySelector('table')).toBeNull();
    });
  });

  // ------------------------------------------------------- prefixo da chave
  describe('conferência do prefixo da chave', () => {
    it('regra pura: produção serve para os dois; testes é erro para o dono e Testes para o admin', () => {
      expect(checkAsaasKey(PROD_KEY, false)).toMatchObject({
        ok: true,
        environment: 'PRODUCTION',
        tone: 'good',
      });
      expect(checkAsaasKey(PROD_KEY, true)).toMatchObject({ ok: true, environment: 'PRODUCTION' });
      expect(checkAsaasKey(TEST_KEY, false)).toMatchObject({
        ok: false,
        tone: 'bad',
        text: 'Essa é de testes. Gere a chave na sua conta de verdade.',
      });
      expect(checkAsaasKey(TEST_KEY, true)).toMatchObject({
        ok: true,
        environment: 'SANDBOX',
        tone: 'good',
      });
      expect(checkAsaasKey('$aact_prod_abc', false)).toMatchObject({ ok: false, tone: 'muted' });
      expect(checkAsaasKey('$aa', false)).toMatchObject({ ok: false, tone: 'muted' });
      expect(checkAsaasKey('sk_live_123', false)).toMatchObject({ ok: false, tone: 'bad' });
      expect(checkAsaasKey('', true)).toMatchObject({ ok: false, tone: 'muted' });
    });

    it('dono colando chave de testes: vê o erro e "Conectar" fica travado', async () => {
      await open(OWNER_TOKEN, NOT_CONNECTED);
      await typeKey(TEST_KEY);
      expect(text(q('asaas-key-check'))).toContain('Essa é de testes');
      expect(q<HTMLButtonElement>('asaas-connect')!.disabled).toBe(true);
    });

    it('dono com chave de produção: conecta PRODUCTION e então pede o overview', async () => {
      await open(OWNER_TOKEN, NOT_CONNECTED);
      await typeKey(PROD_KEY);
      expect(text(q('asaas-key-check'))).toContain('Chave de produção');
      q<HTMLButtonElement>('asaas-connect')!.click();
      const req = http.expectOne({ method: 'POST', url: BASE });
      expect(req.request.body).toEqual({ accessToken: PROD_KEY, environment: 'PRODUCTION' });
      req.flush(CONNECTED);
      http.expectOne(OVERVIEW).flush(FULL);
      await settle();
      expect(toasts().some((t) => t.kind === 'success')).toBe(true);
      expect(q('asaas-flow')).not.toBeNull();
    });

    it('admin colando chave de testes: aceita e conecta como SANDBOX', async () => {
      await open(ADMIN_TOKEN, NOT_CONNECTED);
      await typeKey(TEST_KEY);
      expect(text(q('asaas-key-check'))).toContain('Fica guardada como Testes');
      q<HTMLButtonElement>('asaas-connect')!.click();
      const req = http.expectOne({ method: 'POST', url: BASE });
      expect(req.request.body.environment).toBe('SANDBOX');
      req.flush({
        ...CONNECTED,
        environment: 'SANDBOX',
        activeEnvironment: 'SANDBOX',
        environments: [],
      });
      http.expectOne(OVERVIEW).flush(FULL);
      await settle();
    });

    it('sessão "ver como empresa": o claim de impersonação vem antes do papel — vê como dono', async () => {
      expect(isImpersonationToken(SUPPORT_TOKEN)).toBe(true);
      expect(isImpersonationToken(OWNER_TOKEN)).toBe(false);
      expect(isImpersonationToken('lixo')).toBe(false);
      expect(deriveAsaasViewer(SUPPORT_TOKEN, () => true)).toBe('support');
      expect(deriveAsaasViewer(ADMIN_TOKEN, () => true)).toBe('admin');
      expect(deriveAsaasViewer(OWNER_TOKEN, () => false)).toBe('owner');

      // a sessão de suporte é só leitura: nem chega a ter o campo (ver o bloco abaixo)
      await open(SUPPORT_TOKEN, NOT_CONNECTED);
      expect(q('asaas-key')).toBeNull();
    });
  });

  // ------------------------------------------------- sessão "ver como empresa"
  describe('sessão "ver como empresa" (só leitura)', () => {
    it('ligado: vê como o dono, sem Religar, sem Ambiente; o ⋮ só tem o que relê', async () => {
      await open(
        SUPPORT_TOKEN,
        { ...BROKEN, activeEnvironment: 'SANDBOX', environments: [] },
        FULL,
      );
      expect(q('asaas-flow')).not.toBeNull();
      expect(q('asaas-webhook-failed')).not.toBeNull();
      expect(q('asaas-relink')).toBeNull();
      expect(q('asaas-environment')).toBeNull();

      q<HTMLButtonElement>('asaas-menu')!.click();
      await settle();
      expect(q('asaas-menu-test')).not.toBeNull();
      expect(q('asaas-menu-howto')).not.toBeNull();
      expect(q('asaas-menu-key')).toBeNull();
      expect(q('asaas-menu-disconnect')).toBeNull();
      http.expectNone({ method: 'POST' });
      http.expectNone({ method: 'PUT' });
      http.expectNone({ method: 'DELETE' });
    });

    it('não ligado: os passos sem o campo nem Conectar, com "Só a empresa pode ligar o Asaas."', async () => {
      await open(SUPPORT_TOKEN, NOT_CONNECTED);
      expect(text()).toContain('Ligar em 4 passos');
      expect(q('asaas-key')).toBeNull();
      expect(q('asaas-connect')).toBeNull();
      expect(text(q('asaas-readonly-connect'))).toContain('Só a empresa pode ligar o Asaas.');
    });
  });

  // ------------------------------------------------------------ troca travada
  describe('troca de ambiente (admin)', () => {
    it('o dono não vê o card Ambiente', async () => {
      await open(OWNER_TOKEN, CONNECTED, FULL);
      expect(q('asaas-environment')).toBeNull();
    });

    it('com cobrança aberta a chave trava: explica com os números e NÃO chama o PUT', async () => {
      await open(ADMIN_TOKEN, CONNECTED_ADMIN, {
        ...FULL,
        openCharges: { charges: 7, rentals: 3 },
      });
      expect(q('asaas-environment')).not.toBeNull();
      q<HTMLButtonElement>('asaas-env-test')!.click();
      await settle();
      const blocked = text(q('asaas-switch-blocked'));
      expect(blocked).toContain('7 cobranças abertas');
      expect(blocked).toContain('3 aluguéis');
      expect(blocked).toContain('Ver os aluguéis');
      http.expectNone({ method: 'PUT' });
      expect(q('asaas-switch-confirm')).toBeNull();
    });

    it('o 409 ASAAS_SWITCH_OPEN_CHARGES do servidor também vira o aviso de troca travada', async () => {
      await open(ADMIN_TOKEN, CONNECTED_ADMIN, FULL);
      q<HTMLButtonElement>('asaas-env-test')!.click();
      await settle();
      q<HTMLButtonElement>('asaas-switch-confirm')!.click();
      http
        .expectOne({ method: 'PUT', url: `${BASE}/active-environment` })
        .flush(
          { message: 'Há 1 cobrança aberta.', code: 'ASAAS_SWITCH_OPEN_CHARGES' },
          { status: 409, statusText: 'Conflict' },
        );
      http.expectOne(OVERVIEW).flush({ ...FULL, openCharges: { charges: 1, rentals: 1 } });
      await settle();
      expect(text(q('asaas-switch-blocked'))).toContain('Há 1 cobrança aberta.');
      await sheetGone();
    });

    it('sem cobrança aberta: confirma e troca para Testes (a faixa amarela é da casca)', async () => {
      await open(ADMIN_TOKEN, CONNECTED_ADMIN, FULL);
      expect(host().querySelector('.ign')!.getAttribute('data-env')).toBe('prod');
      q<HTMLButtonElement>('asaas-env-test')!.click();
      await settle();
      q<HTMLButtonElement>('asaas-switch-confirm')!.click();
      const req = http.expectOne({ method: 'PUT', url: `${BASE}/active-environment` });
      expect(req.request.body).toEqual({ environment: 'SANDBOX' });
      req.flush({ ...CONNECTED_ADMIN, environment: 'SANDBOX', activeEnvironment: 'SANDBOX' });
      http.expectOne(OVERVIEW).flush(FULL);
      await settle();
      expect(host().querySelector('.ign')!.getAttribute('data-env')).toBe('test');
      await sheetGone();
    });
  });

  // --------------------------------------------------------------- aviso parado
  describe('aviso parado (webhookStatus=FAILED)', () => {
    it('etapa 3 vermelha com "Religar" e o motivo do Asaas; etapa 4 parada', async () => {
      await open(OWNER_TOKEN, BROKEN, { ...FULL, awaitingSettlementCount: null });
      expect(text(q('asaas-chip'))).toContain('Aviso parado');
      const notice = host().querySelector('[data-step="notice"]')!;
      expect(notice.getAttribute('data-state')).toBe('bad');
      expect(text(notice)).toContain('desde 23/11');
      expect(q('asaas-relink')).not.toBeNull();
      const settle4 = host().querySelector('[data-step="settle"]')!;
      expect(settle4.getAttribute('data-state')).toBe('idle');
      expect(text(settle4)).toContain('Parada');
      // awaitingSettlementCount vem null com o webhook parado: a cópia não precisa de número
      expect(text(settle4)).toContain('espera o aviso voltar');
      expect(text(settle4.querySelector('small'))).not.toMatch(/\d/);
      expect(text(q('asaas-webhook-reason'))).toContain('URL inválida');
    });

    it('"Religar" chama POST /webhook; registrado, o caminho volta ao verde', async () => {
      await open(OWNER_TOKEN, BROKEN, FULL);
      q<HTMLButtonElement>('asaas-relink')!.click();
      await settle();
      expect(q<HTMLButtonElement>('asaas-relink')!.disabled).toBe(true);
      http.expectOne({ method: 'POST', url: `${BASE}/webhook` }).flush(CONNECTED);
      http.expectOne(OVERVIEW).flush(FULL);
      await settle();
      expect(q('asaas-webhook-failed')).toBeNull();
      expect(host().querySelector('[data-step="notice"]')!.getAttribute('data-state')).toBe('done');
    });

    it('recusado de novo (200 com FAILED): fica parado e diz que a nova tentativa falhou', async () => {
      await open(OWNER_TOKEN, BROKEN, FULL);
      q<HTMLButtonElement>('asaas-relink')!.click();
      http.expectOne(`${BASE}/webhook`).flush({ ...BROKEN, webhookFailureReason: 'Timeout' });
      await settle();
      expect(q('asaas-relink-failed')).not.toBeNull();
      expect(text(q('asaas-webhook-reason'))).toContain('Timeout');
      expect(toasts().some((t) => t.kind === 'success')).toBe(false);
    });

    it('backend antigo: sem webhookStatus, o booleano falso também acusa', async () => {
      await open(
        OWNER_TOKEN,
        { ...CONNECTED, webhookStatus: undefined, webhookAutoConfigured: false },
        FULL,
      );
      expect(q('asaas-webhook-failed')).not.toBeNull();
    });
  });

  // --------------------------------------------------------- Asaas fora do ar
  describe('Asaas indisponível (asaas=null)', () => {
    it('o card do saldo diz que não leu e oferece tentar de novo; o resto da página segue', async () => {
      await open(OWNER_TOKEN, CONNECTED, { ...FULL, asaas: null, asaasError: 'UNAVAILABLE' });
      expect(text(q('asaas-balance-failed'))).toContain('Não deu para ler o saldo agora');
      expect(q('asaas-balance-amount')).toBeNull();
      // o resto segue: caminho e recebimentos, que vêm do MyCarsHub
      expect(text(q('asaas-flow'))).toContain('R$ 5.800,00');
      expect(host().querySelectorAll('[data-testid="asaas-receipt"]').length).toBe(1);
      // taxas vêm do Asaas: o card some inteiro
      expect(q('asaas-fees')).toBeNull();

      q<HTMLButtonElement>('asaas-balance-retry')!.click();
      http.expectOne(OVERVIEW).flush(FULL);
      await settle();
      expect(q('asaas-balance-amount')).not.toBeNull();
    });

    it('só as taxas falharam (asaas com fees todos null): mantém o saldo e some só o card de taxas', async () => {
      await open(OWNER_TOKEN, CONNECTED, {
        ...FULL,
        asaas: {
          ...FULL.asaas!,
          fees: {
            pixFixedCents: null,
            boletoFixedCents: null,
            cardPercent: null,
            cardFixedCents: null,
          },
        },
      });
      expect(text(q('asaas-balance-amount'))).toContain('1.284');
      expect(q('asaas-balance-failed')).toBeNull();
      expect(q('asaas-fees')).toBeNull();
    });

    it('falha parcial (saldo null, nome presente, UNAVAILABLE): saldo com tentar de novo, nome e taxas ficam', async () => {
      await open(OWNER_TOKEN, CONNECTED, {
        ...FULL,
        asaas: { ...FULL.asaas!, balanceCents: null, cpfCnpjMasked: null },
        asaasError: 'UNAVAILABLE',
      });
      expect(text(q('asaas-balance-failed'))).toContain('Não deu para ler o saldo agora');
      expect(q('asaas-balance-retry')).not.toBeNull();
      expect(q('asaas-balance-amount')).toBeNull();
      // cada campo some sozinho: o nome veio, o documento não
      expect(text(q('asaas-account'))).toContain('Mycarshub Locações');
      expect(text(q('asaas-account'))).not.toContain('·');
      expect(text(q('asaas-fees'))).toContain('Pix');
    });

    it('falha parcial com saldo lido: mostra o saldo mesmo com asaasError=UNAVAILABLE', async () => {
      await open(OWNER_TOKEN, CONNECTED, {
        ...FULL,
        asaas: { ...FULL.asaas!, accountName: null, fees: null },
        asaasError: 'UNAVAILABLE',
      });
      expect(text(q('asaas-balance-amount'))).toContain('1.284');
      expect(text(q('asaas-account'))).toContain('/0001-23');
      expect(q('asaas-fees')).toBeNull();
    });

    it('chave recusada (UNAUTHORIZED): aponta para trocar a chave', async () => {
      await open(OWNER_TOKEN, CONNECTED, { ...FULL, asaas: null, asaasError: 'UNAUTHORIZED' });
      expect(text(q('asaas-balance'))).toContain('Troque a chave');
    });

    it('falha do próprio overview: o caminho continua (com o estado do webhook) e o saldo oferece tentar de novo', async () => {
      sessionStorage.setItem('token', OWNER_TOKEN);
      TestBed.configureTestingModule({
        imports: [AsaasIntegration],
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      });
      fixture = TestBed.createComponent(AsaasIntegration);
      http = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      http.expectOne(BASE).flush(BROKEN);
      http.expectOne(OVERVIEW).flush('x', { status: 503, statusText: 'Unavailable' });
      await settle();
      expect(q('asaas-balance-retry')).not.toBeNull();
      expect(q('asaas-relink')).not.toBeNull();
      expect(q('asaas-receipts')).toBeNull();
    });
  });

  // -------------------------------------------------------- campos null somem
  describe('campos null somem', () => {
    it('sem feesPaidCents, sem taxas, sem conta, sem aviso nem pendências: nada inventado', async () => {
      await open(OWNER_TOKEN, BROKEN, {
        ...FULL,
        asaas: { accountName: null, cpfCnpjMasked: null, balanceCents: 1000, fees: null },
        month: { ...FULL.month!, feesPaidCents: null },
        lastPaymentNoticeAt: null,
        awaitingSettlementCount: null,
      });
      expect(q('asaas-fees')).toBeNull();
      expect(text()).not.toContain('Pagas em');
      expect(q('asaas-account')).toBeNull();
      expect(text(host().querySelector('[data-step="notice"]'))).not.toContain('desde');
      expect(text(host().querySelector('[data-step="settle"] small'))).not.toMatch(/\d/);
    });

    it('taxa parcial: só o que o Asaas informou aparece', async () => {
      await open(OWNER_TOKEN, CONNECTED, {
        ...FULL,
        asaas: {
          ...FULL.asaas!,
          fees: {
            pixFixedCents: 199,
            boletoFixedCents: null,
            cardPercent: 2.99,
            cardFixedCents: null,
          },
        },
      });
      expect(host().querySelector('[data-fee="pix"]')).not.toBeNull();
      expect(host().querySelector('[data-fee="barcode"]')).toBeNull();
      expect(text(host().querySelector('[data-fee="card"]'))).toContain('2,99%');
      expect(text(host().querySelector('[data-fee="card"]'))).not.toContain('+');
    });

    it('lastPaymentNoticeAt é horário de Brasília sem fuso: mostrado como veio, sem deslocar', async () => {
      await open(OWNER_TOKEN, CONNECTED, { ...FULL, lastPaymentNoticeAt: '2026-01-05T23:40:00' });
      expect(text(host().querySelector('[data-step="notice"]'))).toContain('05/01, 23:40');
    });

    it('recebimento sem placa nem rótulo: a linha some com eles, sem "null"', async () => {
      await open(OWNER_TOKEN, CONNECTED, {
        ...FULL,
        recentReceipts: [
          { ...FULL.recentReceipts![0], plate: null, chargeLabel: null, rentalId: null },
        ],
      });
      const row = q('asaas-receipt')!;
      expect(row.querySelector('.plate')).toBeNull();
      expect(text(row)).not.toContain('null');
      expect(row.tagName).toBe('DIV');
    });
  });
});
