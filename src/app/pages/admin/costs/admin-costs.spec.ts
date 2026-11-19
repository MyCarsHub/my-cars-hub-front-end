import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import type { AdminCapabilityCode } from '../../../types/admin-roles.types';
import type { PlatformCostMonth } from '../../../types/admin-finance.types';
import { AdminFinanceService } from '../finance/admin-finance.service';
import { AdminHomeService } from '../home/admin-home.service';
import { HOME } from '../home/admin-home.testing';
import { ADMIN_HOME_DEFAULT_SCOPE, mrrRealCaption } from '../home/admin-home.view';
import { rangeForPreset } from '../../../components/date-range-picker/date-range-picker';
import type { AdminHomeRange } from '../../../types/admin-home.types';
import { AdminCosts } from './admin-costs';
import { cost, schedule, vendor } from './costs.testing';

/** 18/11/2026 em São Paulo, em qualquer fuso da máquina. */
const NOW = new Date('2026-11-18T15:00:00Z');

const flat = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function month(m: string, rows = [cost({ month: m })]): PlatformCostMonth {
  return { month: m, totalCents: rows.length ? rows.reduce((s, r) => s + r.amountCents, 0) : null, rows };
}

interface Setup {
  codes?: AdminCapabilityCode[];
  query?: Record<string, string>;
}

function setup(opts: Setup = {}) {
  const granted = new Set(opts.codes ?? ['ver', 'custo.gerir']);
  const finance = {
    schedules: vi.fn(() =>
      of([schedule(), schedule({ id: 's2', service: 'Domínio', amountCents: 1_200 }), schedule({ id: 's3', status: 'ENDED', vendorName: 'Render', service: 'Antiga', endMonth: '2026-09' })]),
    ),
    vendors: vi.fn(() => of([vendor(), vendor({ id: 'v-old', name: 'Antigo', active: false })])),
    costs: vi.fn((m: string) =>
      of(
        month(m, [
          cost({ month: m }),
          cost({ id: 'c2', month: m, kind: 'ONE_OFF', scheduleId: null, scheduleAmountCents: null, overridden: false, description: 'Upgrade', amountCents: 2_500 }),
        ]),
      ),
    ),
    deleteCost: vi.fn(() => of(undefined)),
    revertCost: vi.fn(() => of(cost({ overridden: false }))),
    updateVendor: vi.fn(() => of(vendor({ active: false }))),
    endSchedule: vi.fn(() => of(schedule())),
  };
  const profitHome = {
    ...HOME,
    kpis: {
      ...HOME.kpis,
      mrrReal: { ...HOME.kpis.mrrReal, value: 56_910, parts: { payingCompanies: 6 } },
      profitMonth: { ...HOME.kpis.profitMonth, value: 37_610, nullReason: null, parts: { mrrRealCents: 56_910, costsCents: 19_300 } },
    },
  };
  const homeSvc = { home: vi.fn(() => of(profitHome)) };
  const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), push: vi.fn() };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AdminCosts],
    providers: [
      provideRouter([]),
      provideNoopAnimations(),
      { provide: AdminFinanceService, useValue: finance },
      { provide: AdminHomeService, useValue: homeSvc },
      { provide: ApiErrorService, useValue: { claim: vi.fn() } },
      { provide: NotificationService, useValue: notify },
      {
        provide: AdminCapabilitiesService,
        useValue: { can: (c: AdminCapabilityCode) => granted.has(c), ensureLoaded: () => of(null) },
      },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(opts.query ?? {}) } },
      },
    ],
  });
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(AdminCosts);
  fixture.detectChanges();
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const q = <E extends Element = HTMLElement>(sel: string) => host.querySelector<E>(sel);
  const openTopMenu = () => {
    q<HTMLButtonElement>('[data-testid="costs-top-menu"] button[aria-haspopup="menu"]')!.click();
    fixture.detectChanges();
  };
  return { fixture, host, q, finance, homeSvc, notify, navigate, openTopMenu };
}

describe('AdminCosts — Dinheiro › Custos', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('carrega fixos, fornecedores, o mês corrente e o Lucro do mês corrente (o pedido do Painel)', () => {
    const { finance, homeSvc } = setup();
    expect(finance.schedules).toHaveBeenCalled();
    expect(finance.vendors).toHaveBeenCalled();
    expect(finance.costs).toHaveBeenCalledWith('2026-11');
    expect(homeSvc.home).toHaveBeenCalledWith({ from: '2026-11-01', to: '2026-11-18' }, 'clients');
  });

  it('"MRR real" é o cartão do Painel: mesmo nome, mesmo campo e mesma legenda', () => {
    const { q, homeSvc } = setup();
    const [range, scope] = homeSvc.home.mock.calls[0] as unknown as [AdminHomeRange, string];
    // O mesmo pedido que o Painel abre: a pílula "Mês atual" até hoje, só clientes.
    expect(range).toEqual(rangeForPreset('monthCurrent', 'today'));
    expect(scope).toBe(ADMIN_HOME_DEFAULT_SCOPE);
    const card = flat(q('[data-kpi="mrr"]')).replace(/\s/g, ' ');
    expect(card).toContain('MRR real');
    expect(card).not.toContain('Receita');
    expect(card).toContain('R$ 569,10');
    expect(card).toContain(mrrRealCaption(HOME.kpis.mrrReal));
  });

  it('o topo mostra custos e lucro do mês, e a conta que chega ao Painel', () => {
    const { q } = setup();
    expect(flat(q('[data-kpi="costs"]'))).toContain('Custos de novembro');
    expect(flat(q('[data-kpi="profit"]'))).toContain('Lucro de novembro');
    expect(flat(q('[data-kpi="fixed"]'))).toContain('2');
    const flow = flat(q('[data-costs-flow]')).replace(/\s/g, ' ');
    expect(flow).toContain('MRR real R$ 569,10');
    expect(flow).toContain('Custos R$ 193,00');
    expect(flow).toContain('Lucro R$ 376,10');
  });

  it('nenhum botão de ação solto: só o ⋮ do topo, e nele novo fixo, avulso, fornecedor e exportar', () => {
    const { host, openTopMenu, q } = setup();
    const labels = Array.from(host.querySelectorAll('button')).map((b) => flat(b));
    expect(labels.some((l) => l.startsWith('Novo custo fixo'))).toBe(false);
    openTopMenu();
    expect(q('[data-testid="menu-new-fixed"]')).not.toBeNull();
    expect(q('[data-testid="menu-new-entry"]')).not.toBeNull();
    expect(q('[data-testid="menu-new-vendor"]')).not.toBeNull();
    expect(q('[data-testid="menu-export"]')).not.toBeNull();
  });

  it('sem custo.gerir o ⋮ do topo só exporta', () => {
    const { openTopMenu, q } = setup({ codes: ['ver'] });
    openTopMenu();
    expect(q('[data-testid="menu-new-fixed"]')).toBeNull();
    expect(q('[data-testid="menu-export"]')).not.toBeNull();
  });

  it('custos fixos: uma linha por serviço, com o chip de situação', () => {
    const { host } = setup();
    const titles = Array.from(host.querySelectorAll('[data-testid="fixed-title"]')).map(flat);
    expect(titles).toContain('Vercel · Plano Pro');
    expect(titles).toContain('Vercel · Domínio');
    expect(Array.from(host.querySelectorAll('[data-testid="fixed-status"]')).map(flat)).toContain('Encerrado');
  });

  it('lançamentos do mês: fixo/avulso, "editado" e o seletor de mês', () => {
    const { host, q, fixture, finance } = setup();
    fixture.componentInstance['setTab']('mes');
    fixture.detectChanges();
    expect(Array.from(host.querySelectorAll('[data-testid="entry-kind"]')).map(flat)).toEqual(
      expect.arrayContaining(['Fixo', 'Avulso']),
    );
    expect(q('[data-testid="entry-edited"]')).not.toBeNull();
    expect(flat(q('[data-testid="month-total"]')).replace(/\s/g, ' ')).toContain('R$ 193,00');
    q<HTMLButtonElement>('[data-testid="month-prev"]')!.click();
    fixture.detectChanges();
    expect(finance.costs).toHaveBeenLastCalledWith('2026-10');
    expect(flat(q('[data-testid="month-label"]'))).toBe('Outubro de 2026');
  });

  it('mês sem linhas diz "sem custos", nunca R$ 0', () => {
    const { fixture, finance, q } = setup();
    finance.costs.mockReturnValue(of(month('2026-10', [])));
    fixture.componentInstance['setTab']('mes');
    fixture.componentInstance['shiftMonth'](-1);
    fixture.detectChanges();
    expect(flat(q('[data-testid="month-total"]'))).toContain('Sem custos em outubro');
    expect(flat(q('[data-testid="month-total"]')).replace(/\s/g, ' ')).not.toContain('R$ 0,00');
  });

  it('tirar do mês pede confirmação e recarrega tudo', () => {
    const { fixture, finance, homeSvc } = setup();
    const c = cost();
    fixture.componentInstance['askRemoveEntry'](c);
    fixture.detectChanges();
    expect(document.body.textContent).toContain('Tirar só de novembro');
    fixture.componentInstance['runConfirm']();
    expect(finance.deleteCost).toHaveBeenCalledWith('c1');
    expect(homeSvc.home).toHaveBeenCalledTimes(2);
  });

  it('atalho do Painel ?acao=fixo abre "Novo custo fixo" e limpa a URL', () => {
    const { fixture, navigate } = setup({ query: { acao: 'fixo' } });
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="fixed-cost-sheet"]')).not.toBeNull();
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ replaceUrl: true }));
  });

  it('o atalho não abre folha para quem só lê', () => {
    const { fixture } = setup({ codes: ['ver'], query: { acao: 'avulso' } });
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="cost-entry-sheet"]')).toBeNull();
  });

  it('?aba=fornecedores abre direto em Fornecedores', () => {
    const { q } = setup({ query: { aba: 'fornecedores' } });
    expect(q('[data-costs-tab="fornecedores"]')).not.toBeNull();
    expect(flat(q('[data-testid="vendor-list"]'))).toContain('Inativo');
  });
});
