import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, Observable, Subject, of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { RentalCreate, initialsOf } from './rental-create';
import { VehiclesService } from '../../../services/vehicles.service';
import { DriverService } from '../../../services/driver.service';
import { CompanyContactGate } from '../../../services/company-contact-gate.service';
import { RentalService } from '../rental.service';
import { AsaasIntegrationService } from '../../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../../company-settings/contract-template/contract-template-service';
import type { RentalChargePreviewDto, RentalChargePreviewItemDto } from '../../../types/rental.types';

/**
 * Novo aluguel em uma página (CHARGES_FLEX), entrega 1: a barra de etapas e os cards 1 e 2.
 * Casos do passo a passo levados para cá: listas com livres/ocupados do período, `?vehicleId=`,
 * a 1ª cobrança que acompanha o início e o rascunho por usuário e empresa.
 *
 * Só `Date` é falso (hoje = 20/11/2026); nada espera tempo real.
 */

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const DRIVERS = [
  { id: 'drv-1', name: 'Carlos Henrique Souza', status: 'ACTIVE' },
  { id: 'drv-2', name: 'João Pedro Alves', status: 'ACTIVE' },
  { id: 'drv-3', name: 'Paulo Suspenso', status: 'SUSPENDED' },
];
const VEHICLES = [
  { id: 'veh-1', plate: 'RDC4A21', brand: 'Chevrolet', model: 'Onix 1.0', sold: false },
  { id: 'veh-2', plate: 'TES2T02', brand: 'Hyundai', model: 'HB20', sold: false },
  { id: 'veh-3', plate: 'VND1A00', brand: 'Fiat', model: 'Uno', sold: true },
];

let vehiclesList: (params: Record<string, unknown>) => Observable<unknown>;
let driversList: (params: Record<string, unknown>) => Observable<unknown>;
let queryVehicleId: string | null = null;
let preflight: Mock;
let chargePreview: Mock;
let createSpy: Mock;
let contactOk = true;
let asaasConnected = false;
let templateGet: () => Observable<unknown> = () => EMPTY;
let asaasLoad: () => Observable<unknown> = () => of(null);
let promptAfter: () => Observable<boolean> = () => of(false);

function item(kind: 'RENTAL_PERIOD' | 'CAUCAO', index: number, dueDate: string, amountCents: number, k = 1, n = 1): RentalChargePreviewItemDto {
  return { kind, index, dueDate, amountCents, destination: 'ASAAS', instalmentIndex: k, instalmentCount: n };
}

/** A resposta FIXA do servidor (de propósito diferente da conta local na caução: R$ 1.199,99). */
const SERVER_PREVIEW: RentalChargePreviewDto = {
  automaticCharge: false,
  willCreateInGateway: false,
  charges: [
    item('CAUCAO', 0, '2026-11-24', 119_999),
    item('RENTAL_PERIOD', 0, '2026-11-24', 60_000),
    item('RENTAL_PERIOD', 1, '2026-12-01', 60_000),
    item('RENTAL_PERIOD', 2, '2026-12-08', 60_000),
    item('RENTAL_PERIOD', 3, '2026-12-15', 60_000),
  ],
  totalCents: 359_999,
  gatewayCount: 0,
  localCount: 5,
  firstDueDate: '2026-11-24',
  blocker: null,
};

function providers(): unknown[] {
  return [
    provideRouter([{ path: '**', children: [] }]),
    {
      provide: ActivatedRoute,
      useValue: {
        snapshot: {
          paramMap: { get: () => null },
          queryParamMap: { get: (k: string) => (k === 'vehicleId' ? queryVehicleId : null) },
        },
      },
    },
    { provide: VehiclesService, useValue: { list: (p: Record<string, unknown>) => vehiclesList(p) } },
    { provide: DriverService, useValue: { list: (p: Record<string, unknown>) => driversList(p) } },
    { provide: RentalService, useValue: { preflight, chargePreview, create: createSpy } },
    {
      provide: AsaasIntegrationService,
      useValue: { status: signal(asaasConnected ? { connected: true } : null), load: () => asaasLoad() },
    },
    { provide: ContractTemplateService, useValue: { get: () => templateGet() } },
    {
      provide: CompanyContactGate,
      useValue: { ensureComplete: () => of(contactOk), promptAfterServerRefusal: () => promptAfter() },
    },
  ];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00-03:00'));
  sessionStorage.clear();
  queryVehicleId = null;
  vehiclesList = () => of({ content: VEHICLES, page: 0, size: 500, total: 3 });
  driversList = () => of({ content: DRIVERS, page: 0, size: 500, total: 3 });
  preflight = vi.fn(() => of({ ok: true, issues: [], warnings: [], limits: null }));
  chargePreview = vi.fn(() => of(SERVER_PREVIEW));
  createSpy = vi.fn(() => of({ id: 'novo', chargeSync: null }));
  contactOk = true;
  asaasConnected = false;
  templateGet = () => EMPTY;
  asaasLoad = () => of(null);
  promptAfter = () => of(false);
});

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
  TestBed.resetTestingModule();
});

describe('RentalCreate — Novo aluguel em uma página', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<RentalCreate>>;
  const cmp = (): Any => fixture.componentInstance as unknown as Any;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byId = <T extends Element = HTMLElement>(id: string): T | null =>
    el().querySelector(`[data-testid="${id}"]`) as T | null;
  const text = (): string => el().textContent ?? '';

  async function mount(): Promise<void> {
    TestBed.configureTestingModule({ imports: [RentalCreate], providers: providers() });
    fixture = TestBed.createComponent(RentalCreate);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  function patch(values: Record<string, unknown>): void {
    cmp()['form'].patchValue(values);
  }
  async function openAndPick(field: 'driver' | 'vehicle', id: string): Promise<void> {
    byId<HTMLButtonElement>(field)!.click();
    await render();
    byId<HTMLElement>(`${field}-${id}`)!.click();
    await render();
  }

  it('título, descrição, os 8 cards na ordem e "Até quando?" começa em "Tem data para devolver"', async () => {
    await mount();
    expect(text()).toContain('Novo aluguel');
    expect(text()).toContain('Reserve um veículo para um motorista.');
    const titles = Array.from(el().querySelectorAll('.rc-card > h2')).map((h) => h.textContent?.trim());
    expect(titles).toEqual([
      'Motorista e veículo',
      'Período',
      'Caução',
      'Cobranças',
      'Condições de pagamento',
      'Contrato',
      'Cobrança',
      'Observações',
    ]);
    // RenPerF1: a escolha aparece fechada na data fixa; o campo é "Devolve em".
    expect(text()).toContain('Até quando?');
    expect(byId('until-fixed')!.getAttribute('aria-checked')).toBe('true');
    expect(byId('until-minimum')!.getAttribute('aria-checked')).toBe('false');
    expect(text()).toContain('Devolve em');
  });

  it('a barra de etapas começa em "Etapa 1 de 8 / 0%" e anda com os cards 1 e 2', async () => {
    await mount();
    const bar = (): HTMLElement => byId('create-progress')!;
    expect(bar().getAttribute('role')).toBe('progressbar');
    expect(bar().textContent).toContain('Etapa 1 de 8');
    expect(bar().textContent).toContain('0% concluído');
    expect(bar().getAttribute('aria-valuenow')).toBe('0');

    await openAndPick('driver', 'drv-2');
    await openAndPick('vehicle', 'veh-1');
    expect(bar().textContent).toContain('Etapa 2 de 8');
    expect(bar().textContent).toContain('12% concluído');

    patch({ startDate: '2026-11-24', endDate: '2026-12-22' });
    await render();
    expect(bar().textContent).toContain('Etapa 3 de 8');
    expect(bar().textContent).toContain('25% concluído');
    expect(bar().getAttribute('aria-valuenow')).toBe('2');
    expect(Array.from(bar().querySelectorAll('.rc-evb i')).map((i) => i.className).slice(0, 3)).toEqual([
      'done',
      'done',
      'current',
    ]);
  });

  it('card 1: motorista com avatar de iniciais; suspenso e carro vendido não aparecem', async () => {
    await mount();
    byId<HTMLButtonElement>('driver')!.click();
    await render();
    expect(byId('driver-drv-1')!.textContent).toContain('CS');
    expect(byId('driver-drv-3')).toBeNull();
    await render();
    byId<HTMLButtonElement>('vehicle')!.click();
    await render();
    expect(byId('vehicle-veh-1')!.textContent).toContain('RDC-4A21');
    expect(byId('vehicle-veh-1')!.textContent).toContain('Chevrolet Onix 1.0');
    expect(byId('vehicle-veh-3')).toBeNull();
  });

  it('card 1: o erro só aparece depois de abrir e fechar a lista sem escolher', async () => {
    await mount();
    expect(text()).not.toContain('Escolha quem vai levar o carro.');
    byId<HTMLButtonElement>('driver')!.click();
    await render();
    byId<HTMLButtonElement>('driver')!.click(); // fecha sem escolher
    await render();
    const alert = el().querySelector('app-search-select [role="alert"]');
    expect(alert?.textContent).toContain('Escolha quem vai levar o carro.');
    expect(byId('driver')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('card 2: devolução antes da retirada mostra o erro depois de visitada; a frase só com período válido', async () => {
    await mount();
    patch({ startDate: '2026-11-24', endDate: '2026-11-20' });
    cmp()['markTouched']('endDate');
    await render();
    expect(text()).toContain('A devolução precisa ser depois da retirada.');
    expect(byId('period-sentence')).toBeNull();
    patch({ endDate: '2026-12-22' });
    await render();
    expect(text()).not.toContain('A devolução precisa ser depois da retirada.');
    expect(byId('period-sentence')!.textContent).toBe('De 24/11 a 22/12. São 4 semanas.');
  });

  it('card 2: "Ele pega o carro em outro dia" abre o dia da retirada, que precisa estar no período', async () => {
    await mount();
    patch({ startDate: '2026-11-24', endDate: '2026-12-22' });
    await render();
    expect(byId('pickup-day')).toBeNull();
    const sw = byId<HTMLButtonElement>('pickup-other-day')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click();
    await render();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(byId('pickup-day')).not.toBeNull();
    expect(cmp()['progress']().done).toBe(0); // falta o dia: o card 2 deixa de estar pronto
    patch({ pickupDay: '2026-12-30' });
    cmp()['markTouched']('pickupDay');
    await render();
    expect(text()).toContain('A retirada precisa ser entre 24/11 e 22/12.');
    patch({ pickupDay: '2026-11-26' });
    await render();
    expect(text()).not.toContain('A retirada precisa ser entre');
  });

  it('card 2: escolher a retirada pelo calendário grava a data e a 1ª cobrança a acompanha', async () => {
    await mount();
    byId<HTMLButtonElement>('start-date')!.click();
    await render();
    (el().querySelector('[data-day="2026-11-24"]') as HTMLElement).click();
    await render();
    expect(cmp()['form'].controls.startDate.value).toBe('2026-11-24');
    expect(cmp()['form'].controls.firstPaymentDate.value).toBe('2026-11-24');
    expect(text()).toContain('Pega na terça, 24/11');
    patch({ startDate: '2026-11-25' });
    expect(cmp()['form'].controls.firstPaymentDate.value).toBe('2026-11-25');
    patch({ firstPaymentDate: '2026-11-30' });
    patch({ startDate: '2026-11-26' });
    expect(cmp()['form'].controls.firstPaymentDate.value).toBe('2026-11-30');
  });

  it('sem período, ninguém está ocupado; com período, a busca de livres apaga quem cruza, e a escolha que deixou de estar livre cai com aviso', async () => {
    const calls: Array<Record<string, unknown>> = [];
    vehiclesList = (params) => {
      calls.push(params);
      if (!params['availableForRental']) return of({ content: VEHICLES, page: 0, size: 500, total: 3 });
      // veh-2 tem reserva de 01/03 a 01/04/2027.
      const overlaps = String(params['periodStart']) <= '2027-04-01' && String(params['periodEnd']) >= '2027-03-01';
      return of({ content: overlaps ? [VEHICLES[0]] : VEHICLES, page: 0, size: 500, total: 0 });
    };
    await mount();
    expect(calls.some((c) => c['availableForRental'])).toBe(false);
    await openAndPick('vehicle', 'veh-2');
    expect(cmp()['form'].controls.vehicleId.value).toBe('veh-2');

    patch({ startDate: '2026-11-24', endDate: '2027-02-07' });
    await render();
    expect(calls).toContainEqual(
      expect.objectContaining({ availableForRental: true, periodStart: '2026-11-24', periodEnd: '2027-02-07' }),
    );
    expect(cmp()['form'].controls.vehicleId.value).toBe('veh-2');

    patch({ startDate: '2027-02-15', endDate: '2027-03-15' });
    await render();
    expect(cmp()['form'].controls.vehicleId.value).toBe('');
    expect(text()).toContain('O veículo escolhido não está livre nessas datas');
    byId<HTMLButtonElement>('vehicle')!.click();
    await render();
    const busy = byId('vehicle-veh-2')!;
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(busy.textContent).toContain('Com outro aluguel nessas datas');
    expect(byId('vehicle-veh-1')!.getAttribute('aria-disabled')).toBeNull();
  });

  it('falha ao carregar motoristas ou carros mostra o erro e "Tentar de novo"', async () => {
    let fail = true;
    vehiclesList = () => (fail ? throwError(() => new Error('500')) : of({ content: VEHICLES, page: 0, size: 500, total: 3 }));
    await mount();
    expect(byId('pickers-failed')?.textContent).toContain('Não deu para carregar');
    fail = false;
    (byId('pickers-failed')!.querySelector('button') as HTMLButtonElement).click();
    await render();
    expect(byId('pickers-failed')).toBeNull();
    byId<HTMLButtonElement>('vehicle')!.click();
    await render();
    expect(text()).toContain('HB20');
  });

  it('o "Novo aluguel" da página do carro chega com ?vehicleId= e o carro já vem escolhido', async () => {
    queryVehicleId = 'veh-1';
    await mount();
    expect(cmp()['form'].controls.vehicleId.value).toBe('veh-1');
    expect(byId('vehicle')!.textContent).toContain('RDC-4A21 · Chevrolet Onix 1.0');
  });

  it('rascunho por usuário e empresa, em chave nova: sair e voltar devolve a página; "Começar do zero" apaga', async () => {
    sessionStorage.setItem('id', 'user-1');
    sessionStorage.setItem('selectedCompanyId', 'co-1');
    sessionStorage.setItem('rentalWizardDraft:user-1:co-1', JSON.stringify({ v: 2, form: { driverId: 'drv-1' } }));
    await mount();
    expect(byId('draft-restored')).toBeNull(); // o rascunho do passo a passo não vale aqui
    expect(cmp()['form'].controls.driverId.value).toBe('');
    // A página como nasce não é rascunho: a próxima visita não diria "continuamos".
    expect(sessionStorage.getItem('rentalCreateDraft:user-1:co-1')).toBeNull();
    patch({ driverId: 'drv-2', vehicleId: 'veh-1', startDate: '2026-11-24', endDate: '2026-12-22' });
    await render();
    expect(sessionStorage.getItem('rentalCreateDraft:user-1:co-1')).toContain('drv-2');

    fixture.destroy();
    TestBed.resetTestingModule();
    queryVehicleId = 'veh-2'; // o rascunho vence o ?vehicleId=
    await mount();
    expect(byId('draft-restored')).not.toBeNull();
    expect(cmp()['form'].controls.driverId.value).toBe('drv-2');
    expect(cmp()['form'].controls.vehicleId.value).toBe('veh-1');
    expect(cmp()['form'].controls.endDate.value).toBe('2026-12-22');
    expect(byId('create-progress')!.textContent).toContain('25% concluído');

    (byId('draft-restored')!.querySelector('button') as HTMLButtonElement).click();
    await render();
    expect(sessionStorage.getItem('rentalCreateDraft:user-1:co-1')).toBeNull();
  });

  it('initialsOf: primeira e última palavra', () => {
    expect(initialsOf('Carlos Henrique Souza')).toBe('CS');
    expect(initialsOf('Ana')).toBe('A');
    expect(initialsOf('  ')).toBe('');
  });

  // ================================================================ entrega 2: cards 3 e 4
  const click = async (id: string): Promise<void> => {
    byId<HTMLButtonElement>(id)!.click();
    await render();
  };
  const checked = (id: string): string | null => byId(id)!.getAttribute('aria-checked');

  it('caução: "Valor cheio" exclui as outras; desconto e parcelar vão juntos; tirar as duas volta o valor cheio', async () => {
    await mount();
    patch({ automaticCharge: true }); // F3: parcelar a caução só com a cobrança pelo Asaas
    patch({ caucaoReais: '1.200,00' });
    await render();
    expect(checked('caucao-full')).toBe('true');
    await click('caucao-desc');
    await click('caucao-split');
    expect([checked('caucao-full'), checked('caucao-desc'), checked('caucao-split')]).toEqual(['false', 'true', 'true']);
    await click('caucao-full');
    expect([checked('caucao-full'), checked('caucao-desc'), checked('caucao-split')]).toEqual(['true', 'false', 'false']);
    await click('caucao-desc');
    await click('caucao-desc');
    expect(checked('caucao-full')).toBe('true');
  });

  it('caução: desconto mostra "Ele paga R$ 1.000,00 de caução."; parcelar nasce em 2 partes que somam a caução líquida', async () => {
    await mount();
    patch({ automaticCharge: true }); // F3: parcelar a caução só com a cobrança pelo Asaas
    patch({ startDate: '2026-11-24', endDate: '2026-12-22', caucaoReais: '1.200,00' });
    await click('caucao-desc');
    patch({ caucaoDiscount: '200,00' });
    await render();
    expect(byId('caucao-net')!.textContent).toContain('Ele paga R$ 1.000,00 de caução.');
    await click('caucao-split');
    expect(cmp()['caucaoParts'].getRawValue()).toEqual([
      { amount: '500,00', due: '2026-11-24' },
      { amount: '500,00', due: '2026-12-08' },
    ]);
    expect(byId('caucao-sum')!.textContent).toContain('As partes somam R$ 1.000,00');
    // Digitada à mão (só assim a divisão automática para).
    const part1 = byId<HTMLInputElement>('caucao-part-1')!;
    part1.value = '400,00';
    part1.dispatchEvent(new Event('input'));
    await render();
    expect(cmp()['caucaoParts'].at(1).controls.amount.value).toBe('400,00');
    expect(byId('caucao-sum')!.textContent).toContain('Precisam somar R$ 1.000,00');
    await click('caucao-add');
    expect(cmp()['caucaoParts'].at(2).controls.amount.value).toBe('100,00');
    expect(byId('caucao-sum')!.textContent).toContain('As partes somam R$ 1.000,00');
    await click('caucao-remove-2');
    expect(cmp()['caucaoParts'].length).toBe(2);
  });

  it('F3 — "Eu recebo por fora": a caução não tem "Parcelar", o card diz o porquê e o plano vai sem CAUCAO', async () => {
    await mount();
    patch({ startDate: '2026-11-24', endDate: '2026-12-22', caucaoReais: '1.200,00', automaticCharge: true });
    await render();
    await click('caucao-split');
    expect(checked('caucao-split')).toBe('true');
    patch({ automaticCharge: false });
    await render();
    expect(byId('caucao-split')).toBeNull();
    expect(byId('caucao-split-manual-note')!.textContent).toContain('Recebendo por fora, a caução não vira');
    expect(cmp()['body']().chargePlan ?? null).toBeNull();
  });

  it('caução: "Recebi por fora" esconde as caixas e a prévia e diz o que fica anotado', async () => {
    await mount();
    patch({ caucaoReais: '1.200,00' });
    await click('caucao-paid');
    expect(byId('caucao-paid')!.getAttribute('aria-checked')).toBe('true');
    expect(byId('caucao-full')).toBeNull();
    expect(byId('caucao-preview')).toBeNull();
    expect(byId('caucao-paid-line')!.textContent).toContain('R$ 1.200,00 anotados como pagos');
    expect(text()).toContain('Nenhuma cobrança de caução vai ser enviada.');
  });

  it('o (i) abre o balão no fluxo, embaixo da linha', async () => {
    await mount();
    const tip = el().querySelector('#rc-tip-paid') as HTMLElement;
    expect(tip.hidden).toBe(true);
    (el().querySelector('[aria-controls="rc-tip-paid"]') as HTMLButtonElement).click();
    await render();
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('fora do MyCarsHub');
  });

  it('cobranças: a frase do valor, o desconto nas 2 primeiras e a prévia com o desconto em verde', async () => {
    await mount();
    patch({ startDate: '2026-11-24', endDate: '2026-12-22', periodRateReais: '600,00' });
    await render();
    expect(byId('rate-hint')!.textContent).toBe('Vence toda terça, a partir de 24/11. São 4 semanas.');
    await click('charges-desc');
    patch({ discountN: '2', discountValue: '100,00' });
    await render();
    expect(byId('discount-hint')!.textContent).toBe('As 2 primeiras saem por R$ 500,00. As outras, R$ 600,00.');
    await click('charges-preview');
    const sheet = el().querySelector('[data-testid="charges-preview-sheet"]') as HTMLElement;
    expect(sheet.textContent).toContain('R$ 2.200,00');
    expect(sheet.textContent).toContain('4 cobranças, toda terça. Sem a caução.');
    expect(sheet.textContent).toContain('− R$ 100,00');
    expect(sheet.textContent).toContain('O aluguel acaba em 22/12. Nenhuma cobrança depois disso.');
  });

  it('cobranças: parcelar nasce terça/sexta R$ 300 + 300; trocar a frequência mantém as partes dentro do período', async () => {
    await mount();
    patch({ startDate: '2026-11-24', endDate: '2026-12-22', periodRateReais: '600,00' });
    await click('charges-split');
    expect(cmp()['periodParts'].getRawValue()).toEqual([
      { amount: '300,00', offset: 0 },
      { amount: '300,00', offset: 3 },
    ]);
    const due1 = byId<HTMLSelectElement>('period-due-1')!;
    expect(due1.selectedOptions[0].textContent?.trim()).toBe('Sexta');
    expect(byId('period-sum')!.textContent).toContain('As partes somam R$ 600,00, o valor da semana');
    cmp()['periodParts'].at(1).controls.offset.setValue(5);
    await render();
    cmp()['setFrequency']('DAILY');
    await render();
    expect(cmp()['periodParts'].at(1).controls.offset.value).toBe(5);
  });

  it('o corpo do exemplo inteiro e a barra contando os cards 3 e 4', async () => {
    await mount();
    patch({ automaticCharge: true }); // F3: parcelar a caução só com a cobrança pelo Asaas
    patch({
      driverId: 'drv-1',
      vehicleId: 'veh-1',
      startDate: '2026-11-24',
      endDate: '2026-12-22',
      periodRateReais: '600,00',
      caucaoReais: '1.200,00',
    });
    await click('charges-desc');
    patch({ discountN: '2', discountValue: '100,00' });
    await click('charges-split');
    await click('caucao-desc');
    patch({ caucaoDiscount: '200,00' });
    await click('caucao-split');

    expect(cmp()['body']()).toEqual({
      vehicleId: 'veh-1',
      driverId: 'drv-1',
      startDate: '2026-11-24',
      endDate: '2026-12-22',
      periodRate: 60_000,
      billingFrequency: 'WEEKLY',
      caucaoAmount: 100_000,
      caucaoPaid: false,
      automaticCharge: true,
      initialKm: null,
      pickupDate: '2026-11-24T09:00',
      firstPaymentDate: '2026-11-24',
      lateFineType: 'PERCENT',
      lateFineValue: 0,
      franchiseKm: null,
      returnFuelPolicy: null,
      extraKmPrice: null,
      contractSource: 'MANUAL',
      chargePlan: {
        discount: { type: 'AMOUNT', value: 10_000, firstPeriods: 2 },
        defaultSplit: { count: 2, intervalDays: 3, intervalUnit: 'DAYS' },
        overrides: [
          {
            target: 'CAUCAO',
            periodIndex: null,
            instalments: [
              { dueDate: '2026-11-24', amountCents: 50_000 },
              { dueDate: '2026-12-08', amountCents: 50_000 },
            ],
          },
        ],
      },
    });
    // O preflight leva o mesmo corpo, sem o plano.
    expect(cmp()['preflightBody']().chargePlan).toBeUndefined();
    expect(cmp()['preflightBody']().caucaoAmount).toBe(100_000);
    expect(byId('create-progress')!.textContent).toContain('Etapa 5 de 8');
    expect(byId('create-progress')!.textContent).toContain('50% concluído');
  });

  // ================================================================ entrega 4a: partes que se redividem
  it('caução: enquanto ninguém digitou numa parte, elas se redividem com o total; depois da 1ª edição, não', async () => {
    await mount();
    patch({ automaticCharge: true }); // F3: parcelar a caução só com a cobrança pelo Asaas
    patch({ startDate: '2026-11-24', endDate: '2026-12-22', caucaoReais: '1.200,00' });
    await render();
    await click('caucao-split');
    patch({ caucaoReais: '1.500,00' });
    await render();
    expect(cmp()['caucaoParts'].getRawValue().map((p: Any) => p['amount'])).toEqual(['750,00', '750,00']);
    await click('caucao-add');
    expect(cmp()['caucaoParts'].getRawValue().map((p: Any) => p['amount'])).toEqual(['500,00', '500,00', '500,00']);
    patch({ caucaoReais: '1.000,01' });
    await render();
    expect(cmp()['caucaoParts'].getRawValue().map((p: Any) => p['amount'])).toEqual(['333,33', '333,33', '333,35']);

    // O usuário digita numa parte: a divisão para, e a linha da soma fica vermelha até ele corrigir.
    const input = byId<HTMLInputElement>('caucao-part-0')!;
    input.value = '400,00';
    input.dispatchEvent(new Event('input'));
    await render();
    expect(cmp()['caucaoPartsEdited']()).toBe(true);
    patch({ caucaoReais: '2.000,00' });
    await render();
    expect(cmp()['caucaoParts'].at(1).controls.amount.value).toBe('333,33');
    expect(byId('caucao-sum')!.getAttribute('role')).toBe('alert');
    expect(byId('caucao-sum')!.textContent).toContain('Precisam somar R$ 2.000,00');
  });

  it('cobranças: as partes acompanham o valor da semana até a 1ª edição', async () => {
    await mount();
    patch({ startDate: '2026-11-24', endDate: '2026-12-22', periodRateReais: '600,00' });
    await click('charges-split');
    patch({ periodRateReais: '700,00' });
    await render();
    expect(cmp()['periodParts'].getRawValue().map((p: Any) => p['amount'])).toEqual(['350,00', '350,00']);
    const input = byId<HTMLInputElement>('period-part-1')!;
    input.value = '300,00';
    input.dispatchEvent(new Event('input'));
    await render();
    patch({ periodRateReais: '800,00' });
    await render();
    expect(cmp()['periodParts'].at(0).controls.amount.value).toBe('350,00');
    expect(byId('period-sum')!.textContent).toContain('Precisam somar R$ 800,00');
  });

  // ================================================================ entrega 4a: fim da página
  const wait = (ms = 260): Promise<void> => new Promise((r) => setTimeout(r, ms));

  async function fillAll(): Promise<void> {
    patch({
      driverId: 'drv-2',
      vehicleId: 'veh-1',
      startDate: '2026-11-24',
      endDate: '2026-12-22',
      periodRateReais: '600,00',
      caucaoReais: '1.200,00',
      // Card 5 (a 1ª cobrança já acompanha a retirada); 6, 7 e 8 não têm obrigatório.
      initialKm: '45.820',
      lateFineValue: '2',
    });
    await render();
  }

  it('Criar com coisas faltando: "Faltam N coisas", uma linha por card e "Ir" leva ao card', async () => {
    await mount();
    patch({
      driverId: 'drv-2',
      startDate: '2026-11-24',
      endDate: '2026-12-22',
      periodRateReais: '600,00',
      caucaoReais: '0',
      lateFineValue: '2',
    });
    await render();
    expect(byId('create-missing')).toBeNull();
    await click('create-submit');
    const box = byId('create-missing')!;
    expect(box.getAttribute('role')).toBe('alert');
    expect(box.textContent).toContain('Faltam 2 coisas para criar');
    expect(byId('missing-0')!.textContent).toContain('Motorista e veículo');
    expect(byId('missing-0')!.textContent).toContain('Escolha o carro.');
    expect(byId('missing-4')!.textContent).toContain('Condições de pagamento');
    expect(byId('missing-4')!.textContent).toContain('Informe o km do carro na retirada.');
    expect(preflight).not.toHaveBeenCalled();
    // Depois do Criar, os erros dos campos aparecem sem esperar a visita.
    expect(byId('vehicle')!.getAttribute('aria-invalid')).toBe('true');
    await click('missing-0');
    expect(document.activeElement?.id).toBe('rc-c1');
  });

  it('a barra vai a 100% com todos os cards prontos', async () => {
    await mount();
    await fillAll();
    expect(byId('create-progress')!.textContent).toContain('Etapa 8 de 8');
    expect(byId('create-progress')!.textContent).toContain('100% concluído');
  });

  it('tudo pronto: preflight sem o plano, prévia com o plano, Confira com os números do SERVIDOR; criar envia o corpo da prévia', async () => {
    sessionStorage.setItem('id', 'user-1');
    sessionStorage.setItem('selectedCompanyId', 'co-1');
    await mount();
    await fillAll();
    await click('charges-desc');
    patch({ discountN: '2', discountValue: '100,00' });
    await render();
    expect(sessionStorage.getItem('rentalCreateDraft:user-1:co-1')).not.toBeNull();
    await click('create-submit');
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(preflight.mock.calls[0][0]).not.toHaveProperty('chargePlan');
    expect(chargePreview.mock.calls[0][0].chargePlan.discount).toEqual({ type: 'AMOUNT', value: 10_000, firstPeriods: 2 });
    const sheet = byId('confirm-sheet')!;
    expect(byId('confirm-caucao')!.textContent).toContain('R$ 1.199,99'); // o do servidor, não o da tela
    expect(sheet.textContent).toContain('João Pedro Alves · RDC-4A21');
    expect(sheet.textContent).toContain('24/11 a 22/12 · 4 semanas');
    expect(byId('confirm-say')!.textContent).toContain(
      'Ao criar, nada é enviado para ele. As 5 cobranças ficam anotadas quando o aluguel começar (Marcar como ativo)',
    );
    expect(byId('confirm-create')!.textContent?.trim()).toBe('Criar aluguel');
    expect(byId('confirm-lines')).toBeNull();
    await click('confirm-lines-toggle');
    expect(byId('confirm-lines')!.querySelectorAll('li')).toHaveLength(5);

    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await click('confirm-create');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0]).toEqual(chargePreview.mock.calls[0][0]);
    // Como antes (dono, 22/11): criou, vai direto para o detalhe do aluguel.
    expect(nav).toHaveBeenCalledWith(['/alugueis', 'novo']);
    expect(byId('create-done')).not.toBeNull();
    expect(text()).toContain('Aluguel criado');
    expect(text()).toContain('João Pedro Alves · RDC-4A21 · 24/11 a 22/12');
    expect(byId('done-headline')!.textContent).toContain('5 cobranças ao ativar o aluguel');
    expect(byId('done-caption')!.textContent).toContain('quando o aluguel começar (Marcar como ativo)');
    expect(byId('done-caption')!.textContent).toContain('A primeira vence terça, 24/11.');
    expect(sessionStorage.getItem('rentalCreateDraft:user-1:co-1')).toBeNull();
  });

  it('cobranças automáticas: a frase do Asaas e "Criar aluguel e cobranças"; falha da sincronização no fim', async () => {
    createSpy.mockReturnValue(of({ id: 'novo', chargeSync: { requested: 5, created: 3, failed: 2, local: 0 } }));
    asaasConnected = true;
    await mount();
    await fillAll();
    // Com a cobrança por Pix ligada, o padrão já é "Cobranças automáticas" (como no passo a passo).
    expect(cmp()['form'].controls.automaticCharge.value).toBe(true);
    await click('create-submit');
    expect(byId('confirm-say')!.textContent).toContain('vão para a sua conta Asaas agora');
    expect(byId('confirm-say')!.textContent).toContain('(4 semanas e a caução)');
    expect(byId('confirm-create')!.textContent?.trim()).toBe('Criar aluguel e cobranças');
    await click('confirm-create');
    expect(byId('done-sync-failed')!.textContent).toContain('2 cobrança(s) não saíram agora');
  });

  it('"Mudar" no Confira fecha a folha e leva ao card', async () => {
    await mount();
    await fillAll();
    await click('create-submit');
    await click('confirm-change-1');
    await wait();
    await render();
    expect(byId('confirm-sheet')).toBeNull();
    expect(document.activeElement?.id).toBe('rc-c2');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('bloqueio da prévia: "Não dá para criar ainda", "Nada foi criado." e só "Voltar e editar"', async () => {
    chargePreview.mockReturnValue(of({ ...SERVER_PREVIEW, blocker: { code: 'CHARGE_BELOW_MINIMUM', message: 'abaixo' } }));
    await mount();
    await fillAll();
    await click('create-submit');
    const sheet = byId('blocked-sheet')!;
    expect(sheet.textContent).toContain('Nada foi criado.');
    expect(text()).toContain('Não dá para criar ainda');
    expect(byId('confirm-sheet')).toBeNull();
    await click('blocked-back');
    await wait();
    await render();
    expect(byId('blocked-sheet')).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('recusa do preflight com campo: o motivo no aviso, o erro no campo e o card deixa de estar pronto até mudar', async () => {
    preflight.mockReturnValue(of({
      ok: false,
      issues: [{ field: 'vehicleId', code: 'VEHICLE_BUSY', message: 'O carro já está em outro aluguel nessas datas.', acceptedValue: null, severity: 'BLOCKING' }],
      warnings: [],
      limits: null,
    }));
    await mount();
    await fillAll();
    await click('create-submit');
    expect(byId('blocked-sheet')!.textContent).toContain('O carro já está em outro aluguel nessas datas.');
    expect(chargePreview).not.toHaveBeenCalled();
    expect(cmp()['cardStatus']()[0].complete).toBe(false);
    expect(el().querySelector('app-rc-driver-vehicle')!.textContent).toContain('já está em outro aluguel');
    patch({ vehicleId: 'veh-2' });
    await render();
    expect(cmp()['cardStatus']()[0].complete).toBe(true);
  });

  it('recusa de integração vira copy pt-BR sem o nome do provedor, com o atalho', async () => {
    preflight.mockReturnValue(of({
      ok: false,
      issues: [{ field: null, code: 'ASAAS_KEY_REVOKED', message: 'O Asaas recusou a chave de API.', acceptedValue: null, severity: 'BLOCKING' }],
      warnings: [],
      limits: null,
    }));
    await mount();
    await fillAll();
    await click('create-submit');
    const sheet = byId('blocked-sheet')!.textContent ?? '';
    expect(sheet).not.toMatch(/asaas/i);
    expect(sheet).toContain('Refaça a ligação');
    expect(sheet).toContain('Abrir Configurações > Integrações');
  });

  it('409 ao criar: o aviso com o motivo do servidor e nada criado', async () => {
    createSpy.mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 409,
      error: { message: 'O carro RDC-4A21 já está em outro aluguel de 01/12 a 10/12.' },
    })));
    await mount();
    await fillAll();
    await click('create-submit');
    await click('confirm-create');
    expect(byId('confirm-sheet')).toBeNull();
    expect(byId('blocked-sheet')!.textContent).toContain('Nada foi criado.');
    expect(byId('create-done')).toBeNull();
  });

  describe('"Bloquear sempre": motorista/carro com aluguel em aberto', () => {
    const ACTIVE_UNTIL_30_11 = { status: 'ACTIVE', startDate: '2026-11-01', endDate: '2026-11-30' };
    const RESERVED_JAN = { status: 'RESERVED', startDate: '2027-01-10', endDate: '2027-02-07' };

    it('a lista mostra o preso apagado, com o motivo dele, e não deixa escolher', async () => {
      driversList = () =>
        of({ content: [DRIVERS[0], { ...DRIVERS[1], openRental: ACTIVE_UNTIL_30_11 }], page: 0, size: 500, total: 2 });
      vehiclesList = () =>
        of({ content: [{ ...VEHICLES[0], openRental: RESERVED_JAN }, VEHICLES[1]], page: 0, size: 500, total: 2 });
      await mount();

      byId<HTMLButtonElement>('driver')!.click();
      await render();
      const busyDriver = byId('driver-drv-2')!;
      expect(busyDriver.getAttribute('aria-disabled')).toBe('true');
      expect(busyDriver.textContent).toContain('Em aluguel até 30/11');
      expect(byId('driver-drv-1')!.getAttribute('aria-disabled')).toBeNull();
      busyDriver.click();
      await render();
      expect(cmp()['form'].controls.driverId.value).toBe('');

      byId<HTMLButtonElement>('vehicle')!.click();
      await render();
      const busyCar = byId('vehicle-veh-1')!;
      expect(busyCar.getAttribute('aria-disabled')).toBe('true');
      // fora do ano corrente (hoje = 20/11/2026), a data leva o ano
      expect(busyCar.textContent).toContain('Reservado de 10/01/2027 a 07/02/2027');
    });

    it('rascunho cujo motorista agora está preso: o erro aparece no campo na hora e o card não fica pronto', async () => {
      sessionStorage.setItem('id', 'user-1');
      sessionStorage.setItem('selectedCompanyId', 'co-1');
      sessionStorage.setItem(
        'rentalCreateDraft:user-1:co-1',
        JSON.stringify({ v: 1, form: { driverId: 'drv-2', vehicleId: 'veh-2' } }),
      );
      driversList = () =>
        of({ content: [DRIVERS[0], { ...DRIVERS[1], openRental: RESERVED_JAN }], page: 0, size: 500, total: 2 });
      await mount();

      expect(cmp()['form'].controls.driverId.value).toBe('drv-2');
      expect(el().querySelector('app-rc-driver-vehicle')!.textContent).toContain(
        'Este motorista já tem um aluguel reservado de 10/01/2027 a 07/02/2027. Conclua ou cancele esse aluguel antes de criar outro.',
      );
      expect(byId('driver')!.getAttribute('aria-invalid')).toBe('true');
      expect(cmp()['cardStatus']()[0].complete).toBe(false);
    });

    it('409 DRIVER_HAS_OPEN_RENTAL ao criar: a mensagem do servidor vai ao campo do motorista, sem atalho de cadastro', async () => {
      const message = 'Este motorista já está em um aluguel (ativo até 30/11). Conclua ou cancele esse aluguel antes de criar outro.';
      createSpy.mockReturnValue(throwError(() => new HttpErrorResponse({
        status: 409,
        error: { message, code: 'DRIVER_HAS_OPEN_RENTAL', fieldErrors: { driverId: message } },
      })));
      // outro operador reservou o motorista: a lista recarregada já traz o aluguel dele
      let driverLoads = 0;
      driversList = (params) => {
        if (!params['availableForRental']) driverLoads++;
        const busy = driverLoads > 1 ? { openRental: ACTIVE_UNTIL_30_11 } : {};
        return of({ content: [DRIVERS[0], { ...DRIVERS[1], ...busy }], page: 0, size: 500, total: 2 });
      };
      await mount();
      await fillAll();
      await click('create-submit');
      await click('confirm-create');
      await render();

      // depois do 409 a lista volta com o motivo, e a opção recusada fica apagada
      expect(driverLoads).toBe(2);
      byId<HTMLButtonElement>('driver')!.click();
      await render();
      expect(byId('driver-drv-2')!.getAttribute('aria-disabled')).toBe('true');
      expect(byId('driver-drv-2')!.textContent).toContain('Em aluguel até 30/11');
      byId<HTMLButtonElement>('driver')!.click();
      await render();

      expect(byId('create-done')).toBeNull();
      expect(el().querySelector('app-rc-driver-vehicle')!.textContent).toContain(message);
      expect(cmp()['cardStatus']()[0].complete).toBe(false);
      expect(byId('blocked-sheet')!.textContent).toContain(message);
      expect(byId('blocked-sheet')!.textContent).not.toContain('Abrir o cadastro do motorista');
    });

    it('409 com motorista E carro presos: os dois campos mostram a frase de cada um', async () => {
      const driverMsg = 'Este motorista já está em um aluguel (ativo até 30/11). Conclua ou cancele esse aluguel antes de criar outro.';
      const carMsg = 'Este carro já está reservado de 01/12 a 20/12. Conclua ou cancele esse aluguel antes de criar outro.';
      createSpy.mockReturnValue(throwError(() => new HttpErrorResponse({
        status: 409,
        error: {
          message: 'os dois',
          code: 'DRIVER_HAS_OPEN_RENTAL',
          fieldErrors: { driverId: driverMsg, vehicleId: carMsg },
        },
      })));
      await mount();
      await fillAll();
      await click('create-submit');
      await click('confirm-create');

      const card = el().querySelector('app-rc-driver-vehicle')!.textContent ?? '';
      expect(card).toContain(driverMsg);
      expect(card).toContain(carMsg);
      expect(byId('driver')!.getAttribute('aria-invalid')).toBe('true');
      expect(byId('vehicle')!.getAttribute('aria-invalid')).toBe('true');
    });

    it('preflight com VEHICLE_HAS_OPEN_RENTAL: o erro no campo do carro e nada vai à prévia', async () => {
      const message = 'Este carro já está reservado de 10/01 a 07/02. Conclua ou cancele esse aluguel antes de criar outro.';
      preflight.mockReturnValue(of({
        ok: false,
        issues: [{ field: 'vehicleId', code: 'VEHICLE_HAS_OPEN_RENTAL', message, acceptedValue: null, severity: 'BLOCKING' }],
        warnings: [],
        limits: null,
      }));
      await mount();
      await fillAll();
      await click('create-submit');

      expect(chargePreview).not.toHaveBeenCalled();
      expect(el().querySelector('app-rc-driver-vehicle')!.textContent).toContain(message);
      expect(byId('vehicle')!.getAttribute('aria-invalid')).toBe('true');
    });
  });

  it('prévia falhou (rede): "Tentar de novo" e nada sai; na 2ª, o Confira abre', async () => {
    chargePreview.mockImplementationOnce(() => throwError(() => new Error('timeout')));
    await mount();
    await fillAll();
    await click('create-submit');
    expect(byId('check-failed')!.textContent).toContain('Nada foi criado.');
    expect(byId('confirm-sheet')).toBeNull();
    await click('retry-check');
    expect(byId('check-failed')).toBeNull();
    expect(byId('confirm-sheet')).not.toBeNull();
  });

  it('dados da locadora incompletos e não completados: nada é enviado', async () => {
    contactOk = false;
    await mount();
    await fillAll();
    await click('create-submit');
    await click('confirm-create');
    expect(createSpy).not.toHaveBeenCalled();
    expect(byId('confirm-sheet')).not.toBeNull();
  });

  it('"Cancelar" volta à lista e mantém o rascunho', async () => {
    sessionStorage.setItem('id', 'user-1');
    sessionStorage.setItem('selectedCompanyId', 'co-1');
    await mount();
    await fillAll();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await click('create-cancel');
    expect(nav).toHaveBeenCalledWith(['/alugueis']);
    expect(sessionStorage.getItem('rentalCreateDraft:user-1:co-1')).not.toBeNull();
  });

  // ================================================================ entrega 4b: cards 5 a 8 ligados
  it('modelo de contrato configurado: o card 6 nasce ligado (AUTO) e desligá-lo manda MANUAL', async () => {
    templateGet = () => of({ id: 'tpl' });
    await mount();
    await fillAll();
    expect(byId('contract-template')!.getAttribute('aria-checked')).toBe('true');
    expect(cmp()['body']().contractSource).toBe('AUTO');
    await click('contract-template');
    expect(cmp()['body']().contractSource).toBe('MANUAL');
  });

  it('cards 7 e 8: "Eu recebo por fora" e as observações vão no corpo', async () => {
    await mount();
    await fillAll();
    await click('pay-automatic');
    const notes = byId<HTMLTextAreaElement>('notes')!;
    notes.value = 'Entrega na oficina.';
    notes.dispatchEvent(new Event('input'));
    await render();
    const body = cmp()['body']();
    expect(body.automaticCharge).toBe(false);
    expect(body.notes).toBe('Entrega na oficina.');
    expect(body.initialKm).toBe(45_820);
    expect(body.lateFineValue).toBe(200);
  });

  it('cobrança automática sem a conta ligada: o card 7 entra no "Faltam" com o motivo', async () => {
    await mount();
    await fillAll();
    patch({ automaticCharge: true });
    await render();
    await click('create-submit');
    expect(byId('missing-6')!.textContent).toContain('Cobrança');
    expect(byId('missing-6')!.textContent).toContain('Eu recebo por fora');
    expect(preflight).not.toHaveBeenCalled();
  });

  // ================================================================ revisão: o Confira é o que vai
  it('mudou "Como ele vai pagar" durante a conferência: a resposta é descartada e o Confira mostra o que vai', async () => {
    asaasConnected = true;
    const previews: Array<Subject<RentalChargePreviewDto>> = [];
    chargePreview.mockImplementation(() => {
      const s = new Subject<RentalChargePreviewDto>();
      previews.push(s);
      return s;
    });
    await mount();
    await fillAll();
    expect(cmp()['form'].controls.automaticCharge.value).toBe(true);
    await click('create-submit');
    expect(previews).toHaveLength(1);
    await click('pay-automatic'); // no meio da conferência
    previews[0].next(SERVER_PREVIEW);
    previews[0].complete();
    await render();
    expect(byId('confirm-sheet')).toBeNull();
    expect(byId('check-stale')!.textContent).toContain('Toque em Criar aluguel de novo');

    await click('create-submit');
    previews[1].next(SERVER_PREVIEW);
    previews[1].complete();
    await render();
    expect(byId('confirm-say')!.textContent).toContain('Ao criar, nada é enviado para ele.');
    expect(byId('confirm-create')!.textContent?.trim()).toBe('Criar aluguel');
    await click('confirm-create');
    expect(createSpy.mock.calls[0][0].automaticCharge).toBe(false);
    expect(createSpy.mock.calls[0][0]).toEqual(chargePreview.mock.calls[1][0]);
  });

  it('padrões que chegam tarde (Pix ligado, modelo de contrato) não mudam nada com o Confira aberto', async () => {
    asaasConnected = true;
    const asaas = new Subject<unknown>();
    const template = new Subject<unknown>();
    asaasLoad = () => asaas;
    templateGet = () => template;
    await mount();
    await fillAll();
    await click('create-submit');
    expect(byId('confirm-say')!.textContent).toContain('nada é enviado');
    expect(byId('confirm-sheet')!.textContent).toContain('Você envia o PDF');
    asaas.next(null);
    template.next({ id: 'tpl' });
    await render();
    expect(cmp()['form'].controls.automaticCharge.value).toBe(false);
    expect(cmp()['form'].controls.useContractTemplate.value).toBe(false);
    expect(byId('confirm-sheet')).not.toBeNull();
    await click('confirm-create');
    const sent = createSpy.mock.calls[0][0];
    expect(sent.automaticCharge).toBe(false);
    expect(sent.contractSource).toBe('MANUAL');
  });

  it('o corpo mudou com o Confira aberto: a folha fecha, a prévia some e nada é enviado', async () => {
    await mount();
    await fillAll();
    await click('create-submit');
    expect(byId('confirm-sheet')).not.toBeNull();
    patch({ periodRateReais: '700,00' });
    await render();
    expect(byId('confirm-sheet')).toBeNull();
    expect(byId('check-stale')).not.toBeNull();
    cmp()['confirmCreate']();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('a recusa da caução some ao mudar o desconto (o valor enviado é o líquido)', async () => {
    preflight.mockReturnValue(of({
      ok: false,
      issues: [{ field: 'caucaoAmount', code: 'CAUCAO_TOO_HIGH', message: 'A caução passa do limite.', acceptedValue: null, severity: 'BLOCKING' }],
      warnings: [],
      limits: null,
    }));
    await mount();
    await fillAll();
    await click('create-submit');
    expect(cmp()['serverFieldErrors']()).toHaveProperty('caucaoReais');
    patch({ caucaoDescOn: true, caucaoDiscount: '200,00' });
    await render();
    expect(cmp()['serverFieldErrors']()).not.toHaveProperty('caucaoReais');
  });

  it('bloqueio da prévia que fala da caução volta ao card Caução', async () => {
    chargePreview.mockReturnValue(of({
      ...SERVER_PREVIEW,
      blocker: { code: 'INSTALMENTS_SUM_MISMATCH', message: 'As parcelas da caução somam R$ 900,00.' },
    }));
    await mount();
    await fillAll();
    await click('create-submit');
    await click('blocked-back');
    await wait();
    await render();
    expect(document.activeElement?.id).toBe('rc-c3');
  });

  it('dados da locadora incompletos no POST: enquanto a pergunta está aberta, um 2º toque não manda outro POST', async () => {
    const prompt = new Subject<boolean>();
    promptAfter = () => prompt;
    createSpy.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'COMPANY_CONTACT_INCOMPLETE' } })));
    await mount();
    await fillAll();
    await click('create-submit');
    await click('confirm-create');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(byId<HTMLButtonElement>('confirm-create')!.disabled).toBe(true);
    cmp()['confirmCreate']();
    await click('confirm-create');
    expect(createSpy).toHaveBeenCalledTimes(1);
    prompt.next(true);
    prompt.complete();
    await render();
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(byId('create-done')).not.toBeNull();
  });

  it('rascunho só depois de uma edição: os padrões sozinhos não criam rascunho', async () => {
    sessionStorage.setItem('id', 'user-1');
    sessionStorage.setItem('selectedCompanyId', 'co-1');
    asaasConnected = true;
    templateGet = () => of({ id: 'tpl' });
    queryVehicleId = 'veh-1';
    await mount();
    expect(cmp()['form'].controls.automaticCharge.value).toBe(true);
    expect(cmp()['form'].controls.useContractTemplate.value).toBe(true);
    expect(sessionStorage.getItem('rentalCreateDraft:user-1:co-1')).toBeNull();
    await openAndPick('driver', 'drv-2');
    expect(sessionStorage.getItem('rentalCreateDraft:user-1:co-1')).toContain('drv-2');
  });

  it('rascunho com cobrança automática e o Pix desligado agora: volta a "Eu recebo por fora"', async () => {
    sessionStorage.setItem('id', 'user-1');
    sessionStorage.setItem('selectedCompanyId', 'co-1');
    sessionStorage.setItem(
      'rentalCreateDraft:user-1:co-1',
      JSON.stringify({ v: 1, form: { driverId: 'drv-2', automaticCharge: true }, parts: [], selected: [], selectedFreq: 'WEEKLY' }),
    );
    await mount();
    expect(byId('draft-restored')).not.toBeNull();
    expect(cmp()['form'].controls.driverId.value).toBe('drv-2');
    expect(cmp()['form'].controls.automaticCharge.value).toBe(false);
  });

  it('Confira sem caução: só o cartão do Aluguel; caução recebida por fora: o verde com "Recebida por fora"', async () => {
    chargePreview.mockReturnValue(of({ ...SERVER_PREVIEW, charges: SERVER_PREVIEW.charges.filter((c) => c.kind !== 'CAUCAO') }));
    await mount();
    await fillAll();
    patch({ caucaoReais: '0' });
    await click('create-submit');
    expect(byId('confirm-sheet')).not.toBeNull();
    expect(byId('confirm-caucao')).toBeNull();
    expect(byId('confirm-sheet')!.textContent).not.toContain('Sem caução');
    await click('confirm-back');
    await wait();
    await render();

    patch({ caucaoReais: '1.200,00' });
    await click('caucao-paid');
    await click('create-submit');
    expect(byId('confirm-caucao')!.textContent).toContain('R$ 1.200,00');
    expect(byId('confirm-caucao-caption')!.textContent?.trim()).toBe('Recebida por fora');
  });

  it('a barra só conta Contrato, Cobrança e Observações depois dos cards de cima', async () => {
    await mount();
    expect(byId('create-progress')!.textContent).toContain('0% concluído');
    await fillAll();
    expect(byId('create-progress')!.textContent).toContain('100% concluído');
  });
  // ================================================================ V151 · tempo mínimo (RenPerF1/F5/G4, RenCobK5)
  describe('"Fica pelo menos até uma data" (tempo mínimo)', () => {
    async function pickMinimum(): Promise<void> {
      byId<HTMLButtonElement>('until-minimum')!.click();
      await render();
    }

    it('a escolha troca o campo para "Fica pelo menos até" e mostra a frase da prancha F5', async () => {
      await mount();
      await fillAll();
      await pickMinimum();
      expect(byId('until-minimum')!.getAttribute('aria-checked')).toBe('true');
      expect(byId('until-fixed')!.getAttribute('aria-checked')).toBe('false');
      expect(text()).toContain('Fica pelo menos até');
      expect(text()).not.toContain('Devolve em');
      expect(byId('period-sentence')!.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'A partir de 24/11, no mínimo 4 semanas. Perto de 22/12 a gente te avisa para renovar.',
      );
    });

    it('o corpo leva endDate + minimumTerm: true; Confira e "Aluguel criado" falam do mínimo', async () => {
      await mount();
      await fillAll();
      await pickMinimum();
      await click('create-submit');
      const sent = chargePreview.mock.calls[0][0];
      expect(sent.endDate).toBe('2026-12-22');
      expect(sent.minimumTerm).toBe(true);
      expect(preflight.mock.calls[0][0]).not.toHaveProperty('minimumTerm');
      expect(byId('confirm-sheet')!.textContent).toContain('24/11 a 22/12 · no mínimo 4 semanas');
      await click('confirm-create');
      expect(createSpy.mock.calls[0][0]).toEqual(sent);
      expect(byId('done-caption')!.textContent).toContain('Perto de 22/12 a gente te avisa para renovar.');
    });

    it('"Tem data para devolver": o corpo é o de antes, sem minimumTerm', async () => {
      await mount();
      await fillAll();
      await click('create-submit');
      expect(chargePreview.mock.calls[0][0]).not.toHaveProperty('minimumTerm');
    });

    it('por semana a data mínima arredonda para semanas inteiras; por dia, não', async () => {
      await mount();
      await fillAll();
      await pickMinimum();
      cmp()['patchPeriod']({ endDate: '2026-12-20' });
      await render();
      expect(cmp()['form'].controls.endDate.value).toBe('2026-12-22');
      cmp()['setFrequency']('DAILY');
      cmp()['patchPeriod']({ endDate: '2026-12-20' });
      await render();
      expect(cmp()['form'].controls.endDate.value).toBe('2026-12-20');
      cmp()['setFrequency']('WEEKLY');
      await render();
      expect(cmp()['form'].controls.endDate.value).toBe('2026-12-22');
    });

    it('voltar para "Tem data para devolver" devolve a data escolhida e não mexe mais nela', async () => {
      await mount();
      await fillAll();
      await pickMinimum();
      cmp()['patchPeriod']({ endDate: '2026-12-20' });
      await render();
      expect(cmp()['form'].controls.endDate.value).toBe('2026-12-22');
      byId<HTMLButtonElement>('until-fixed')!.click();
      await render();
      expect(cmp()['form'].controls.endDate.value).toBe('2026-12-20');
      cmp()['patchPeriod']({ endDate: '2026-12-19' });
      await render();
      expect(cmp()['form'].controls.endDate.value).toBe('2026-12-19');
    });

    it('mudar a retirada 3 vezes não empurra o fim: o arredondamento sai sempre da data escolhida', async () => {
      await mount();
      await fillAll();
      await pickMinimum();
      cmp()['patchPeriod']({ endDate: '2026-12-22' });
      await render();
      const ends: string[] = [];
      for (const start of ['2026-11-25', '2026-11-26', '2026-11-24']) {
        cmp()['patchPeriod']({ startDate: start });
        await render();
        ends.push(cmp()['form'].controls.endDate.value);
      }
      // 25/11→22/12 = 27 dias → 4 semanas (23/12); 26/11 → 24/12; de volta a 24/11 → 22/12.
      expect(ends).toEqual(['2026-12-23', '2026-12-24', '2026-12-22']);
      expect(byId('period-sentence')!.textContent).toContain('no mínimo 4 semanas');
    });

    it('rascunho antigo (sem minimumTerm) volta em "Tem data para devolver"; o novo guarda a escolha', async () => {
      sessionStorage.setItem('id', 'user-1');
      sessionStorage.setItem('selectedCompanyId', 'co-1');
      const draft = { v: 1, form: { startDate: '2026-11-24', endDate: '2026-12-22' }, parts: [], selected: [], selectedFreq: 'WEEKLY' };
      sessionStorage.setItem('rentalCreateDraft:user-1:co-1', JSON.stringify(draft));
      await mount();
      expect(cmp()['form'].controls.minimumTerm.value).toBe(false);
      expect(byId('until-fixed')!.getAttribute('aria-checked')).toBe('true');
      await pickMinimum();
      expect(JSON.parse(sessionStorage.getItem('rentalCreateDraft:user-1:co-1')!).form.minimumTerm).toBe(true);

      TestBed.resetTestingModule();
      await mount();
      expect(byId('until-minimum')!.getAttribute('aria-checked')).toBe('true');
    });
  });
});
