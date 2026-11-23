import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../environments/environment';
import { ImpersonationService } from '../../services/impersonation.service';
import type { RentalChargeDto, RentalResponseDto } from '../../types/rental.types';
import { RentalDetail } from './rental-detail';
import { NotificationService } from '../../services/notification.service';

/**
 * Defeitos do plano de teste de 23/11 (decisão do dono, 23/11) no detalhe do aluguel:
 * F5 (estorno da caução não confirmado), F7 (caução no Asaas em aluguel manual),
 * F8 ("Gerar de novo" em FAILED vencida) e F14 (renegociar aluguel concluído).
 */

const BASE = `${environment.apiUrl}/rentals`;
const RENTAL_ID = 'r-1';

const RENTAL: RentalResponseDto = {
  id: RENTAL_ID,
  vehicleId: 'v-1',
  driverId: 'd-1',
  startDate: '2020-01-06',
  endDate: '2099-12-31',
  periodRate: 75_000,
  totalAmount: 900_000,
  caucaoAmount: 0,
  caucaoPaid: false,
  status: 'ACTIVE',
  billingFrequency: 'WEEKLY',
  automaticCharge: true,
  notes: null,
  initialKm: null,
  pickupDate: null,
  firstPaymentDate: null,
  dailyInterestAmount: null,
  lateFineType: 'FIXED',
  lateFineValue: 5_000,
  contractSource: null,
  franchiseKm: null,
  returnFuelPolicy: null,
  charges: [],
  createdAt: '2020-01-06T00:00:00Z',
  modifiedAt: '2020-01-06T00:00:00Z',
};

const route = {
  snapshot: {
    paramMap: { get: (k: string) => (k === 'id' ? RENTAL_ID : null) },
    queryParamMap: { get: () => null },
  },
};

function charge(overrides: Partial<RentalChargeDto> = {}): RentalChargeDto {
  return {
    id: 'c-1',
    kind: 'RENTAL_PERIOD',
    amount: 75_000,
    status: 'PENDING',
    provider: 'ASAAS',
    externalId: 'pay_1',
    checkoutUrl: 'https://sandbox.asaas.com/i/1',
    paidAt: null,
    dueDate: '2099-12-07',
    periodIndex: 3,
    ...overrides,
  };
}

function signIn(role: string, features: string[] | null): void {
  const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600 };
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  sessionStorage.setItem('token', `header.${b64}.signature`);
  if (features) sessionStorage.setItem('features', JSON.stringify(features));
}

async function mount(opts: {
  flex?: boolean;
  charges: RentalChargeDto[];
  rental?: Partial<RentalResponseDto>;
  edit?: boolean;
}): Promise<{ fixture: ComponentFixture<RentalDetail>; http: HttpTestingController }> {
  TestBed.resetTestingModule();
  sessionStorage.clear();
  signIn('OWNER', opts.flex ? ['CHARGES_FLEX'] : []);
  TestBed.configureTestingModule({
    imports: [RentalDetail],
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideNoopAnimations(),
      { provide: ActivatedRoute, useValue: route },
      {
        provide: ImpersonationService,
        useValue: {
          active: () => !!opts.edit,
          editMode: () => !!opts.edit,
          readOnly: () => false,
          reconcile: vi.fn(),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(RentalDetail);
  const http = TestBed.inject(HttpTestingController);
  await settle(fixture);
  http.expectOne(`${BASE}/${RENTAL_ID}`).flush({ ...RENTAL, ...opts.rental, charges: opts.charges });
  await settle(fixture);
  for (const req of http.match((r) => r.method === 'GET')) {
    if (req.request.url.endsWith('/agreements')) req.flush([]);
    else req.flush(req.request.url.includes('signature') ? null : []);
  }
  await settle(fixture);
  return { fixture, http };
}

async function settle(fixture: ComponentFixture<RentalDetail>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function el(fixture: ComponentFixture<RentalDetail>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** Abre os ⋮ um a um e devolve o primeiro item com o `data-testid` (o menu fica aberto). */
function menuItem(fixture: ComponentFixture<RentalDetail>, testId: string): HTMLButtonElement | null {
  const triggers = Array.from(el(fixture).querySelectorAll('[aria-haspopup="menu"]')) as HTMLButtonElement[];
  for (const trigger of triggers) {
    trigger.click();
    fixture.detectChanges();
    const item = el(fixture).querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    if (item) return item;
    trigger.click();
    fixture.detectChanges();
  }
  return null;
}

/** Abre os ⋮ um a um e diz se algum item tem o texto. */
function anyMenuItemWithText(fixture: ComponentFixture<RentalDetail>, text: string): boolean {
  const triggers = Array.from(el(fixture).querySelectorAll('[aria-haspopup="menu"]')) as HTMLButtonElement[];
  for (const trigger of triggers) {
    trigger.click();
    fixture.detectChanges();
    const found = Array.from(el(fixture).querySelectorAll('[role="menuitem"]')).some((b) =>
      (b.textContent ?? '').includes(text),
    );
    trigger.click();
    fixture.detectChanges();
    if (found) return true;
  }
  return false;
}

function byTestId<T extends HTMLElement = HTMLElement>(fixture: ComponentFixture<RentalDetail>, id: string): T | null {
  return el(fixture).querySelector<T>(`[data-testid="${id}"]`);
}

describe('RentalDetail — defeitos de 23/11', () => {
  afterEach(() => sessionStorage.clear());

  // ------------------------------------------------------------------ F8
  it('F8 — FAILED com vencimento no passado não oferece "Gerar de novo" (permanece em atraso)', async () => {
    const { fixture } = await mount({
      charges: [charge({ id: 'f-old', status: 'FAILED', externalId: null, checkoutUrl: null, dueDate: '2020-01-13' })],
    });
    expect(anyMenuItemWithText(fixture, 'Gerar de novo')).toBe(false);
  });

  it('F8 — FAILED que ainda não venceu continua com "Gerar de novo"', async () => {
    const { fixture } = await mount({
      charges: [charge({ id: 'f-new', status: 'FAILED', externalId: null, checkoutUrl: null, dueDate: '2099-12-07' })],
    });
    expect(anyMenuItemWithText(fixture, 'Gerar de novo')).toBe(true);
  });

  // ------------------------------------------------------------------ F14
  it('F14 — aluguel concluído não oferece "Renegociar"', async () => {
    const { fixture } = await mount({
      flex: true,
      rental: { status: 'COMPLETED', completedAt: '2026-11-20T12:00:00' },
      charges: [charge({ id: 'w2', periodIndex: 1, dueDate: '2020-01-13', status: 'PAST_DUE' })],
    });
    expect(menuItem(fixture, 'charge-menu-renegotiate')).toBeNull();
  });

  it('F14 — aluguel ativo segue oferecendo "Renegociar"', async () => {
    const { fixture } = await mount({
      flex: true,
      charges: [charge({ id: 'w2', periodIndex: 1, dueDate: '2020-01-13', status: 'PAST_DUE' })],
    });
    expect(menuItem(fixture, 'charge-menu-renegotiate')).not.toBeNull();
  });

  // ------------------------------------------------------------------ F7
  it('F7 — aluguel manual com a caução cancelada não oferece "Gerar nova cobrança da caução"', async () => {
    const { fixture } = await mount({
      rental: { automaticCharge: false, caucaoAmount: 50_000 },
      charges: [charge({ id: 'cc', kind: 'CAUCAO', status: 'CANCELED', periodIndex: null, amount: 50_000 })],
    });
    expect(byTestId(fixture, 'generate-caucao-charge')).toBeNull();
  });

  it('F7 — aluguel automático com a caução cancelada continua oferecendo', async () => {
    const { fixture } = await mount({
      rental: { automaticCharge: true, caucaoAmount: 50_000 },
      charges: [charge({ id: 'cc', kind: 'CAUCAO', status: 'CANCELED', periodIndex: null, amount: 50_000 })],
    });
    expect(byTestId(fixture, 'generate-caucao-charge')).not.toBeNull();
  });

  // ------------------------------------------------------------------ F5
  const PAID_CAUCAO = charge({
    id: 'cc',
    kind: 'CAUCAO',
    status: 'PAID',
    periodIndex: null,
    amount: 50_000,
    paidAt: '2026-11-01T12:00:00',
    checkoutUrl: null,
  });
  const ENDED_PENDING_REFUND: Partial<RentalResponseDto> = {
    status: 'COMPLETED',
    completedAt: '2026-11-20T12:00:00',
    caucaoAmount: 50_000,
    caucaoPaid: true,
    caucaoRefundMethod: 'AUTOMATIC',
    caucaoRefundedAmount: 50_000,
    caucaoRefundedAt: null,
  };

  it('F5 — estorno automático não confirmado: aviso no card, resumo honesto e as duas saídas no menu', async () => {
    const { fixture } = await mount({ rental: ENDED_PENDING_REFUND, charges: [PAID_CAUCAO] });

    expect(byTestId(fixture, 'caucao-refund-pending-banner')?.textContent).toContain(
      'O Asaas não confirmou o estorno da caução',
    );
    expect(byTestId(fixture, 'caucao-refund-pending-summary')?.textContent).toContain('Estorno não confirmado');
    expect(menuItem(fixture, 'charge-menu-refund-retry')).not.toBeNull();
    expect(byTestId(fixture, 'charge-menu-refund-manual')).not.toBeNull();
  });

  it('F5 — "Registrar devolução por fora" confirma e chama o endpoint com MANUAL', async () => {
    const { fixture, http } = await mount({ rental: ENDED_PENDING_REFUND, charges: [PAID_CAUCAO] });

    menuItem(fixture, 'charge-menu-refund-manual')!.click();
    await settle(fixture);
    const confirm = Array.from(el(fixture).querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Registrar devolução',
    ) as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    confirm.click();
    await settle(fixture);

    const req = http.expectOne(`${BASE}/${RENTAL_ID}/caucao-refund`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ method: 'MANUAL' });
    req.flush({
      ...RENTAL,
      ...ENDED_PENDING_REFUND,
      caucaoRefundMethod: 'MANUAL',
      caucaoRefundedAt: '2026-11-23T10:00:00',
      charges: [{ ...PAID_CAUCAO, status: 'REFUNDED' }],
    });
    await settle(fixture);
    expect(byTestId(fixture, 'caucao-refund-pending-banner')).toBeNull();
  });

  it('F5 — estorno que deu certo (caução RELEASED) não mostra aviso nem as saídas', async () => {
    const { fixture } = await mount({
      rental: { ...ENDED_PENDING_REFUND, caucaoRefundedAt: '2026-11-20T12:00:00' },
      charges: [{ ...PAID_CAUCAO, status: 'RELEASED' }],
    });
    expect(byTestId(fixture, 'caucao-refund-pending-banner')).toBeNull();
    expect(menuItem(fixture, 'charge-menu-refund-retry')).toBeNull();
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Achados do E2E de produção de 23/11 (N1–N19) que moram no detalhe do aluguel. */
describe('RentalDetail — achados do E2E de 23/11', () => {
  afterEach(() => sessionStorage.clear());

  const cmp = (f: ComponentFixture<RentalDetail>): Any => f.componentInstance as Any;

  it('N3 — excluir mostra "Excluindo…", trava os botões e um 2º toque não manda outro DELETE', async () => {
    const { fixture, http } = await mount({ charges: [] });
    cmp(fixture).askDelete();
    await settle(fixture);
    cmp(fixture).confirmDelete();
    await settle(fixture);
    const confirm = Array.from(el(fixture).querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Excluindo…',
    ) as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    expect(confirm.disabled).toBe(true);
    cmp(fixture).confirmDelete();
    expect(http.match((r) => r.method === 'DELETE').length).toBe(1);
  });

  it('N5 — o nome do ⋮ diz a parcela e usa a palavra da tabela', async () => {
    const { fixture } = await mount({
      charges: [
        charge({ id: 'p1', periodIndex: 0, instalmentIndex: 1, instalmentCount: 2, dueDate: '2099-12-01' }),
        charge({ id: 'p2', periodIndex: 0, instalmentIndex: 2, instalmentCount: 2, dueDate: '2099-12-04' }),
      ],
    });
    const labels = Array.from(el(fixture).querySelectorAll('[aria-haspopup="menu"]')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toContain('Ações: Semana 1, parcela 1 de 2');
    expect(labels).toContain('Ações: Semana 1, parcela 2 de 2');
    expect(labels.join(' ')).not.toContain('período');
  });

  it('N6 — o painel do ⋮ tem borda visível também no escuro', async () => {
    const { fixture } = await mount({ charges: [charge()] });
    const trigger = el(fixture).querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const panel = el(fixture).querySelector('[role="menu"]') as HTMLElement;
    expect(panel.className).toContain('dark:border-edge-strong');
  });

  it('N8 — "Pago em" do meio-dia sintético mostra só a data', async () => {
    const { fixture } = await mount({
      charges: [charge({ status: 'PAID', paidAt: '2026-11-01T12:00:00', checkoutUrl: null })],
    });
    const text = el(fixture).textContent ?? '';
    expect(text).toContain('01/11/2026');
    expect(text).not.toContain('12:00');
  });

  it('N10 — com caução no acordo, o total diz "Aluguel + acordos" e explica a parte da caução', async () => {
    const { fixture } = await mount({
      rental: { caucaoAmount: 80_000 },
      charges: [charge({ id: 'cc', kind: 'CAUCAO', status: 'RENEGOTIATED', periodIndex: null, amount: 80_000 })],
    });
    expect(byTestId(fixture, 'values-total-label')?.textContent?.trim()).toBe('Aluguel + acordos');
    expect(byTestId(fixture, 'values-caucao-in-agreement')?.textContent?.replace(/ /g, ' ')).toContain('R$ 800,00');
  });

  it('N11 — a caução cancelada continua na lista com "Cancelada"', async () => {
    const { fixture } = await mount({
      rental: { caucaoAmount: 50_000 },
      charges: [
        charge({ id: 'old', kind: 'CAUCAO', status: 'CANCELED', periodIndex: null, amount: 50_000 }),
        charge({ id: 'new', kind: 'CAUCAO', status: 'PENDING', periodIndex: null, amount: 50_000 }),
      ],
    });
    expect(cmp(fixture).caucaoRows().map((c: RentalChargeDto) => c.id)).toEqual(['old', 'new']);
    expect(el(fixture).textContent).toContain('Cancelada');
  });

  it('N13 — "Desmarcar" da caução recebida por fora está no ⋮, não num botão da linha', async () => {
    const { fixture } = await mount({
      rental: { automaticCharge: false, caucaoAmount: 80_000, caucaoPaid: true },
      charges: [],
    });
    const plain = Array.from(el(fixture).querySelectorAll('button')).filter(
      (b) => (b.textContent ?? '').trim() === 'Desmarcar',
    );
    expect(plain).toHaveLength(0);
    expect(menuItem(fixture, 'caucao-menu-unmark')).not.toBeNull();
  });

  it('N14 — marcar e desmarcar falam "Semana 1", como a tabela', async () => {
    const week1 = charge({ id: 'w1', periodIndex: 0, provider: 'INTERNAL', externalId: null, checkoutUrl: null });
    const { fixture } = await mount({ rental: { automaticCharge: false }, charges: [week1] });
    cmp(fixture).askMarkPaid(week1);
    expect(cmp(fixture).markPaidEntityLabel()).toBe('Semana 1');
    cmp(fixture).askUnmarkPaid({ ...week1, status: 'PAID' });
    expect(cmp(fixture).unmarkPaidMessage()).toContain('Semana 1');
    expect(cmp(fixture).unmarkPaidMessage()).not.toContain('período');
  });

  it('N15 — concluir antes do fim avisa "encerrado como cancelado" e relê o aluguel', async () => {
    const { fixture, http } = await mount({ charges: [charge()] });
    const push = vi.spyOn(TestBed.inject(NotificationService), 'push');
    cmp(fixture).confirmComplete({ date: '2026-11-23', removeOverdueCharges: false });
    http.expectOne(`${BASE}/${RENTAL_ID}/complete`).flush({ ...RENTAL, status: 'CANCELED', charges: [charge()] });
    await settle(fixture);
    expect(push).toHaveBeenCalledWith('success', 'Aluguel encerrado como cancelado.');
    const reload = http.match((r) => r.method === 'GET' && r.url === `${BASE}/${RENTAL_ID}`);
    expect(reload.length).toBe(1);
  });

  it('N15 — aluguel encerrado: o card Caução mostra a devolução e não oferece desmarcar', async () => {
    const { fixture } = await mount({
      rental: {
        status: 'COMPLETED',
        automaticCharge: false,
        caucaoAmount: 80_000,
        caucaoPaid: true,
        caucaoRefundMethod: 'MANUAL',
        caucaoRefundedAmount: 80_000,
        caucaoRefundedAt: '2026-11-23T10:00:00',
      },
      charges: [],
    });
    expect(byTestId(fixture, 'caucao-refund-state')?.textContent?.replace(/ /g, ' ').trim()).toBe(
      'Devolvida por fora · R$ 800,00 · 23/11',
    );
    expect(menuItem(fixture, 'caucao-menu-unmark')).toBeNull();
  });

  it('N15 — "Não devolver" aparece como "Retida pelo locador" no card Caução', async () => {
    const { fixture } = await mount({
      rental: {
        status: 'COMPLETED',
        caucaoAmount: 80_000,
        caucaoPaid: true,
        caucaoRefundMethod: 'NONE',
        caucaoRefundedAmount: 0,
      },
      charges: [],
    });
    expect(byTestId(fixture, 'caucao-refund-state')?.textContent?.trim()).toBe('Retida pelo locador');
  });

  it('N7 — a data mínima é o dia da criação e a recusa da data volta para a folha com o rascunho', async () => {
    const { fixture, http } = await mount({
      flex: true,
      rental: { createdAt: '2026-11-20T15:00:00Z' },
      charges: [charge({ id: 'w', status: 'PAST_DUE', dueDate: '2026-11-21' })],
    });
    expect(cmp(fixture).receivedOutsideMinDate()).toBe('2026-11-20');
    const draft = { receivedOn: '2026-11-19', reason: 'CASH', note: 'em mãos' };
    cmp(fixture).receivedOutsideTarget.set(charge({ id: 'w', status: 'PAST_DUE', dueDate: '2026-11-21' }));
    cmp(fixture).receivedOutsideDraft.set(draft);
    cmp(fixture).confirmReceivedOutside();
    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/charges/w/received-outside'))
      .flush({ code: 'RECEIVED_OUTSIDE_BEFORE_CREATED', message: 'x' }, { status: 400, statusText: 'Bad Request' });
    expect(cmp(fixture).receivedOutsideSheetOpen()).toBe(true);
    expect(cmp(fixture).receivedOutsideDateError()).toContain('antes de o aluguel ser criado');
    expect(cmp(fixture).receivedOutsideDraft()).toEqual(draft);
  });

  it('N7 — outra recusa do servidor também volta para a folha, num aviso dentro dela', async () => {
    const { fixture, http } = await mount({ flex: true, charges: [charge({ id: 'w', status: 'PAST_DUE' })] });
    cmp(fixture).receivedOutsideTarget.set(charge({ id: 'w', status: 'PAST_DUE' }));
    cmp(fixture).receivedOutsideDraft.set({ receivedOn: '2026-11-21', reason: 'CASH', note: null });
    cmp(fixture).confirmReceivedOutside();
    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/charges/w/received-outside'))
      .flush({ code: 'CHARGE_BUSY', message: 'x' }, { status: 409, statusText: 'Conflict' });
    expect(cmp(fixture).receivedOutsideSheetOpen()).toBe(true);
    expect(cmp(fixture).receivedOutsideServerError()).toBe('A cobrança está sendo processada agora.');
    expect(cmp(fixture).actionError()).toBeNull();
  });
});

/** Revisões de 23/11 (review a frio + segurança) no detalhe do aluguel. */
describe('RentalDetail — correções das revisões de 23/11', () => {
  afterEach(() => sessionStorage.clear());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cmp = (f: ComponentFixture<RentalDetail>): any => f.componentInstance as any;

  const PAID_PART = (id: string, index: number): RentalChargeDto =>
    charge({
      id,
      kind: 'CAUCAO',
      status: 'PAID',
      periodIndex: null,
      amount: 50_000,
      instalmentIndex: index,
      instalmentCount: 2,
      paidAt: '2026-11-01T12:00:00',
      checkoutUrl: null,
    });

  it('H1 — estorno parcial que deu certo (com data) não vira "estorno pendente", mesmo com parte paga retida', async () => {
    const { fixture } = await mount({
      rental: {
        status: 'COMPLETED',
        caucaoAmount: 100_000,
        caucaoPaid: true,
        caucaoRefundMethod: 'AUTOMATIC',
        caucaoRefundedAmount: 50_000,
        caucaoRefundedAt: '2026-11-23T10:00:00',
      },
      charges: [{ ...PAID_PART('p1', 1), status: 'RELEASED' }, PAID_PART('p2', 2)],
    });
    expect(byTestId(fixture, 'caucao-refund-pending-banner')).toBeNull();
    expect(menuItem(fixture, 'charge-menu-refund-manual')).toBeNull();
  });

  it('M4 — o aviso e a confirmação mandam conferir no Asaas, sem afirmar que nada mudou', async () => {
    const { fixture } = await mount({
      rental: {
        status: 'COMPLETED',
        caucaoAmount: 50_000,
        caucaoPaid: true,
        caucaoRefundMethod: 'AUTOMATIC',
        caucaoRefundedAmount: 50_000,
        caucaoRefundedAt: null,
      },
      charges: [PAID_PART('p1', 1)],
    });
    const banner = byTestId(fixture, 'caucao-refund-pending-banner')?.textContent ?? '';
    expect(banner).toContain('confira no Asaas');
    expect(banner).not.toContain('continua com você');
    cmp(fixture).askSettleCaucaoRefund('MANUAL');
    expect(cmp(fixture).settleRefundDialogMessage()).toContain('Confira no Asaas');
  });

  it('L7 — na sessão de suporte em modo edição os itens do estorno não aparecem (a rota é negada)', async () => {
    const { fixture } = await mount({
      edit: true,
      rental: {
        status: 'COMPLETED',
        caucaoAmount: 50_000,
        caucaoPaid: true,
        caucaoRefundMethod: 'AUTOMATIC',
        caucaoRefundedAmount: 50_000,
        caucaoRefundedAt: null,
      },
      charges: [PAID_PART('p1', 1)],
    });
    expect(menuItem(fixture, 'charge-menu-refund-manual')).toBeNull();
  });

  it('M2 — "já tinha sido paga pelo link" relê o aluguel', async () => {
    const failed = charge({ id: 'f', status: 'FAILED', provider: 'ASAAS', externalId: null, checkoutUrl: null });
    const { fixture, http } = await mount({ charges: [failed] });
    cmp(fixture).markPaidTarget.set(failed);
    cmp(fixture).confirmMarkPaid('2026-11-23');
    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/charges/f/mark-paid'))
      .flush(
        { code: 'MARK_PAID_ALREADY_PAID', message: 'Esta cobrança já tinha sido paga pelo link.' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(fixture);
    expect(http.match((r) => r.method === 'GET' && r.url === `${BASE}/${RENTAL_ID}`).length).toBe(1);
  });

  it('M3 — aluguel encerrado não oferece desmarcar a caução paga', async () => {
    const caucao = charge({
      id: 'cc',
      kind: 'CAUCAO',
      status: 'PAID',
      periodIndex: null,
      provider: 'INTERNAL',
      externalId: null,
      checkoutUrl: null,
    });
    const closed = await mount({ rental: { status: 'COMPLETED', automaticCharge: false, caucaoAmount: 50_000 }, charges: [caucao] });
    expect(cmp(closed.fixture).canUnmarkAsPaid(caucao)).toBe(false);
    const open = await mount({ rental: { status: 'ACTIVE', automaticCharge: false, caucaoAmount: 50_000 }, charges: [caucao] });
    expect(cmp(open.fixture).canUnmarkAsPaid(caucao)).toBe(true);
  });

  it('L1 — aluguel encerrado não oferece "Gerar de novo"', async () => {
    const { fixture } = await mount({
      rental: { status: 'CANCELED' },
      charges: [charge({ id: 'f', status: 'FAILED', externalId: null, checkoutUrl: null, dueDate: '2099-12-07' })],
    });
    expect(anyMenuItemWithText(fixture, 'Gerar de novo')).toBe(false);
  });
  // ------------------------------------------------------- reteste de 23/11 (N7, N20, N21)
  it('N7 — o mínimo vem de `createdDate` (o nome real no JSON), sem passar pelo fuso do navegador', async () => {
    const { fixture } = await mount({
      flex: true,
      rental: { createdAt: undefined as unknown as string, createdDate: '2026-11-23T23:30:00.123' },
      charges: [],
    });
    expect(cmp(fixture).receivedOutsideMinDate()).toBe('2026-11-23');
  });

  it('N21 — caução manual não recebida: "Marcar como paga" só no ⋮ e chip "Pendente"', async () => {
    const { fixture } = await mount({
      rental: { automaticCharge: false, caucaoAmount: 80_000, caucaoPaid: false },
      charges: [],
    });
    const inline = Array.from(el(fixture).querySelectorAll('button')).filter(
      (b) => (b.textContent ?? '').trim() === 'Marcar como paga' && b.getAttribute('role') !== 'menuitem',
    );
    expect(inline, 'nenhum botão na linha').toHaveLength(0);
    expect(el(fixture).textContent).toContain('Pendente');
    expect(el(fixture).textContent).not.toContain('Não gerada');
    expect(menuItem(fixture, 'caucao-menu-mark')).not.toBeNull();
    expect(el(fixture).querySelector('[data-testid="caucao-menu-unmark"]')).toBeNull();
  });

  it('N21 — caução manual recebida por fora: o ⋮ tem só "Desmarcar"', async () => {
    const { fixture } = await mount({
      rental: { automaticCharge: false, caucaoAmount: 80_000, caucaoPaid: true },
      charges: [],
    });
    expect(menuItem(fixture, 'caucao-menu-unmark')).not.toBeNull();
    expect(el(fixture).querySelector('[data-testid="caucao-menu-mark"]')).toBeNull();
  });

  it('N20 — cancelado depois de ativado passa `wasActivated` ao checklist', async () => {
    const started = await mount({ rental: { status: 'CANCELED', activatedAt: '2026-11-09T10:00:00' }, charges: [] });
    expect(cmp(started.fixture).wasActivated()).toBe(true);
    const never = await mount({ rental: { status: 'CANCELED', activatedAt: null }, charges: [] });
    expect(cmp(never.fixture).wasActivated()).toBe(false);
  });
});
