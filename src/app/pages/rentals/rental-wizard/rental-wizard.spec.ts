import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { EMPTY, Observable, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { RentalWizard } from './rental-wizard';
import { RentalForm } from '../rental-form';
import { RentalNew } from '../rental-new';
import { RentalService } from '../rental.service';
import { CompanyContactGate } from '../../../services/company-contact-gate.service';
import { VehiclesService } from '../../../services/vehicles.service';
import { DriverService } from '../../../services/driver.service';
import { AsaasIntegrationService } from '../../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../../company-settings/contract-template/contract-template-service';
import type {
  ChargePlanDto,
  CreateRentalRequest,
  RentalChargePreviewDto,
  RentalChargePreviewItemDto,
} from '../../../types/rental.types';
import { buildWizardPlan, localCharges, periodCount } from './wizard-math';

/**
 * Novo aluguel passo a passo (CHARGES_FLEX). Prova:
 * - o portão: sem a chave, o formulário de hoje; com ela, o passo a passo;
 * - a paridade do corpo com o formulário de hoje para as mesmas entradas;
 * - as duas contas do protótipo, e que o Confira mostra a prévia do SERVIDOR;
 * - o defeito de produção (parcelas de semana perdidas): o corpo mantém os PERIOD depois de
 *   idas e voltas de data, valor e interruptores; o que mudou de verdade fica "a refazer" e
 *   bloqueia o Criar, com aviso no topo.
 *
 * Só `Date` é falso (hoje = 13/11/2026); nada espera tempo real.
 */

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TODAY = new Date('2026-11-13T12:00:00-03:00');

const DRIVERS = [{ id: 'drv-1', name: 'Carlos Mendes', status: 'ACTIVE' }];
const VEHICLES = [{ id: 'veh-1', plate: 'RSL4B21', brand: 'Hyundai', model: 'HB20' }];

let preflight: Mock;
let chargePreview: Mock;
let createSpy: Mock;
let asaasConnected = true;

/** A prévia que o servidor devolveria: a conta local, no formato do contrato. */
function serverPreviewFor(body: CreateRentalRequest, override?: Partial<RentalChargePreviewDto>): RentalChargePreviewDto {
  const periods = periodCount(body.startDate, body.endDate, body.billingFrequency);
  const plan = body.chargePlan ?? null;
  const split = plan?.defaultSplit
    ? { count: plan.defaultSplit.count, intervalN: plan.defaultSplit.intervalDays, unit: plan.defaultSplit.intervalUnit ?? 'DAYS', offsetDays: 0, scope: 'ALL' as const, selected: [] }
    : null;
  const charges = localCharges({
    frequency: body.billingFrequency,
    startDate: body.startDate,
    periods,
    firstDue: body.firstPaymentDate ?? body.startDate,
    rateCents: body.periodRate,
    today: '2026-11-13',
    discount: plan?.discount ?? null,
    split,
    caucaoCents: body.caucaoAmount ?? 0,
    caucaoPaid: body.caucaoPaid ?? false,
    caucaoParts: plan?.overrides?.find((o) => o.target === 'CAUCAO')?.instalments ?? null,
  });
  const items: RentalChargePreviewItemDto[] = charges.map((c) => ({
    kind: c.kind,
    index: c.index,
    dueDate: c.dueDate,
    amountCents: c.amountCents,
    destination: 'ASAAS',
    instalmentIndex: c.instalmentIndex,
    instalmentCount: c.instalmentCount,
  }));
  return {
    automaticCharge: body.automaticCharge ?? false,
    willCreateInGateway: body.automaticCharge ?? false,
    charges: items,
    totalCents: items.reduce((a, c) => a + c.amountCents, 0),
    gatewayCount: items.length,
    localCount: 0,
    firstDueDate: items[0]?.dueDate ?? null,
    blocker: null,
    ...override,
  };
}

function providers(): unknown[] {
  preflight = vi.fn(() => of({ ok: true, issues: [], warnings: [], limits: null }));
  chargePreview = vi.fn((body: CreateRentalRequest): Observable<unknown> => of(serverPreviewFor(body)));
  createSpy = vi.fn().mockReturnValue(of({ id: 'novo', chargeSync: null }));
  return [
    provideRouter([{ path: '**', children: [] }]),
    provideNoopAnimations(),
    { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
    { provide: VehiclesService, useValue: { list: () => of({ content: VEHICLES, page: 0, size: 500, total: 1 }) } },
    { provide: DriverService, useValue: { list: () => of({ content: DRIVERS, page: 0, size: 500, total: 1 }) } },
    { provide: CompanyContactGate, useValue: { ensureComplete: () => of(true), promptAfterServerRefusal: () => of(false) } },
    {
      provide: RentalService,
      useValue: { getById: () => EMPTY, preflight, chargePreview, create: createSpy, update: vi.fn() },
    },
    {
      provide: AsaasIntegrationService,
      useValue: { status: signal(asaasConnected ? { connected: true } : null), load: () => of(null) },
    },
    { provide: ContractTemplateService, useValue: { get: () => EMPTY } },
  ];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
  sessionStorage.clear();
  asaasConnected = true;
});

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
  TestBed.resetTestingModule();
});

/** As entradas da conta 1 do protótipo, com os nomes dos controles do passo a passo. */
const CASE = {
  driverId: 'drv-1',
  vehicleId: 'veh-1',
  startDate: '2026-11-16',
  pickupTime: '09:00',
  endDate: '2027-02-07',
  billingFrequency: 'WEEKLY',
  periodRateReais: '750,00',
  firstPaymentDate: '2026-11-16',
  automaticCharge: true,
  caucaoReais: '1.500,00',
  initialKm: '45.820',
  lateFineType: 'FIXED',
  lateFineValue: '50,00',
  lateInterestPercent: '1',
};

describe('RentalWizard — Novo aluguel passo a passo', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<RentalWizard>>;
  const cmp = (): Any => fixture.componentInstance as unknown as Any;
  const q = <T extends Element = HTMLElement>(sel: string): T | null => fixture.nativeElement.querySelector(sel) as T | null;
  const byId = <T extends Element = HTMLElement>(id: string): T | null => q<T>(`[data-testid="${id}"]`);
  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  async function mount(): Promise<void> {
    TestBed.configureTestingModule({ imports: [RentalWizard], providers: providers() });
    fixture = TestBed.createComponent(RentalWizard);
    fixture.detectChanges();
    await fixture.whenStable();
  }
  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  function patch(values: Record<string, unknown>): void {
    cmp()['form'].patchValue(values);
  }
  async function next(): Promise<void> {
    cmp()['next']();
    await render();
  }
  async function toConfira(): Promise<void> {
    for (let i = 0; i < 7; i++) await next();
    expect(cmp()['step']()).toBe(8);
  }
  function lastBody(): CreateRentalRequest {
    return createSpy.mock.calls[createSpy.mock.calls.length - 1][0] as CreateRentalRequest;
  }
  function setParcSome(selected: number[]): void {
    patch({ parcOn: true, splitScope: 'SOME', splitCount: '2', splitIntervalN: '3', splitUnit: 'DAYS', splitOffset: '0' });
    for (const i of selected) cmp()['toggleWeek'](i);
  }
  function periodOverrides(plan: ChargePlanDto | null | undefined): Array<{ i: number | null; n: number }> {
    return (plan?.overrides ?? []).filter((o) => o.target === 'PERIOD').map((o) => ({ i: o.periodIndex, n: o.instalments.length }));
  }

  it('não oferece "Tempo mínimo, depois renova": o passo 2 só tem a data de devolução', async () => {
    await mount();
    patch({ driverId: 'drv-1', vehicleId: 'veh-1' });
    await next();
    expect(cmp()['step']()).toBe(2);
    expect(text()).not.toContain('Tempo mínimo');
    expect(text()).not.toContain('renova');
    expect(text()).toContain('Devolve em');
  });

  it('valida cada passo: sem motorista, o erro aparece com role=alert e o passo não anda', async () => {
    await mount();
    await next();
    expect(cmp()['step']()).toBe(1);
    const alert = q('[role="alert"]#wz-e-driver');
    expect(alert?.textContent).toContain('Escolha quem vai levar o carro.');
    expect(q('[aria-labelledby="wz-lbm"]')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('juros acima de 11% e multa fixa maior que a semana são recusados no passo 7', async () => {
    await mount();
    patch({ ...CASE, lateInterestPercent: '12', lateFineValue: '800,00' });
    for (let i = 0; i < 6; i++) await next();
    expect(cmp()['step']()).toBe(7);
    await next();
    expect(cmp()['step']()).toBe(7);
    expect(text()).toContain('Os juros vão de 0% a 11% ao mês.');
    expect(text()).toContain('A multa precisa ser menor que R$ 750,00, o menor valor de semana.');
    expect(q('#wz-juros')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('conta 1 do protótipo: valor cheio = R$ 10.500,00 em 13 cobranças, sem chargePlan no corpo', async () => {
    await mount();
    patch(CASE);
    await render();
    expect(byId('summary-money')?.textContent).toContain('R$ 10.500,00');
    await toConfira();
    expect(byId('confira-total')?.textContent).toContain('R$ 10.500,00');
    expect(byId('confira-rent')?.textContent).toContain('R$ 9.000,00');
    expect(byId('confira-count')?.textContent).toContain('13 cobranças por Pix');
    await next();
    const body = lastBody();
    expect('chargePlan' in body).toBe(false);
    expect(body).toMatchObject({ periodRate: 75_000, caucaoAmount: 150_000, billingFrequency: 'WEEKLY', automaticCharge: true });
    expect(cmp()['step']()).toBe(9);
  });

  it('conta 2 do protótipo: desconto + todas em 2 parcelas a cada 3 dias + caução 750 + 750 = R$ 10.200,00 em 26', async () => {
    await mount();
    patch(CASE);
    patch({ caucaoSplit: false });
    cmp()['toggleCaucaoSplit']();
    cmp()['caucaoParts'].at(0).patchValue({ amount: '750,00', due: '2026-11-16' });
    cmp()['caucaoParts'].at(1).patchValue({ due: '2026-11-23' });
    patch({ descOn: true, discountN: '3', discountType: 'AMOUNT', discountValue: '100,00' });
    patch({ parcOn: true, splitScope: 'ALL', splitCount: '2', splitIntervalN: '3', splitUnit: 'DAYS', splitOffset: '0' });
    await render();
    expect(byId('summary-money')?.textContent).toContain('R$ 10.200,00');
    expect(byId('summary-money')?.textContent).toContain('26 cobranças');
    await toConfira();
    expect(byId('confira-total')?.textContent).toContain('R$ 10.200,00');
    expect(byId('confira-rent')?.textContent).toContain('R$ 8.700,00');
    // "Ver as 26 cobranças" é a lista do servidor.
    const toggle = byId<HTMLButtonElement>('charges-toggle')!;
    expect(toggle.textContent).toContain('Ver as 26 cobranças');
    toggle.click();
    await render();
    const list = byId('charges-list')!.textContent ?? '';
    expect(list).toContain('Semana 1, parcela 1 de 2');
    expect(list).toContain('R$ 325,00');
    expect(list).toContain('R$ 375,00');
    expect(list).toContain('Caução, parte 2 de 2');
    await next();
    expect(lastBody().chargePlan).toEqual({
      discount: { type: 'AMOUNT', value: 10_000, firstPeriods: 3 },
      defaultSplit: { count: 2, intervalDays: 3, intervalUnit: 'DAYS' },
      overrides: [
        { target: 'CAUCAO', periodIndex: null, instalments: [
          { dueDate: '2026-11-16', amountCents: 75_000 },
          { dueDate: '2026-11-23', amountCents: 75_000 },
        ] },
      ],
    });
  });

  it('o Confira mostra a prévia do SERVIDOR, mesmo quando ela difere da conta local', async () => {
    await mount();
    patch(CASE);
    chargePreview.mockImplementation((body: CreateRentalRequest) => of(serverPreviewFor(body, { totalCents: 1_049_999 })));
    await toConfira();
    expect(byId('confira-total')?.textContent).toContain('R$ 10.499,99');
    expect(chargePreview).toHaveBeenCalledTimes(1);
    expect(preflight.mock.calls[0][0]).not.toHaveProperty('chargePlan');
  });

  it('a caução aceita N partes: a última é o resto e as três vão no CAUCAO', async () => {
    await mount();
    patch(CASE);
    cmp()['toggleCaucaoSplit']();
    cmp()['caucaoParts'].at(0).patchValue({ amount: '500,00', due: '2026-11-16' });
    cmp()['addPart']();
    cmp()['caucaoParts'].at(1).patchValue({ amount: '500,00', due: '2026-11-23' });
    cmp()['caucaoParts'].at(2).patchValue({ due: '2026-11-30' });
    await render();
    const plan = buildWizardPlan(cmp()['mathInput']());
    expect(plan?.overrides?.[0].instalments.map((i) => i.amountCents)).toEqual([50_000, 50_000, 50_000]);
  });

  describe('defeito de produção: parcelas de semana perdidas', () => {
    async function ready(): Promise<void> {
      await mount();
      patch(CASE);
      setParcSome([0, 1]);
      await render();
      expect(periodOverrides(buildWizardPlan(cmp()['mathInput']()))).toEqual([{ i: 0, n: 2 }, { i: 1, n: 2 }]);
    }

    it('ida e volta da 1ª cobrança, do fim e do valor (inclusive vazio no meio) mantém os PERIOD no POST', async () => {
      await ready();
      patch({ firstPaymentDate: '2026-11-17' });
      patch({ firstPaymentDate: '' });
      patch({ firstPaymentDate: '2026-11-16' });
      patch({ endDate: '2027-03-07' });
      patch({ endDate: '' });
      patch({ endDate: '2027-02-07' });
      patch({ periodRateReais: '75,00' });
      patch({ periodRateReais: '' });
      patch({ periodRateReais: '750,00' });
      await render();
      await toConfira();
      await next();
      const plan = lastBody().chargePlan;
      expect(periodOverrides(plan)).toEqual([{ i: 0, n: 2 }, { i: 1, n: 2 }]);
      expect(plan?.overrides?.[0].instalments).toEqual([
        { dueDate: '2026-11-16', amountCents: 37_500 },
        { dueDate: '2026-11-19', amountCents: 37_500 },
      ]);
    });

    it('a semana que deixou de existir fica "a refazer": aviso no topo e Criar bloqueado; ao voltar, as parcelas voltam', async () => {
      await ready();
      setParcSome([]);
      cmp()['toggleWeek'](11);
      patch({ endDate: '2027-01-31' }); // 11 semanas: a semana 12 sumiu
      await render();
      expect(cmp()['staleSplits']()).toEqual([11]);
      expect(byId('wizard-top-issues')?.textContent).toContain('precisa ser refeito');
      // O passo 6 não deixa passar com a semana a refazer.
      for (let i = 0; i < 6; i++) await next();
      expect(cmp()['step']()).toBe(6);
      patch({ endDate: '2027-02-07' });
      await render();
      expect(cmp()['staleSplits']()).toEqual([]);
      expect(byId('wizard-top-issues')).toBeNull();
      for (let i = 0; i < 2; i++) await next();
      expect(cmp()['step']()).toBe(8);
      await next();
      expect(periodOverrides(lastBody().chargePlan)).toEqual([{ i: 0, n: 2 }, { i: 1, n: 2 }, { i: 11, n: 2 }]);
    });

    it('com a semana a refazer, o Criar fica desabilitado no Confira e nada é enviado', async () => {
      await ready();
      await toConfira();
      patch({ billingFrequency: 'DAILY' }); // "semana 1" virou outra coisa
      await render();
      expect(byId('wizard-top-issues')?.textContent).toContain('precisa ser refeito');
      expect(byId<HTMLButtonElement>('wizard-next')?.disabled).toBe(true);
      cmp()['create']();
      expect(createSpy).not.toHaveBeenCalled();
      patch({ billingFrequency: 'WEEKLY' });
      await render();
      expect(byId('wizard-top-issues')).toBeNull();
      await next();
      expect(periodOverrides(lastBody().chargePlan)).toEqual([{ i: 0, n: 2 }, { i: 1, n: 2 }]);
    });

    it('desmarcar "Parcelar" ou tocar "Cobrar valor cheio" pede confirmação; "Manter" preserva as parcelas', async () => {
      await ready();
      for (let i = 0; i < 5; i++) await next();
      expect(cmp()['step']()).toBe(6);
      byId<HTMLButtonElement>('plan-parc')!.click();
      await render();
      expect(cmp()['discard']()?.message).toContain('semanas 1 e 2');
      expect(cmp()['form'].controls.parcOn.value).toBe(true);
      cmp()['cancelDiscard']();
      byId<HTMLButtonElement>('plan-full')!.click();
      await render();
      expect(cmp()['discard']()?.kind).toBe('full');
      cmp()['cancelDiscard']();
      // "Todas" e de volta "Só algumas" também não perdem nada.
      cmp()['setScope']('ALL');
      cmp()['setScope']('SOME');
      await render();
      await next();
      await next();
      await next();
      expect(periodOverrides(lastBody().chargePlan)).toEqual([{ i: 0, n: 2 }, { i: 1, n: 2 }]);
    });

    it('confirmar o "Desfazer" é a única forma de tirar as parcelas', async () => {
      await ready();
      cmp()['toggleParc']();
      cmp()['confirmDiscard']();
      await render();
      expect(buildWizardPlan(cmp()['mathInput']())).toBeNull();
    });
  });
});

/**
 * Paridade: para as MESMAS entradas, o passo a passo envia o mesmo corpo que o formulário de
 * hoje (que fica intocado). Pix pelo MyCarsHub = `automaticCharge: true`.
 */
describe('RentalWizard — paridade do corpo com o formulário de hoje', () => {
  const OLD = {
    vehicleId: 'veh-1',
    driverId: 'drv-1',
    startDate: '2026-11-16',
    endDate: '2027-02-07',
    billingFrequency: 'WEEKLY',
    periodRateReais: '750,00',
    caucaoReais: '1.500,00',
    caucaoPaid: false,
    initialKm: 45_820,
    pickupDate: '2026-11-18T14:30',
    firstPaymentDate: '2026-11-20',
    lateInterestPercent: '1,50',
    lateFineType: 'PERCENT',
    lateFineValueInput: 2,
    franchiseKm: 150,
    extraKmPriceReais: '0,50',
    returnFuelPolicy: 'Tanque cheio',
    notes: '  Observação interna  ',
  };
  const NEW = {
    vehicleId: 'veh-1',
    driverId: 'drv-1',
    startDate: '2026-11-16',
    endDate: '2027-02-07',
    billingFrequency: 'WEEKLY',
    periodRateReais: '750,00',
    caucaoReais: '1.500,00',
    caucaoPaid: false,
    initialKm: '45.820',
    pickupTime: '14:30',
    pickupOtherDay: true,
    pickupDay: '2026-11-18',
    firstPaymentDate: '2026-11-20',
    lateInterestPercent: '1,5',
    lateFineType: 'PERCENT',
    lateFineValue: '2',
    hasKmLimit: true,
    franchiseKm: '150',
    extraKmPriceReais: '0,50',
    fuel: 'Tanque cheio',
    notes: '  Observação interna  ',
  };

  async function oldBody(automatic: boolean): Promise<CreateRentalRequest> {
    TestBed.configureTestingModule({ imports: [RentalForm], providers: providers() });
    const f = TestBed.createComponent(RentalForm);
    f.detectChanges();
    const c = f.componentInstance as unknown as Any;
    c['form'].patchValue({ ...OLD, automaticCharge: automatic });
    f.detectChanges();
    c['submit']();
    if (automatic) c['confirmCharges']();
    expect(createSpy).toHaveBeenCalledTimes(1);
    const body = createSpy.mock.calls[0][0] as CreateRentalRequest;
    f.destroy();
    TestBed.resetTestingModule();
    return body;
  }

  async function newBody(automatic: boolean): Promise<CreateRentalRequest> {
    TestBed.configureTestingModule({ imports: [RentalWizard], providers: providers() });
    const f = TestBed.createComponent(RentalWizard);
    f.detectChanges();
    await f.whenStable();
    const c = f.componentInstance as unknown as Any;
    c['form'].patchValue({ ...NEW, automaticCharge: automatic });
    for (let i = 0; i < 8; i++) {
      c['next']();
      f.detectChanges();
      await f.whenStable();
    }
    expect(createSpy).toHaveBeenCalledTimes(1);
    return createSpy.mock.calls[0][0] as CreateRentalRequest;
  }

  it.each([false, true])('automaticCharge=%s: corpos idênticos', async (automatic) => {
    const before = await oldBody(automatic);
    const after = await newBody(automatic);
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      pickupDate: '2026-11-18T14:30',
      initialKm: 45_820,
      lateInterestPercentPerMonth: 1.5,
      lateFineValue: 200,
      extraKmPrice: 50,
      franchiseKm: 150,
      contractSource: 'MANUAL',
      notes: 'Observação interna',
    });
  });
});

/** O portão em `/alugueis/novo`: sem a chave, o formulário de hoje; com ela, o passo a passo. */
describe('RentalNew — portão CHARGES_FLEX', () => {
  async function mountGate(features: string[] | null): Promise<HTMLElement> {
    if (features) sessionStorage.setItem('features', JSON.stringify(features));
    TestBed.configureTestingModule({ imports: [RentalNew], providers: providers() });
    await TestBed.compileComponents();
    const f = TestBed.createComponent(RentalNew);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('sem a chave: o formulário de hoje e nada do passo a passo', async () => {
    const el = await mountGate(null);
    expect(el.querySelector('app-rental-form')).not.toBeNull();
    expect(el.querySelector('app-rental-wizard')).toBeNull();
  });

  it('com outra chave qualquer: continua o formulário de hoje', async () => {
    const el = await mountGate(['OTHER_FEATURE']);
    expect(el.querySelector('app-rental-form')).not.toBeNull();
    expect(el.querySelector('app-rental-wizard')).toBeNull();
  });

  it('com CHARGES_FLEX: o passo a passo, e não o formulário de hoje', async () => {
    const el = await mountGate(['CHARGES_FLEX']);
    expect(el.querySelector('app-rental-wizard')).not.toBeNull();
    expect(el.querySelector('app-rental-form')).toBeNull();
  });
});
