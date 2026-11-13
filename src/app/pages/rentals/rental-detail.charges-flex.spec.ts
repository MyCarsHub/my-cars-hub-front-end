import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../environments/environment';
import { ImpersonationService } from '../../services/impersonation.service';
import type { AgreementDto } from '../../types/agreement.types';
import type { RentalChargeDto, RentalResponseDto } from '../../types/rental.types';
import { RentalDetail } from './rental-detail';

/**
 * FEAT-0573 — Cobranças flexíveis no detalhe do aluguel (jornadas D, E, H). Prova os DOIS
 * estados da chave `CHARGES_FLEX` (vinda do `/auth/me`): sem ela a tela é a de hoje.
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

const OVERDUE_W2 = charge({ id: 'w2', periodIndex: 1, dueDate: '2020-01-13', status: 'PAST_DUE' });
const OVERDUE_W3 = charge({ id: 'w3', periodIndex: 2, dueDate: '2020-01-20', status: 'PAST_DUE' });
const OPEN_W4 = charge({ id: 'w4', periodIndex: 3, dueDate: '2099-12-07' });

function signIn(role: string, features: string[] | null): void {
  const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600 };
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  sessionStorage.setItem('token', `header.${b64}.signature`);
  if (features) sessionStorage.setItem('features', JSON.stringify(features));
}

async function mount(opts: {
  flex: boolean;
  charges: RentalChargeDto[];
  rental?: Partial<RentalResponseDto>;
  agreements?: AgreementDto[];
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
        useValue: { active: () => false, editMode: () => false, readOnly: () => false, reconcile: vi.fn() },
      },
    ],
  });
  const fixture = TestBed.createComponent(RentalDetail);
  const http = TestBed.inject(HttpTestingController);
  await settle(fixture);
  http.expectOne(`${BASE}/${RENTAL_ID}`).flush({ ...RENTAL, ...opts.rental, charges: opts.charges });
  await settle(fixture);
  for (const req of http.match((r) => r.method === 'GET')) {
    if (req.request.url.endsWith('/agreements')) req.flush(opts.agreements ?? []);
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

function byTestId<T extends HTMLElement = HTMLElement>(fixture: ComponentFixture<RentalDetail>, id: string): T | null {
  return el(fixture).querySelector<T>(`[data-testid="${id}"]`);
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function agreement(overrides: Partial<AgreementDto> = {}): AgreementDto {
  return {
    id: 'ag-1',
    seq: 1,
    rentalId: RENTAL_ID,
    status: 'ACTIVE',
    createdAt: '2026-12-02T18:20:00Z',
    createdBy: { userId: 'u-1', name: 'Marina Souza', role: 'MANAGER' },
    reason: 'DRIVER_ASKED_FOR_TIME',
    description: 'Ficou parado na oficina; paga em 4 parcelas.',
    originalTotalCents: 150_000,
    agreedTotalCents: 160_000,
    differenceCents: 10_000,
    sources: [
      { chargeId: 'w2', kind: 'RENTAL_PERIOD', periodIndex: 1, instalmentIndex: 1, instalmentCount: 1, originalStatus: 'PAST_DUE', originalAmountCents: 75_000, originalDueDate: '2020-01-13', fromAgreementId: null, fromAgreementSeq: null },
      { chargeId: 'w3', kind: 'RENTAL_PERIOD', periodIndex: 2, instalmentIndex: 1, instalmentCount: 1, originalStatus: 'PAST_DUE', originalAmountCents: 75_000, originalDueDate: '2020-01-20', fromAgreementId: null, fromAgreementSeq: null },
    ],
    instalments: [1, 2, 3, 4].map((i) =>
      charge({ id: `a${i}`, kind: 'AGREEMENT', amount: 40_000, periodIndex: null, agreementId: 'ag-1', agreementSeq: 1, instalmentIndex: i, instalmentCount: 4, dueDate: `2099-12-0${i}` }),
    ),
    parentAgreementIds: [],
    childAgreementIds: [],
    chargeSync: null,
    ...overrides,
  };
}

describe('RentalDetail — Cobranças flexíveis (FEAT-0573)', () => {
  afterEach(() => sessionStorage.clear());

  describe('sem CHARGES_FLEX a tela é a de hoje', () => {
    it('o ⋮ não oferece Renegociar nem Recebida por fora, e nada de acordo é pedido', async () => {
      const { fixture, http } = await mount({ flex: false, charges: [OVERDUE_W2, OPEN_W4] });

      expect(menuItem(fixture, 'charge-menu-renegotiate')).toBeNull();
      expect(menuItem(fixture, 'charge-menu-received-outside')).toBeNull();
      expect(byTestId(fixture, 'kpi-renegotiated')).toBeNull();
      http.expectNone((r) => r.url.includes('/agreements'));
    });

    it('o rótulo da linha inteira continua "Aluguel — período"', async () => {
      const { fixture } = await mount({ flex: false, charges: [OPEN_W4] });
      expect(el(fixture).textContent).toContain('Aluguel — período');
      expect(el(fixture).textContent).not.toContain('parcela');
    });
  });

  describe('cartões pintados (canvas aprovado, item 1)', () => {
    it('sem a chave: Valor recebido e Próximo recebimento continuam neutros', async () => {
      const { fixture } = await mount({ flex: false, charges: [OPEN_W4] });
      expect(byTestId(fixture, 'kpi-received-painted')).toBeNull();
      expect(byTestId(fixture, 'kpi-next-painted')).toBeNull();
      expect(el(fixture).querySelector('app-painted-card')).toBeNull();
      expect(el(fixture).textContent).toContain('Valor recebido');
    });

    it('com a chave: recebido verde sólido e próximo recebimento laranja sólido, texto branco', async () => {
      const { fixture } = await mount({ flex: true, charges: [OPEN_W4] });
      const received = byTestId(fixture, 'kpi-received-painted')!;
      const next = byTestId(fixture, 'kpi-next-painted')!;
      expect(received.getAttribute('data-tone')).toBe('green');
      expect(received.className).toContain('text-white');
      expect(next.getAttribute('data-tone')).toBe('orange');
      expect(next.className).toContain('bg-primary-500');
      expect(next.textContent).toContain('750,00');
    });
  });

  describe('com CHARGES_FLEX', () => {
    it('o ⋮ de uma semana atrasada oferece Renegociar e Recebida por fora (aluguel automático)', async () => {
      const { fixture } = await mount({ flex: true, charges: [OVERDUE_W2] });

      expect(menuItem(fixture, 'charge-menu-renegotiate')?.textContent).toContain('Renegociar');
      expect(menuItem(fixture, 'charge-menu-received-outside')?.textContent).toContain('Recebida por fora');
    });

    it('H2 — aluguel manual: Marcar como paga e Renegociar, sem Recebida por fora', async () => {
      const manualCharge = charge({ id: 'w2', periodIndex: 1, externalId: null, checkoutUrl: null, dueDate: '2020-01-13' });
      const { fixture } = await mount({ flex: true, charges: [manualCharge], rental: { automaticCharge: false } });

      expect(menuItem(fixture, 'charge-menu-renegotiate')).not.toBeNull();
      expect(menuItem(fixture, 'charge-menu-received-outside')).toBeNull();
      expect(el(fixture).textContent).toContain('Marcar como paga');
    });

    it('aluguel cancelado não oferece Renegociar', async () => {
      const { fixture } = await mount({ flex: true, charges: [OVERDUE_W2], rental: { status: 'CANCELED' } });
      expect(menuItem(fixture, 'charge-menu-renegotiate')).toBeNull();
    });

    it('D6 — renegociadas: chip azul "Renegociada", cartão Renegociado, parcelas "Acordo, parcela i de 4" e o vínculo', async () => {
      const ag = agreement();
      const w2 = { ...OVERDUE_W2, status: 'RENEGOTIATED' as const, renegotiatedInAgreementId: 'ag-1', renegotiatedInAgreementSeq: 1 };
      const w3 = { ...OVERDUE_W3, status: 'RENEGOTIATED' as const, renegotiatedInAgreementId: 'ag-1', renegotiatedInAgreementSeq: 1 };
      const { fixture } = await mount({ flex: true, charges: [w2, w3, OPEN_W4, ...ag.instalments], agreements: [ag] });

      const text = el(fixture).textContent ?? '';
      expect(text).toContain('Renegociada');
      expect(text).toContain('Acordo, parcela 1 de 4');
      expect(byTestId(fixture, 'kpi-renegotiated')?.textContent).toContain('1.500,00');
      expect(byTestId(fixture, 'charge-agreement-link')?.textContent).toContain('Acordo de 02/12');
      // Progresso conta só os períodos: as 4 parcelas do acordo ficam fora.
      expect(text).toContain('0 / 3 períodos');
      // Ver acordo é o único item do ⋮ da renegociada.
      expect(menuItem(fixture, 'charge-menu-view-agreement')).not.toBeNull();
    });

    it('D7 — "Ver acordo" abre a folha com quem fez, motivo, descrição e o que mudou', async () => {
      const ag = agreement();
      const w2 = { ...OVERDUE_W2, status: 'RENEGOTIATED' as const, renegotiatedInAgreementId: 'ag-1' };
      const { fixture } = await mount({ flex: true, charges: [w2, ...ag.instalments], agreements: [ag] });

      byTestId<HTMLButtonElement>(fixture, 'charge-agreement-link')!.click();
      await settle(fixture);

      const sheet = byTestId(fixture, 'agreement-sheet')!;
      expect(sheet.textContent).toContain('Marina Souza, gerente');
      expect(sheet.textContent).toContain('Pediu prazo');
      expect(sheet.textContent).toContain('Ficou parado na oficina');
      expect(byTestId(fixture, 'agreement-sources')?.textContent).toContain('Semana 2 e Semana 3');
      expect(byTestId(fixture, 'agreement-instalments')?.textContent).toContain('4 parcelas de R$ 400,00');
      expect(sheet.textContent).toContain('R$ 12,50 em cada parcela');
    });

    it('H — acordo que precisa de atenção mostra o aviso', async () => {
      const ag = agreement({ status: 'NEEDS_ATTENTION' });
      const w2 = { ...OVERDUE_W2, status: 'RENEGOTIATED' as const, renegotiatedInAgreementId: 'ag-1' };
      const { fixture } = await mount({ flex: true, charges: [w2], agreements: [ag] });

      byTestId<HTMLButtonElement>(fixture, 'charge-agreement-link')!.click();
      await settle(fixture);
      expect(byTestId(fixture, 'agreement-needs-attention')).not.toBeNull();
    });

    it('D — renegociar duas semanas: 4 passos, prévia e POST com Idempotency-Key', async () => {
      const { fixture, http } = await mount({ flex: true, charges: [OVERDUE_W2, OVERDUE_W3, OPEN_W4] });

      menuItem(fixture, 'charge-menu-renegotiate')!.click();
      await settle(fixture);
      expect(byTestId(fixture, 'renegotiate-step-label')?.textContent).toContain('Passo 1 de 4');

      // Passo 1: a Semana 2 já vem marcada; marca a Semana 3.
      const w3 = byTestId(fixture, 'renegotiate-option-w3')!.querySelector('input')!;
      w3.click();
      await settle(fixture);
      expect(byTestId(fixture, 'renegotiate-original-total')?.textContent).toContain('1.500,00');
      byTestId<HTMLButtonElement>(fixture, 'renegotiate-next')!.click();
      await settle(fixture);

      // Passo 2: valor mascarado (TEXTO), 4 parcelas semanais.
      typeInto(byTestId<HTMLInputElement>(fixture, 'renegotiate-amount')!, '1.600,00');
      await settle(fixture);
      expect(byTestId<HTMLInputElement>(fixture, 'renegotiate-amount')!.value).toBe('1.600,00');
      expect(byTestId(fixture, 'renegotiate-difference')?.textContent).toContain('+ R$ 100,00');
      const count = byTestId<HTMLInputElement>(fixture, 'renegotiate-count')!;
      count.value = '4';
      count.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(byTestId(fixture, 'renegotiate-instalments')?.querySelectorAll('li').length).toBe(4);
      expect(byTestId(fixture, 'renegotiate-instalments')?.textContent).toContain('multa R$ 12,50');
      byTestId<HTMLButtonElement>(fixture, 'renegotiate-next')!.click();
      await settle(fixture);

      // Passo 3: motivo e descrição são obrigatórios.
      expect(byTestId<HTMLButtonElement>(fixture, 'renegotiate-next')!.disabled).toBe(true);
      (el(fixture).querySelector('[data-testid="reason-DRIVER_ASKED_FOR_TIME"] input') as HTMLInputElement).click();
      typeInto(byTestId<HTMLTextAreaElement>(fixture, 'renegotiate-description')!, 'Paga em 4 vezes, toda quarta.');
      await settle(fixture);
      byTestId<HTMLButtonElement>(fixture, 'renegotiate-next')!.click();
      await settle(fixture);

      // Passo 4: prévia do backend.
      const preview = http.expectOne(`${BASE}/${RENTAL_ID}/agreements/preview`);
      expect(preview.request.body).toMatchObject({
        sourceChargeIds: ['w2', 'w3'],
        reason: 'DRIVER_ASKED_FOR_TIME',
        description: 'Paga em 4 vezes, toda quarta.',
        agreedTotalCents: 160_000,
      });
      expect(preview.request.body.instalments).toHaveLength(4);
      expect(preview.request.body.instalments.map((i: { amountCents: number }) => i.amountCents)).toEqual([40_000, 40_000, 40_000, 40_000]);
      preview.flush({
        sources: [],
        originalTotalCents: 150_000,
        agreedTotalCents: 160_000,
        differenceCents: 10_000,
        instalments: preview.request.body.instalments.map((i: { dueDate: string; amountCents: number }, k: number) => ({
          instalmentIndex: k + 1, instalmentCount: 4, dueDate: i.dueDate, amountCents: i.amountCents, fineFixedCents: 1_250, destination: 'ASAAS',
        })),
        lastDueDate: preview.request.body.instalments[3].dueDate,
        blocker: null,
      });
      await settle(fixture);
      expect(byTestId(fixture, 'renegotiate-total')?.textContent).toContain('1.600,00');
      expect(byTestId(fixture, 'renegotiate-sheet')?.textContent).not.toContain('Asaas');

      byTestId<HTMLButtonElement>(fixture, 'renegotiate-confirm')!.click();
      await settle(fixture);
      const create = http.expectOne((r) => r.method === 'POST' && r.url === `${BASE}/${RENTAL_ID}/agreements`);
      expect(create.request.headers.get('Idempotency-Key')).toBeTruthy();
      expect(create.request.body.sourceChargeIds).toEqual(['w2', 'w3']);
      create.flush(agreement());
      await settle(fixture);

      // Recarrega o aluguel depois do acordo.
      http.expectOne(`${BASE}/${RENTAL_ID}`).flush({ ...RENTAL, charges: [OPEN_W4] });
    });

    it('D — recusa por cobrança já paga volta ao passo 1 e recarrega o aluguel', async () => {
      const { fixture, http } = await mount({ flex: true, charges: [OVERDUE_W2] });
      menuItem(fixture, 'charge-menu-renegotiate')!.click();
      await settle(fixture);
      byTestId<HTMLButtonElement>(fixture, 'renegotiate-next')!.click();
      await settle(fixture);
      typeInto(byTestId<HTMLInputElement>(fixture, 'renegotiate-amount')!, '750,00');
      await settle(fixture);
      byTestId<HTMLButtonElement>(fixture, 'renegotiate-next')!.click();
      await settle(fixture);
      (el(fixture).querySelector('[data-testid="reason-OTHER"] input') as HTMLInputElement).click();
      typeInto(byTestId<HTMLTextAreaElement>(fixture, 'renegotiate-description')!, 'Combinado no balcão.');
      await settle(fixture);
      byTestId<HTMLButtonElement>(fixture, 'renegotiate-next')!.click();
      await settle(fixture);
      http.expectOne(`${BASE}/${RENTAL_ID}/agreements/preview`).flush({
        sources: [], originalTotalCents: 75_000, agreedTotalCents: 75_000, differenceCents: 0,
        instalments: [], lastDueDate: null, blocker: null,
      });
      await settle(fixture);
      byTestId<HTMLButtonElement>(fixture, 'renegotiate-confirm')!.click();
      await settle(fixture);
      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/agreements'))
        .flush({ message: 'A cobrança de 13/01 já foi paga no Asaas.', code: 'AGREEMENT_SOURCE_ALREADY_PAID' }, { status: 409, statusText: 'Conflict' });
      await settle(fixture);

      expect(byTestId(fixture, 'renegotiate-error')?.textContent).toContain('Uma das cobranças já foi paga');
      expect(byTestId(fixture, 'renegotiate-error')?.textContent).not.toContain('Asaas');
      expect(byTestId(fixture, 'renegotiate-step-label')?.textContent).toContain('Passo 1 de 4');
      http.expectOne(`${BASE}/${RENTAL_ID}`).flush({ ...RENTAL, charges: [{ ...OVERDUE_W2, status: 'PAID' }] });
    });

    it('E — recebida por fora: folha, confirmação e POST com data e motivo; a linha fica Paga + Recebida por fora', async () => {
      const { fixture, http } = await mount({ flex: true, charges: [OVERDUE_W2] });

      menuItem(fixture, 'charge-menu-received-outside')!.click();
      await settle(fixture);
      expect(byTestId<HTMLInputElement>(fixture, 'received-outside-value')!.value).toContain('750,00');
      expect(byTestId<HTMLButtonElement>(fixture, 'received-outside-submit')!.disabled).toBe(true);
      (el(fixture).querySelector('[data-testid="reason-CASH"] input') as HTMLInputElement).click();
      await settle(fixture);

      vi.useFakeTimers();
      byTestId<HTMLButtonElement>(fixture, 'received-outside-submit')!.click();
      vi.advanceTimersByTime(250);
      vi.useRealTimers();
      await settle(fixture);

      // Diálogo de confirmação: "Não dá para desfazer".
      expect(el(fixture).textContent).toContain('Registrar como recebida por fora?');
      expect(el(fixture).textContent).toContain('Dinheiro. Não dá para desfazer.');
      const confirm = Array.from(el(fixture).querySelectorAll('[role="dialog"] button')).find(
        (b) => b.textContent?.trim() === 'Registrar',
      ) as HTMLButtonElement;
      confirm.click();
      await settle(fixture);

      const req = http.expectOne(`${BASE}/${RENTAL_ID}/charges/w2/received-outside`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body.reason).toBe('CASH');
      expect(req.request.body.note).toBeNull();
      expect(req.request.body.receivedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      req.flush({
        ...OVERDUE_W2,
        status: 'PAID',
        paidAt: '2026-12-10T12:00:00',
        receivedOutside: true,
        receivedOutsideOn: '2026-12-10',
        settledBy: { userId: 'u-1', name: 'Marina Souza' },
      });
      await settle(fixture);

      expect(byTestId(fixture, 'charge-received-outside-tag')).not.toBeNull();
      expect(byTestId(fixture, 'charge-settled-by')?.textContent).toContain('Registrada por Marina Souza');
    });

    it('B/C — linha com desconto mostra o valor cheio riscado; parcela do período ganha o rótulo', async () => {
      const discounted = charge({ id: 'w1', periodIndex: 0, amount: 65_000, discountCents: 10_000, originalAmountCents: 75_000 });
      const part = charge({ id: 'w2a', periodIndex: 1, amount: 25_000, instalmentIndex: 1, instalmentCount: 3 });
      const { fixture } = await mount({ flex: true, charges: [discounted, part] });

      expect(byTestId(fixture, 'charge-original-amount')?.textContent).toContain('750,00');
      expect(el(fixture).textContent).toContain('Semana 2, parcela 1 de 3');
    });

    it('C6 — caução dividida lista cada parte no cartão Caução', async () => {
      const p1 = charge({ id: 'k1', kind: 'CAUCAO', amount: 130_000, periodIndex: null, instalmentIndex: 1, instalmentCount: 2, dueDate: '2099-11-16' });
      const p2 = charge({ id: 'k2', kind: 'CAUCAO', amount: 20_000, periodIndex: null, instalmentIndex: 2, instalmentCount: 2, dueDate: '2099-11-21' });
      const { fixture } = await mount({ flex: true, charges: [p1, p2], rental: { caucaoAmount: 150_000 } });

      const text = el(fixture).textContent ?? '';
      expect(text).toContain('Caução, parte 1 de 2');
      expect(text).toContain('Caução, parte 2 de 2');
    });
  });
});
