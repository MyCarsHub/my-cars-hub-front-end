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

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
  for (const req of http.match((r) => r.method === 'GET')) {
    req.flush(req.request.url.includes('signature') ? null : []);
  }
}

function byId<T extends HTMLElement = HTMLElement>(f: ComponentFixture<RentalDetail>, id: string): T | null {
  return (f.nativeElement as HTMLElement).querySelector<T>(`[data-testid="${id}"]`);
}

function previewReqs(http: HttpTestingController): TestRequest[] {
  return http.match((r) => r.url === `${BASE}/${RENTAL_ID}/renew-preview`);
}

/** Abre a folha e responde a prévia inicial (depois da espera). */
async function openSheet(m: Mounted, body: RenewalPreviewDto = preview()): Promise<TestRequest> {
  byId<HTMLButtonElement>(m.fixture, 'renew-open')!.click();
  await settle(m.fixture);
  await wait(350);
  await settle(m.fixture);
  const reqs = previewReqs(m.http);
  expect(reqs).toHaveLength(1);
  reqs[0].flush(body);
  await settle(m.fixture);
  return reqs[0];
}

afterEach(() => {
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
      expect(byId(fixture, 'rental-end-notice-title')!.textContent).toBe(
        `Termina em 7 dias, em ${END_IN_7.slice(8, 10)}/${END_IN_7.slice(5, 7)}`,
      );
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
      expect(byId(fixture, 'rental-end-notice-title')!.textContent).toBe(
        `Terminou em ${past.slice(8, 10)}/${past.slice(5, 7)} e continua ativo`,
      );
    });

    it('aluguel de data fixa: sem "Tempo mínimo"', async () => {
      const { fixture } = await mount({ rental: { minimumTermDays: null } });
      expect(byId(fixture, 'period-minimum')).toBeNull();
      expect(byId(fixture, 'period-renewals')).not.toBeNull();
    });
  });

  describe('RenR2–R6 · a folha', () => {
    it('preenche 4 semanas e o valor de hoje; a prévia do servidor vira o total laranja', async () => {
      const m = await mount();
      const req = await openSheet(m);
      expect(req.request.body).toEqual({
        additionalAmount: 4,
        unit: 'WEEKS',
        periodRate: 60_000,
        expectedEndDate: END_IN_7,
      });
      expect(byId<HTMLInputElement>(m.fixture, 'renew-amount')!.value).toBe('4');
      expect(byId<HTMLSelectElement>(m.fixture, 'renew-unit')!.value).toBe('WEEKS');
      expect(byId<HTMLInputElement>(m.fixture, 'renew-rate')!.value).toBe('600,00');
      expect(byId(m.fixture, 'renew-new-end')!.textContent).toContain('(4 semanas depois de');
      expect(byId(m.fixture, 'renew-total')!.textContent).toContain('R$ 2.400,00');
      expect(byId(m.fixture, 'renew-total')!.textContent).toContain('4 cobranças novas');
      expect(byId(m.fixture, 'renew-see-charges')!.textContent?.trim()).toBe('Ver as 4 cobranças');
      expect(byId(m.fixture, 'renew-say')!.textContent).toContain('vão para a sua conta Asaas agora');
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(false);
    });

    it('digitar pede UMA prévia, depois da espera; o botão espera a prévia do corpo novo', async () => {
      const m = await mount();
      await openSheet(m);
      const amount = byId<HTMLInputElement>(m.fixture, 'renew-amount')!;
      for (const v of ['1', '12', '2']) {
        amount.value = v;
        amount.dispatchEvent(new Event('input'));
        await settle(m.fixture);
      }
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(true);
      expect(previewReqs(m.http)).toHaveLength(0);
      await wait(350);
      const reqs = previewReqs(m.http);
      expect(reqs).toHaveLength(1);
      expect(reqs[0].request.body.additionalAmount).toBe(2);
      reqs[0].flush(preview({ periods: preview().periods.slice(0, 2), addedTotalCents: 120_000 }));
      await settle(m.fixture);
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(false);
    });

    it('quantidade inválida: erro no campo e nenhuma prévia', async () => {
      const m = await mount();
      await openSheet(m);
      const amount = byId<HTMLInputElement>(m.fixture, 'renew-amount')!;
      amount.value = '0';
      amount.dispatchEvent(new Event('input'));
      await settle(m.fixture);
      await wait(350);
      expect(previewReqs(m.http)).toHaveLength(0);
      expect(m.fixture.nativeElement.textContent).toContain('Informe ao menos 1.');
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(true);
    });

    it('RenR4 · cobrança atrasada: o aviso, e renova do mesmo jeito', async () => {
      const m = await mount();
      await openSheet(m, preview({ overdueCount: 1 }));
      expect(byId(m.fixture, 'renew-overdue')!.textContent).toContain(
        'Ele tem 1 cobrança atrasada. Ela continua como está. A renovação só cria as novas.',
      );
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(false);
    });

    it('RenR5 · o carro tem outra reserva: "Renovar até" ajusta a quantidade e pede a prévia de novo', async () => {
      const m = await mount();
      const max = addDaysIso(END_IN_7, 14);
      await openSheet(
        m,
        preview({ blocker: { code: 'VEHICLE_PERIOD_TAKEN', message: 'ocupado', maxEndDate: max } }),
      );
      expect(byId(m.fixture, 'renew-taken')!.textContent).toContain('(2 semanas)');
      expect(byId(m.fixture, 'renew-submit')).toBeNull();
      expect(byId(m.fixture, 'renew-total')).toBeNull();
      byId<HTMLButtonElement>(m.fixture, 'renew-fit')!.click();
      await settle(m.fixture);
      await wait(350);
      const reqs = previewReqs(m.http);
      expect(reqs).toHaveLength(1);
      expect(reqs[0].request.body.additionalAmount).toBe(2);
    });

    it('outro bloqueio da prévia: a mensagem e o botão desabilitado', async () => {
      const m = await mount();
      await openSheet(m, preview({ blocker: { code: 'RENEWAL_END_IN_PAST', message: 'O novo fim fica antes de hoje.', maxEndDate: null } }));
      expect(byId(m.fixture, 'renew-blocker')!.textContent).toContain('O novo fim fica antes de hoje.');
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(true);
    });

    it('prévia que falhou: aviso e "Tentar de novo"', async () => {
      const m = await mount();
      byId<HTMLButtonElement>(m.fixture, 'renew-open')!.click();
      await settle(m.fixture);
      await wait(350);
      previewReqs(m.http)[0].flush({ message: 'x' }, { status: 500, statusText: 'err' });
      await settle(m.fixture);
      expect(byId(m.fixture, 'renew-preview-failed')).not.toBeNull();
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(true);
    });

    it('renova com o expectedEndDate; dois toques mandam UM pedido; depois, o aviso verde (RenR6)', async () => {
      const m = await mount();
      await openSheet(m);
      const submit = byId<HTMLButtonElement>(m.fixture, 'renew-submit')!;
      submit.click();
      submit.click();
      await settle(m.fixture);
      const renews = m.http.match(`${BASE}/${RENTAL_ID}/renew`);
      expect(renews).toHaveLength(1);
      expect(renews[0].request.body).toEqual({
        additionalAmount: 4,
        unit: 'WEEKS',
        periodRate: 60_000,
        expectedEndDate: END_IN_7,
      });
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(true);
      const newEnd = addDaysIso(END_IN_7, 28);
      renews[0].flush({ ...RENTAL, endDate: newEnd, renewalCount: 1, chargeSync: { requested: 4, created: 4, failed: 0, local: 0 } });
      await settle(m.fixture);
      flushGets(m.http);
      await wait(260);
      await settle(m.fixture);
      expect(byId(m.fixture, 'renew-sheet')).toBeNull();
      const notice = byId(m.fixture, 'rental-end-notice')!;
      expect(notice.getAttribute('data-tone')).toBe('green');
      expect(notice.textContent).toContain(
        `Aluguel renovado até ${newEnd.slice(8, 10)}/${newEnd.slice(5, 7)}/${newEnd.slice(0, 4)}`,
      );
      expect(notice.textContent).toContain('4 cobranças novas na sua conta Asaas.');
      expect(byId(m.fixture, 'period-renewals')!.textContent).toContain('1');
      m.http.match(() => true).forEach((r) => r.flush([]));
    });

    it('falha parcial no Asaas: o aviso de sincronização de sempre aparece', async () => {
      const m = await mount();
      await openSheet(m);
      byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.click();
      await settle(m.fixture);
      m.http
        .expectOne(`${BASE}/${RENTAL_ID}/renew`)
        .flush({ ...RENTAL, endDate: addDaysIso(END_IN_7, 28), renewalCount: 1, chargeSync: { requested: 4, created: 3, failed: 1, local: 0 } });
      await settle(m.fixture);
      expect(byId(m.fixture, 'charge-sync-warning')).not.toBeNull();
      m.http.match(() => true).forEach((r) => r.flush([]));
      // A folha termina a animação de saída antes do fim do teste.
      await wait(260);
      await settle(m.fixture);
    });

    it('409 RENEWAL_STALE: mensagem, relê o aluguel e a folha fica aberta', async () => {
      const m = await mount();
      await openSheet(m);
      byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.click();
      await settle(m.fixture);
      m.http
        .expectOne(`${BASE}/${RENTAL_ID}/renew`)
        .flush({ code: 'RENEWAL_STALE', message: 'mudou' }, { status: 409, statusText: 'Conflict' });
      await settle(m.fixture);
      expect(byId(m.fixture, 'renew-error')!.textContent).toContain('O fim do aluguel mudou');
      expect(byId(m.fixture, 'renew-sheet')).not.toBeNull();
      const newer = addDaysIso(END_IN_7, 7);
      m.http.expectOne(`${BASE}/${RENTAL_ID}`).flush({ ...RENTAL, endDate: newer });
      await settle(m.fixture);
      await wait(350);
      const reqs = previewReqs(m.http);
      expect(reqs).toHaveLength(1);
      expect(reqs[0].request.body.expectedEndDate).toBe(newer);
    });

    it('409 VEHICLE_PERIOD_TAKEN com reason: a folha vai para "o carro tem outra reserva"', async () => {
      const m = await mount();
      await openSheet(m);
      byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.click();
      await settle(m.fixture);
      m.http
        .expectOne(`${BASE}/${RENTAL_ID}/renew`)
        .flush({ code: 'VEHICLE_PERIOD_TAKEN', message: 'ocupado', reason: addDaysIso(END_IN_7, 14) }, { status: 409, statusText: 'Conflict' });
      await settle(m.fixture);
      expect(byId(m.fixture, 'renew-taken')!.textContent).toContain('Dá para renovar até');
      expect(byId(m.fixture, 'renew-fit')).not.toBeNull();
    });

    it('403: "Você não tem permissão para renovar este aluguel."', async () => {
      const m = await mount();
      await openSheet(m);
      byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.click();
      await settle(m.fixture);
      m.http
        .expectOne(`${BASE}/${RENTAL_ID}/renew`)
        .flush({ code: 'CHARGES_FLEX_DISABLED', message: 'x' }, { status: 403, statusText: 'Forbidden' });
      await settle(m.fixture);
      expect(byId(m.fixture, 'renew-error')!.textContent).toContain('Você não tem permissão para renovar este aluguel.');
      expect(byId<HTMLButtonElement>(m.fixture, 'renew-submit')!.disabled).toBe(false);
    });

    it('RenR3 · "Ver as 4 cobranças" abre a lista e "Entendi" volta para a folha', async () => {
      const m = await mount();
      await openSheet(m);
      byId<HTMLButtonElement>(m.fixture, 'renew-see-charges')!.click();
      await wait(260);
      await settle(m.fixture);
      const list = byId(m.fixture, 'renew-charges')!;
      expect(list.textContent).toContain('Semana 5');
      expect(list.querySelectorAll('li')).toHaveLength(4);
      expect(list.textContent).toContain('Sem desconto e sem parcelas. A caução continua a mesma.');
      expect(byId(m.fixture, 'renew-sheet')).toBeNull();
    });
  });
});
