import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../environments/environment';
import { ImpersonationService } from '../../services/impersonation.service';
import type { RentalResponseDto } from '../../types/rental.types';
import type { RenewalPreviewDto } from '../../types/rental-renewal.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import { addDaysIso } from './charges-flex/charges-flex';
import { RentalDetail } from './rental-detail';

/**
 * V151 — renovação no detalhe do aluguel (pranchas RenR1–R6 / RenD1). Só com `CHARGES_FLEX`,
 * aluguel ATIVO e quem opera; a folha pede a prévia ao servidor (com espera) e o envio leva o
 * `expectedEndDate` que a tela mostrou.
 */

const BASE = `${environment.apiUrl}/rentals`;
const RENTAL_ID = 'r-1';
const TODAY = todayInBusinessTz();
const END_IN_7 = addDaysIso(TODAY, 7);

const RENTAL: RentalResponseDto = {
  id: RENTAL_ID,
  vehicleId: 'v-1',
  driverId: 'd-1',
  startDate: addDaysIso(TODAY, -21),
  endDate: END_IN_7,
  periodRate: 60_000,
  totalAmount: 240_000,
  caucaoAmount: 120_000,
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
  createdAt: '2026-11-01T00:00:00Z',
  modifiedAt: '2026-11-01T00:00:00Z',
  minimumTermDays: 28,
  renewalCount: 0,
};

function preview(overrides: Partial<RenewalPreviewDto> = {}): RenewalPreviewDto {
  const periods = [0, 1, 2, 3].map((k) => ({
    index: 4 + k,
    startDate: addDaysIso(END_IN_7, 7 * k),
    endDate: addDaysIso(END_IN_7, 7 * k + 6),
    dueDate: addDaysIso(END_IN_7, 7 * k),
    amountCents: 60_000,
    destination: 'ASAAS' as const,
  }));
  return {
    previousEndDate: END_IN_7,
    newEndDate: addDaysIso(END_IN_7, 28),
    additionalDays: 28,
    periodRate: 60_000,
    periods,
    addedTotalCents: 240_000,
    newTotalAmount: 480_000,
    gatewayCount: 4,
    localCount: 0,
    overdueCount: 0,
    blocker: null,
    ...overrides,
  };
}

const route = {
  snapshot: {
    paramMap: { get: (k: string) => (k === 'id' ? RENTAL_ID : null) },
    queryParamMap: { get: () => null },
  },
};

function signIn(role: string, features: string[]): void {
  const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600 };
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  sessionStorage.setItem('token', `header.${b64}.signature`);
  sessionStorage.setItem('features', JSON.stringify(features));
}

interface Mounted {
  fixture: ComponentFixture<RentalDetail>;
  http: HttpTestingController;
}

async function settle(fixture: ComponentFixture<RentalDetail>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

/**
 * Relógio falso só durante `act` + o avanço: a espera da prévia (300 ms) e a saída da folha
 * (200 ms) andam sem esperar de verdade. Dois avanços cobrem uma cadeia (prévia → efeito →
 * nova espera). O relógio real volta antes do `whenStable`.
 */
async function run(f: ComponentFixture<RentalDetail>, act: () => void = () => void 0, ms = 400): Promise<void> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  try {
    act();
    f.detectChanges();
    vi.advanceTimersByTime(ms);
    f.detectChanges();
    vi.advanceTimersByTime(ms);
  } finally {
    vi.useRealTimers();
  }
  await settle(f);
}

async function mount(opts: { flex?: boolean; role?: string; rental?: Partial<RentalResponseDto> } = {}): Promise<Mounted> {
  TestBed.resetTestingModule();
  sessionStorage.clear();
  signIn(opts.role ?? 'OWNER', opts.flex === false ? [] : ['CHARGES_FLEX']);
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
  http.expectOne(`${BASE}/${RENTAL_ID}`).flush({ ...RENTAL, ...opts.rental });
  await settle(fixture);
  flushGets(http);
  await settle(fixture);
  return { fixture, http };
}

function flushGets(http: HttpTestingController): void {
  for (const req of http.match((r) => r.method === 'GET' && r.url !== `${BASE}/${RENTAL_ID}`)) {
    req.flush(req.request.url.includes('signature') ? null : []);
  }
}

function byId<T extends HTMLElement = HTMLElement>(f: ComponentFixture<RentalDetail>, id: string): T | null {
  return (f.nativeElement as HTMLElement).querySelector<T>(`[data-testid="${id}"]`);
}

function previewReqs(http: HttpTestingController): TestRequest[] {
  return http.match((r) => r.url === `${BASE}/${RENTAL_ID}/renew-preview`);
}

function renewReqs(http: HttpTestingController): TestRequest[] {
  return http.match((r) => r.url === `${BASE}/${RENTAL_ID}/renew`);
}

/** Abre a folha e responde a prévia inicial (depois da espera). */
async function openSheet(m: Mounted, body: RenewalPreviewDto = preview()): Promise<TestRequest> {
  await run(m.fixture, () => byId<HTMLButtonElement>(m.fixture, 'renew-open')!.click());
  const reqs = previewReqs(m.http);
  expect(reqs).toHaveLength(1);
  reqs[0].flush(body);
  await settle(m.fixture);
  return reqs[0];
}

function typeAmount(m: Mounted, value: string): void {
  const amount = byId<HTMLInputElement>(m.fixture, 'renew-amount')!;
  amount.value = value;
  amount.dispatchEvent(new Event('input'));
}

function conflict(code: string, extra: Record<string, unknown> = {}): [object, { status: number; statusText: string }] {
  return [{ code, message: code, ...extra }, { status: 409, statusText: 'Conflict' }];
}

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
  TestBed.resetTestingModule();
});

describe('RentalDetail — renovação (V151)', () => {
  describe('quem vê', () => {
    it('sem CHARGES_FLEX: nem aviso, nem botão, nem as linhas novas do Período', async () => {
      const { fixture } = await mount({ flex: false });
      expect(byId(fixture, 'renew-open')).toBeNull();
      expect(byId(fixture, 'rental-end-notice')).toBeNull();
      expect(byId(fixture, 'period-minimum')).toBeNull();
      expect(byId(fixture, 'period-renewals')).toBeNull();
    });

    it('aluguel que não está ativo: sem botão e sem aviso', async () => {
      for (const status of ['RESERVED', 'COMPLETED', 'CANCELED'] as const) {
        const { fixture } = await mount({ rental: { status } });
        expect(byId(fixture, 'renew-open')).toBeNull();
        expect(byId(fixture, 'rental-end-notice')).toBeNull();
      }
    });

    it('motorista: sem botão de renovar', async () => {
      const { fixture } = await mount({ role: 'DRIVER' });
      expect(byId(fixture, 'renew-open')).toBeNull();
    });
  });

  describe('RenR1 · o detalhe', () => {
    it('aviso laranja "Termina em 7 dias", "Tempo mínimo" e "Renovações" no Período, e o botão', async () => {
      const { fixture } = await mount();
      const notice = byId(fixture, 'rental-end-notice')!;
      expect(notice.getAttribute('data-tone')).toBe('orange');
      expect(byId(fixture, 'rental-end-notice-title')!.textContent).toContain('Termina em 7 dias, em ');
      expect(notice.textContent).toContain('Renove para continuar cobrando, ou encerre quando ele devolver o carro.');
      expect(byId(fixture, 'period-minimum')!.textContent).toContain('4 semanas');
      expect(byId(fixture, 'period-renewals')!.textContent).toContain('Nenhuma');
      expect(byId(fixture, 'renew-open')!.textContent?.trim()).toBe('Renovar aluguel');
    });

    it('fim longe: sem aviso (o botão continua)', async () => {
      const { fixture } = await mount({ rental: { endDate: addDaysIso(TODAY, 30) } });
      expect(byId(fixture, 'rental-end-notice')).toBeNull();
      expect(byId(fixture, 'renew-open')).not.toBeNull();
    });

    it('fim que passou e ele continua ativo: o aviso diz que passou', async () => {
      const past = addDaysIso(TODAY, -2);
      const { fixture } = await mount({ rental: { endDate: past } });
      expect(byId(fixture, 'rental-end-notice-title')!.textContent).toMatch(/^Terminou em .+ e continua ativo$/);
    });

    it('aluguel de data fixa: sem "Tempo mínimo"', async () => {
      const { fixture } = await mount({ rental: { minimumTermDays: null } });
      expect(byId(fixture, 'period-minimum')).toBeNull();
      expect(byId(fixture, 'period-renewals')).not.toBeNull();
    });
  });

  describe('RenR2–R6 · a folha', () => {
    it('preenche 4 semanas e o valor de hoje; a prévia do servidor vira o total laranja e o "Novo fim"', async () => {
      const m = await mount();
      // O "Novo fim" do servidor (períodos inteiros depois do último cobrado) vence a conta local.
      const serverEnd = addDaysIso(END_IN_7, 29);
      const req = await openSheet(m, preview({ newEndDate: serverEnd }));
      expect(req.request.body).toEqual({
        additionalAmount: 4,
        unit: 'WEEKS',
        periodRate: 60_000,
        expectedEndDate: END_IN_7,
      });
      expect(byId<HTMLInputElement>(m.fixture, 'renew-amount')!.value).toBe('4');
      expect(byId<HTMLInputElement>(m.fixture, 'renew-rate')!.value).toBe('600,00');
      const br = `${serverEnd.slice(8, 10)}/${serverEnd.slice(5, 7)}/${serverEnd.slice(0, 4)}`;
      expect(byId(m.fixture, 'renew-new-end')!.textContent).toContain(`Novo fim: ${br}`);
      expect(byId(m.fixture, 'renew-new-end')!.textContent).toContain('(4 semanas depois de');
      expect(byId(m.fixture, 'renew-total')!.textContent).toContain('R$ 2.400,00');
      expect(byId(m.fixture, 'renew-total')!.textContent).toContain('4 cobranças novas');
      expect(byId(m.fixture, 'renew-see-charges')!.textContent?.trim()).toBe('Ver as 4 cobranças');
      expect(byId(m.fixture, 'renew-say')!.textContent).toContain('vão para a sua conta Asaas agora');
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(false);
      // Digitou "550" e saiu do campo: vira "550,00", como o valor de hoje.
      const rateInput = byId<HTMLInputElement>(m.fixture, 'renew-rate')!;
      rateInput.value = '550';
      rateInput.dispatchEvent(new Event('input'));
      rateInput.dispatchEvent(new Event('blur'));
      m.fixture.detectChanges();
      expect(rateInput.value).toBe('550,00');
    });

    it('semanal só oferece semanas; mensal só meses; diário as três', async () => {
      let m = await mount();
      await openSheet(m);
      const options = (id: string): string[] =>
        Array.from(byId<HTMLSelectElement>(m.fixture, id)!.options).map((o) => o.value);
      expect(options('renew-unit')).toEqual(['WEEKS']);
      m = await mount({ rental: { billingFrequency: 'MONTHLY', minimumTermDays: 90 } });
      const monthly = await openSheet(m);
      expect(options('renew-unit')).toEqual(['MONTHS']);
      expect(monthly.request.body.additionalAmount).toBe(3);
      m = await mount({ rental: { billingFrequency: 'DAILY', minimumTermDays: null } });
      await openSheet(m);
      expect(options('renew-unit')).toEqual(['DAYS', 'WEEKS', 'MONTHS']);
    });

    it('sem prévia nova, sem "Novo fim" (nunca da conta local)', async () => {
      const m = await mount();
      await openSheet(m);
      let shownBeforePreview: HTMLElement | null = null;
      await run(m.fixture, () => {
        typeAmount(m, '2');
        m.fixture.detectChanges();
        shownBeforePreview = byId(m.fixture, 'renew-new-end');
      });
      expect(shownBeforePreview).toBeNull();
      previewReqs(m.http)[0].flush(
        preview({ periods: preview().periods.slice(0, 2), addedTotalCents: 120_000, newEndDate: addDaysIso(END_IN_7, 15) }),
      );
      await settle(m.fixture);
      expect(byId(m.fixture, 'renew-new-end')!.textContent).toContain('(2 semanas depois de');
    });

    it('digitar pede UMA prévia, depois da espera; o botão espera a prévia do corpo novo', async () => {
      const m = await mount();
      await openSheet(m);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      for (const v of ['1', '12', '2']) {
        typeAmount(m, v);
        m.fixture.detectChanges();
        vi.advanceTimersByTime(100);
      }
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(true);
      expect(previewReqs(m.http)).toHaveLength(0);
      vi.advanceTimersByTime(300);
      vi.useRealTimers();
      const reqs = previewReqs(m.http);
      expect(reqs).toHaveLength(1);
      expect(reqs[0].request.body.additionalAmount).toBe(2);
      reqs[0].flush(preview({ periods: preview().periods.slice(0, 2), addedTotalCents: 120_000 }));
      await settle(m.fixture);
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(false);
    });

    it('uma cobrança só: "Ver a cobrança" e "1 cobrança nova"', async () => {
      const m = await mount();
      await openSheet(m, preview({ periods: preview().periods.slice(0, 1), addedTotalCents: 60_000, gatewayCount: 1 }));
      expect(byId(m.fixture, 'renew-see-charges')!.textContent?.trim()).toBe('Ver a cobrança');
      expect(byId(m.fixture, 'renew-total')!.textContent).toContain('1 cobrança nova, em');
      expect(byId(m.fixture, 'renew-say')!.textContent).toContain('a 1 cobrança vai para a sua conta Asaas');
    });

    it('quantidade inválida: erro no campo e nenhuma prévia', async () => {
      const m = await mount();
      await openSheet(m);
      await run(m.fixture, () => typeAmount(m, '0'));
      expect(previewReqs(m.http)).toHaveLength(0);
      expect(m.fixture.nativeElement.textContent).toContain('Informe ao menos 1.');
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(true);
    });

    it('acessibilidade: campos obrigatórios marcados e o total anunciado quando a prévia chega', async () => {
      const m = await mount();
      await openSheet(m);
      for (const id of ['renew-amount', 'renew-unit', 'renew-rate']) {
        expect(byId(m.fixture, id)!.getAttribute('aria-required')).toBe('true');
      }
      const live = byId(m.fixture, 'renew-live')!;
      expect(live.getAttribute('aria-live')).toBe('polite');
      expect(live.textContent).toContain('Renovação: R$ 2.400,00.');
    });

    it('RenR4 · cobrança atrasada: o aviso, e renova do mesmo jeito', async () => {
      const m = await mount();
      await openSheet(m, preview({ overdueCount: 1 }));
      expect(byId(m.fixture, 'renew-overdue')!.textContent).toContain(
        'Ele tem 1 cobrança atrasada. Ela continua como está. A renovação só cria as novas.',
      );
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(false);
    });

    it('RenR5 · "Renovar até" ajusta a quantidade, espera a prévia ajustada e RENOVA (uma vez só)', async () => {
      const m = await mount();
      const max = addDaysIso(END_IN_7, 14);
      await openSheet(m, preview({ blocker: { code: 'VEHICLE_PERIOD_TAKEN', message: 'ocupado', maxEndDate: max } }));
      expect(byId(m.fixture, 'renew-taken')!.textContent).toContain('(2 semanas)');
      expect(byId(m.fixture, 'renew-submit')).toBeNull();
      expect(byId(m.fixture, 'renew-total')).toBeNull();
      const fit = byId<HTMLButtonElement>(m.fixture, 'renew-fit')!;
      expect(fit.textContent?.trim()).toBe(`Renovar até ${max.slice(8, 10)}/${max.slice(5, 7)}`);
      await run(m.fixture, () => {
        fit.click();
        fit.click();
      });
      const reqs = previewReqs(m.http);
      expect(reqs).toHaveLength(1);
      expect(reqs[0].request.body.additionalAmount).toBe(2);
      expect(renewReqs(m.http)).toHaveLength(0);
      reqs[0].flush(preview({ periods: preview().periods.slice(0, 2), addedTotalCents: 120_000, newEndDate: max }));
      await settle(m.fixture);
      const renews = renewReqs(m.http);
      expect(renews).toHaveLength(1);
      expect(renews[0].request.body).toEqual({ additionalAmount: 2, unit: 'WEEKS', periodRate: 60_000, expectedEndDate: END_IN_7 });
      await run(m.fixture, () =>
        renews[0].flush({ ...RENTAL, endDate: max, renewalCount: 1, chargeSync: { requested: 2, created: 2, failed: 0, local: 0 } }),
      );
      flushGets(m.http);
      expect(byId(m.fixture, 'renew-sheet')).toBeNull();
      expect(byId(m.fixture, 'rental-end-notice')!.getAttribute('data-tone')).toBe('green');
    });

    it('RenR5 · o palpite não coube: tira um período e pede de novo antes de renovar', async () => {
      const m = await mount();
      const max = addDaysIso(END_IN_7, 14);
      const taken = { code: 'VEHICLE_PERIOD_TAKEN', message: 'ocupado', maxEndDate: max };
      await openSheet(m, preview({ blocker: taken }));
      await run(m.fixture, () => byId<HTMLButtonElement>(m.fixture, 'renew-fit')!.click());
      previewReqs(m.http)[0].flush(preview({ blocker: taken }));
      await run(m.fixture);
      const again = previewReqs(m.http);
      expect(again).toHaveLength(1);
      expect(again[0].request.body.additionalAmount).toBe(1);
      expect(renewReqs(m.http)).toHaveLength(0);
    });

    it('carro ocupado sem maxEndDate: a frase do servidor explica o bloqueio', async () => {
      const m = await mount();
      await openSheet(m, preview({ blocker: { code: 'VEHICLE_PERIOD_TAKEN', message: 'O carro tem outra reserva nesse período.', maxEndDate: null } }));
      expect(byId(m.fixture, 'renew-blocker')!.textContent).toContain('O carro tem outra reserva nesse período.');
      expect(byId(m.fixture, 'renew-total')).toBeNull();
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(true);
    });

    it('outro bloqueio da prévia: a mensagem e o botão desabilitado', async () => {
      const m = await mount();
      await openSheet(m, preview({ blocker: { code: 'RENEWAL_END_IN_PAST', message: 'O novo fim fica antes de hoje.', maxEndDate: null } }));
      expect(byId(m.fixture, 'renew-blocker')!.textContent).toContain('O novo fim fica antes de hoje.');
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(true);
    });

    it('prévia com 400 RENEWAL_UNIT_MISALIGNED: mostra a frase do servidor', async () => {
      const m = await mount();
      await run(m.fixture, () => byId<HTMLButtonElement>(m.fixture, 'renew-open')!.click());
      previewReqs(m.http)[0].flush(
        { code: 'RENEWAL_UNIT_MISALIGNED', message: 'Renove em semanas inteiras.' },
        { status: 400, statusText: 'Bad Request' },
      );
      await settle(m.fixture);
      expect(byId(m.fixture, 'renew-preview-failed')!.textContent).toContain('Renove em semanas inteiras.');
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(true);
    });

    it('prévia que falhou: aviso genérico e "Tentar de novo"', async () => {
      const m = await mount();
      await run(m.fixture, () => byId<HTMLButtonElement>(m.fixture, 'renew-open')!.click());
      previewReqs(m.http)[0].flush({ message: 'x' }, { status: 500, statusText: 'err' });
      await settle(m.fixture);
      expect(byId(m.fixture, 'renew-preview-failed')!.textContent).toContain('Não deu para calcular a renovação.');
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(true);
    });

    it('prévia com RENEWAL_STALE: relê o aluguel por trás e pede a prévia com o fim novo, sem recarregar', async () => {
      const m = await mount();
      await openSheet(m, preview({ blocker: { code: 'RENEWAL_STALE', message: 'mudou', maxEndDate: null } }));
      const newer = addDaysIso(END_IN_7, 28);
      m.http.expectOne(`${BASE}/${RENTAL_ID}`).flush({ ...RENTAL, endDate: newer, renewalCount: 1 });
      await run(m.fixture);
      const reqs = previewReqs(m.http);
      expect(reqs).toHaveLength(1);
      expect(reqs[0].request.body.expectedEndDate).toBe(newer);
      reqs[0].flush(preview({ previousEndDate: newer }));
      await settle(m.fixture);
      expect(byId(m.fixture, 'period-renewals')!.textContent).toContain('1');
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(false);
      m.http.expectNone(`${BASE}/${RENTAL_ID}`);
    });

    it('renova com o expectedEndDate; dois toques mandam UM pedido; depois, o aviso verde (RenR6)', async () => {
      const m = await mount();
      await openSheet(m);
      const submit = byId<HTMLButtonElement>(m.fixture, 'renew-submit')!;
      submit.click();
      submit.click();
      await settle(m.fixture);
      const renews = renewReqs(m.http);
      expect(renews).toHaveLength(1);
      expect(renews[0].request.body).toEqual({
        additionalAmount: 4,
        unit: 'WEEKS',
        periodRate: 60_000,
        expectedEndDate: END_IN_7,
      });
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(true);
      const newEnd = addDaysIso(END_IN_7, 28);
      await run(m.fixture, () =>
        renews[0].flush({ ...RENTAL, endDate: newEnd, renewalCount: 1, chargeSync: { requested: 4, created: 4, failed: 0, local: 0 } }),
      );
      flushGets(m.http);
      expect(byId(m.fixture, 'renew-sheet')).toBeNull();
      const notice = byId(m.fixture, 'rental-end-notice')!;
      expect(notice.getAttribute('data-tone')).toBe('green');
      expect(notice.textContent).toContain(
        `Aluguel renovado até ${newEnd.slice(8, 10)}/${newEnd.slice(5, 7)}/${newEnd.slice(0, 4)}`,
      );
      expect(notice.textContent).toContain('4 cobranças novas na sua conta Asaas.');
      expect(byId(m.fixture, 'period-renewals')!.textContent).toContain('1');
    });

    it('falha parcial no Asaas: renovado em laranja, com quantas a gente tenta de novo (sem verde)', async () => {
      const m = await mount();
      await openSheet(m);
      byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.click();
      await settle(m.fixture);
      await run(m.fixture, () =>
        renewReqs(m.http)[0].flush({
          ...RENTAL,
          endDate: addDaysIso(END_IN_7, 28),
          renewalCount: 1,
          chargeSync: { requested: 4, created: 3, failed: 1, local: 0 },
        }),
      );
      flushGets(m.http);
      const notice = byId(m.fixture, 'rental-end-notice')!;
      expect(notice.getAttribute('data-tone')).toBe('orange');
      expect(notice.textContent).toContain('Aluguel renovado até');
      expect(notice.textContent).toContain('1 cobrança não foi para a sua conta Asaas. A gente tenta de novo sozinho.');
    });

    it('resposta sem chargeSync numa renovação que ia ao Asaas: não diz que deu certo', async () => {
      const m = await mount();
      await openSheet(m);
      byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.click();
      await settle(m.fixture);
      await run(m.fixture, () =>
        renewReqs(m.http)[0].flush({ ...RENTAL, endDate: addDaysIso(END_IN_7, 28), renewalCount: 1 }),
      );
      flushGets(m.http);
      const notice = byId(m.fixture, 'rental-end-notice')!;
      expect(notice.getAttribute('data-tone')).toBe('orange');
      expect(notice.textContent).toContain('4 cobranças não foram para a sua conta Asaas.');
    });

    it('409 RENEWAL_STALE no envio: mensagem, relê o aluguel e a folha fica aberta', async () => {
      const m = await mount();
      await openSheet(m);
      byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.click();
      await settle(m.fixture);
      renewReqs(m.http)[0].flush(...conflict('RENEWAL_STALE'));
      await settle(m.fixture);
      expect(byId(m.fixture, 'renew-error')!.textContent).toContain('O fim do aluguel mudou');
      expect(byId(m.fixture, 'renew-sheet')).not.toBeNull();
      const newer = addDaysIso(END_IN_7, 7);
      await run(m.fixture, () => m.http.expectOne(`${BASE}/${RENTAL_ID}`).flush({ ...RENTAL, endDate: newer }));
      const reqs = previewReqs(m.http);
      expect(reqs).toHaveLength(1);
      expect(reqs[0].request.body.expectedEndDate).toBe(newer);
    });

    it('relido como encerrado: a folha fecha e não fica marcada como aberta', async () => {
      const m = await mount();
      await openSheet(m, preview({ blocker: { code: 'RENEWAL_NOT_ACTIVE', message: 'encerrado', maxEndDate: null } }));
      await run(m.fixture, () => m.http.expectOne(`${BASE}/${RENTAL_ID}`).flush({ ...RENTAL, status: 'COMPLETED' }));
      expect(byId(m.fixture, 'renew-sheet')).toBeNull();
      expect((m.fixture.componentInstance as unknown as { renewOpen: () => boolean }).renewOpen()).toBe(false);
    });

    it('409 VEHICLE_PERIOD_TAKEN com reason: a folha vai para "o carro tem outra reserva"', async () => {
      const m = await mount();
      await openSheet(m);
      byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.click();
      await settle(m.fixture);
      renewReqs(m.http)[0].flush(...conflict('VEHICLE_PERIOD_TAKEN', { reason: addDaysIso(END_IN_7, 14) }));
      await settle(m.fixture);
      expect(byId(m.fixture, 'renew-taken')!.textContent).toContain('Dá para renovar até');
      expect(byId(m.fixture, 'renew-fit')).not.toBeNull();
    });

    it('403: "Você não tem permissão para renovar este aluguel."', async () => {
      const m = await mount();
      await openSheet(m);
      byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.click();
      await settle(m.fixture);
      renewReqs(m.http)[0].flush({ code: 'CHARGES_FLEX_DISABLED', message: 'x' }, { status: 403, statusText: 'Forbidden' });
      await settle(m.fixture);
      expect(byId(m.fixture, 'renew-error')!.textContent).toContain('Você não tem permissão para renovar este aluguel.');
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(false);
    });

    it('RenR3 · "Ver as 4 cobranças" abre a lista; "Entendi" volta e o foco vai ao link', async () => {
      const m = await mount();
      await openSheet(m);
      await run(m.fixture, () => byId<HTMLButtonElement>(m.fixture, 'renew-see-charges')!.click());
      const list = byId(m.fixture, 'renew-charges')!;
      expect(list.textContent).toContain('Semana 5');
      expect(list.querySelectorAll('li')).toHaveLength(4);
      expect(list.textContent).toContain('Sem desconto e sem parcelas. A caução continua a mesma.');
      expect(byId(m.fixture, 'renew-sheet')).toBeNull();
      const ok = Array.from((m.fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Entendi',
      )!;
      await run(m.fixture, () => ok.click());
      expect(byId(m.fixture, 'renew-sheet')).not.toBeNull();
      await settle(m.fixture);
      expect(document.activeElement?.getAttribute('data-testid')).toBe('renew-see-charges');
    });
  });
});
