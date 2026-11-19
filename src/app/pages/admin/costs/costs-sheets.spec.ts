import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorService } from '../../../services/api-error.service';
import { AdminFinanceService } from '../finance/admin-finance.service';
import { CostEntrySheet } from './cost-entry-sheet';
import { cost, schedule, vendor } from './costs.testing';
import { FixedCostChangeSheet } from './fixed-cost-change-sheet';
import { FixedCostSheet, parseBillingDay } from './fixed-cost-sheet';
import { NEW_VENDOR } from './vendor-fields';

const RENDER = vendor();
const ADS = vendor({ id: 'v-ads', name: 'Google Ads', category: 'ACQUISITION' });

function finance() {
  return {
    createVendor: vi.fn((body: object) => of({ ...body, id: 'v-new', active: true })),
    updateVendor: vi.fn(),
    createSchedule: vi.fn((body: object) => of(schedule(body))),
    updateSchedule: vi.fn((id: string, body: object) => of(schedule({ id, ...body }))),
    changeAmount: vi.fn((id: string) => of(schedule({ id: `${id}-next` }))),
    endSchedule: vi.fn((id: string) => of(schedule({ id }))),
    createCost: vi.fn((body: object) => of(cost(body))),
    updateCost: vi.fn((id: string, body: object) => of(cost({ id, ...body }))),
    revertCost: vi.fn((id: string) => of(cost({ id, overridden: false }))),
    deleteCost: vi.fn(),
  };
}

function mount<T>(component: Type<T>, inputs: Record<string, unknown>) {
  const svc = finance();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [component],
    providers: [
      provideNoopAnimations(),
      { provide: AdminFinanceService, useValue: svc },
      { provide: ApiErrorService, useValue: { claim: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(component);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  const q = <E extends Element = HTMLElement>(id: string) => document.querySelector<E>(`[data-testid="${id}"]`);
  const type = (id: string, value: string) => {
    const el = q<HTMLInputElement>(id)!;
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const select = (id: string, value: string) => {
    const el = q<HTMLSelectElement>(id)!;
    el.value = value;
    el.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  const click = (id: string) => {
    q<HTMLButtonElement>(id)!.click();
    fixture.detectChanges();
  };
  const text = (id: string) => (q(id)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { fixture, svc, q, type, select, click, text };
}

describe('FixedCostSheet — Novo custo fixo', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('dia de cobrança vai de 1 a 31', () => {
    expect(parseBillingDay('5')).toBe(5);
    expect(parseBillingDay('31')).toBe(31);
    expect(parseBillingDay('0')).toBe('invalid');
    expect(parseBillingDay('32')).toBe('invalid');
    expect(parseBillingDay('a')).toBe('invalid');
  });

  it('campos com 16px (o iPhone não dá zoom) e só Cancelar/Salvar como botões', () => {
    const { q } = mount(FixedCostSheet, { vendors: [RENDER], currentMonth: '2026-11' });
    for (const id of ['fixed-vendor', 'fixed-service', 'fixed-amount', 'fixed-day', 'fixed-start']) {
      expect(q(id)!.className, id).toContain('text-base');
    }
  });

  it('cadastra em centavos a partir do texto pt-BR, começando no mês corrente', () => {
    const { type, click, svc, text } = mount(FixedCostSheet, {
      vendors: [RENDER],
      currentMonth: '2026-11',
      currentTotalCents: 55_330,
    });
    type('fixed-service', 'Servidor da API');
    type('fixed-amount', '1.080,00');
    type('fixed-day', '15');
    expect(text('fixed-summary')).toContain('no dia 1 de cada mês');
    expect(text('fixed-summary')).toContain('o dia 15 só define o vencimento');
    click('fixed-save');
    expect(svc.createSchedule).toHaveBeenCalledWith({
      vendorId: 'v-render',
      service: 'Servidor da API',
      amountCents: 108_000,
      billingDay: 15,
      startMonth: '2026-11',
      endMonth: null,
    });
  });

  it('fornecedor novo é cadastrado antes do custo fixo', () => {
    const { type, select, click, svc } = mount(FixedCostSheet, { vendors: [RENDER], currentMonth: '2026-11' });
    select('fixed-vendor', NEW_VENDOR);
    type('vendor-name', 'Resend');
    type('fixed-service', 'Plano Pro');
    type('fixed-amount', '108,00');
    type('fixed-day', '3');
    click('fixed-save');
    expect(svc.createVendor).toHaveBeenCalledWith({ name: 'Resend', category: 'BACKEND', categoryLabel: null, active: true });
    expect(svc.createSchedule.mock.calls[0][0]).toMatchObject({ vendorId: 'v-new', amountCents: 10_800 });
  });

  it('dia inválido não sai do formulário', () => {
    const { type, click, svc, q } = mount(FixedCostSheet, { vendors: [RENDER], currentMonth: '2026-11' });
    type('fixed-service', 'X');
    type('fixed-amount', '10,00');
    type('fixed-day', '40');
    click('fixed-save');
    expect(svc.createSchedule).not.toHaveBeenCalled();
    expect(q('fixed-error')!.textContent).toContain('1 a 31');
  });

  it('editar muda só serviço e dia (PUT), sem campo de valor', () => {
    const { type, click, svc, q } = mount(FixedCostSheet, {
      vendors: [RENDER],
      currentMonth: '2026-11',
      schedule: schedule({ id: 's9', service: 'Plano Pro', billingDay: 5 }),
    });
    expect(q('fixed-amount')).toBeNull();
    type('fixed-day', '10');
    click('fixed-save');
    expect(svc.updateSchedule).toHaveBeenCalledWith('s9', { service: 'Plano Pro', billingDay: 10 });
  });
});

describe('FixedCostChangeSheet — daqui para frente e encerrar', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('muda o valor a partir do mês corrente', () => {
    const { type, click, svc } = mount(FixedCostChangeSheet, {
      mode: 'amount',
      schedule: schedule({ id: 's1', amountCents: 11_000 }),
      currentMonth: '2026-11',
    });
    type('change-amount', '120,00');
    click('change-save');
    expect(svc.changeAmount).toHaveBeenCalledWith('s1', { fromMonth: '2026-11', amountCents: 12_000 });
  });

  it('o mesmo valor de hoje não é mudança', () => {
    const { type, click, svc, q } = mount(FixedCostChangeSheet, {
      mode: 'amount',
      schedule: schedule({ amountCents: 11_000 }),
      currentMonth: '2026-11',
    });
    type('change-amount', '110,00');
    click('change-save');
    expect(svc.changeAmount).not.toHaveBeenCalled();
    expect(q('change-error')!.textContent).toContain('mesmo');
  });

  it('encerrar manda o último mês', () => {
    const { type, click, svc } = mount(FixedCostChangeSheet, {
      mode: 'end',
      schedule: schedule({ id: 's1' }),
      currentMonth: '2026-11',
    });
    type('change-month', '2026-12');
    click('change-save');
    expect(svc.endSchedule).toHaveBeenCalledWith('s1', { endMonth: '2026-12' });
  });
});

describe('CostEntrySheet — avulso e Editar lançamento', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('lança avulso no mês da lista, com vencimento opcional', () => {
    const { type, click, svc } = mount(CostEntrySheet, { vendors: [RENDER], month: '2026-11' });
    type('entry-description', 'Upgrade de disco');
    type('entry-amount', '55,00');
    click('entry-save');
    expect(svc.createCost).toHaveBeenCalledWith({
      vendorId: 'v-render',
      month: '2026-11',
      description: 'Upgrade de disco',
      amountCents: 5_500,
      dueDate: null,
      note: null,
    });
  });

  it('atalho de aquisição abre no fornecedor de aquisição', () => {
    const { q } = mount(CostEntrySheet, { vendors: [RENDER, ADS], month: '2026-11', presetCategory: 'ACQUISITION' });
    expect(q<HTMLSelectElement>('entry-vendor')!.value).toBe('v-ads');
  });

  it('editar um fixo mostra o valor guardado e "muda só este mês"; não manda descrição', () => {
    const { q, type, click, svc, text } = mount(CostEntrySheet, { vendors: [RENDER], month: '2026-11', cost: cost() });
    expect(q<HTMLInputElement>('entry-amount')!.value).toBe('168,00');
    expect(q('entry-description')).toBeNull();
    expect(text('entry-only-month')).toContain('Muda só este mês.');
    expect(text('entry-only-month')).toContain('140,00');
    type('entry-amount', '170,00');
    click('entry-save');
    expect(svc.updateCost).toHaveBeenCalledWith('c1', { amountCents: 17_000, dueDate: '2026-11-05', note: 'Instância extra' });
  });

  it('vencimento fora do mês não sai', () => {
    const { type, click, svc, q } = mount(CostEntrySheet, { vendors: [RENDER], month: '2026-11', cost: cost() });
    type('entry-due', '2026-12-01');
    click('entry-save');
    expect(svc.updateCost).not.toHaveBeenCalled();
    expect(q('entry-error')!.textContent).toContain('novembro de 2026');
  });

  it('o ⋮ da folha tem voltar ao fixo, mudar daqui para frente e tirar do mês', () => {
    const { fixture, click, q, svc } = mount(CostEntrySheet, {
      vendors: [RENDER],
      month: '2026-11',
      cost: cost(),
      canChangeFixed: true,
    });
    const removed = vi.fn();
    fixture.componentInstance.remove.subscribe(removed);
    expect(q('entry-revert')).toBeNull();
    click('sheet-menu');
    expect(q('entry-revert')).not.toBeNull();
    expect(q('entry-change-fixed')).not.toBeNull();
    click('entry-remove');
    expect(removed).toHaveBeenCalledTimes(1);
    click('sheet-menu');
    click('entry-revert');
    expect(svc.revertCost).toHaveBeenCalledWith('c1');
  });
});
