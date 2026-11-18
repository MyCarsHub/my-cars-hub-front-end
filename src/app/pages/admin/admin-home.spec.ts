import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NEVER, Subject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminHome } from './admin-home';
import { AdminHomeService } from './home/admin-home.service';
import { AdminMetricsService } from '../../services/admin-metrics.service';
import { AdminCapabilitiesService } from '../../services/admin-capabilities.service';
import { NotificationService } from '../../services/notification.service';
import { AdminRevenueService } from './revenue/admin-revenue.service';
import type { AdminOverviewResponse } from '../../types/admin-overview.types';
import type { AdminHome as AdminHomeData, AdminHomeRange, AdminHomeScope } from '../../types/admin-home.types';
import { HOME, USAGE } from './home/admin-home.testing';
import type { AdminCapabilityCode } from '../../types/admin-roles.types';

const OVERVIEW: AdminOverviewResponse = {
  users: { total: 0, activeTotal: 0, newLast30Days: 0, newByDay: [], onlineNow: 3 },
  companies: { total: 0, activeTotal: 0, newLast30Days: 0 },
  vehicles: { total: 0, activeTotal: 0 },
  subscriptions: { total: 0, active: 0, trialing: 0, byStatus: {}, mrrCents: 0, mrrActiveOnlyCents: 0, arrCents: 0 },
  feedback: { total: 9, pending: 3, byStatus: {} },
  rentals: {
    closedTotal: 42,
    closedAmountCents: 1_234_56,
    completedTotal: 30,
    completedAmountCents: 900_00,
    // COMPLETED e CANCELED omitidos de propósito: mapa esparso do backend.
    byStatus: { RESERVED: 7, ACTIVE: 5 },
  },
  contracts: { total: 25, signedTotal: 9 },
};

const flat = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * O relógio fica em 18/11/2026 03:00 em São Paulo (06:00 UTC): é 18/11 também no navegador de
 * quem roda o spec (de UTC-3 a UTC+14), então "7 dias" e "Mês atual" dão as mesmas datas em
 * qualquer fuso da máquina.
 */
const NOW = new Date('2026-11-18T06:00:00Z');
const MONTH_TO_DATE: AdminHomeRange = { from: '2026-11-01', to: '2026-11-18' };

interface Setup {
  codes?: AdminCapabilityCode[];
  home?: (range: AdminHomeRange, scope: AdminHomeScope) => unknown;
}

function setup(opts: Setup = {}) {
  const granted = new Set(opts.codes ?? ['ver']);
  const homeSvc = {
    home: vi.fn(
      opts.home ??
        ((range: AdminHomeRange, scope: AdminHomeScope) =>
          of({ ...HOME, meta: { ...HOME.meta, period: 'custom', scope, from: range.from, to: range.to } })),
    ),
    usage: vi.fn((range: AdminHomeRange, scope: AdminHomeScope) =>
      of({ ...USAGE, meta: { ...USAGE.meta, period: 'custom', scope, from: range.from, to: range.to } }),
    ),
    upcoming: vi.fn(() =>
      of({
        from: '2026-11-17',
        until: '2026-12-16',
        receivables: [],
        payables: [],
        vendorsWithoutBillingDay: 1,
        receivablesTotalCents: 0,
        payablesTotalCents: null,
      }),
    ),
    companies: vi.fn(() => of({ content: [], page: 0, size: 20, total: 0 })),
    movements: vi.fn(() => of({ content: [], page: 0, size: 10, total: 0 })),
  };
  const revenueSvc = { fetch: vi.fn(() => NEVER) };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AdminHome],
    providers: [
      provideRouter([]),
      provideNoopAnimations(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AdminHomeService, useValue: homeSvc },
      { provide: AdminRevenueService, useValue: revenueSvc },
      {
        provide: AdminMetricsService,
        useValue: {
          overview: signal(OVERVIEW),
          loading: signal(false),
          error: signal<string | null>(null),
          loadOverview: vi.fn(() => of(OVERVIEW)),
        },
      },
      {
        provide: AdminCapabilitiesService,
        useValue: { can: (c: AdminCapabilityCode) => granted.has(c), ensureLoaded: () => of(null) },
      },
      { provide: NotificationService, useValue: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), push: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(AdminHome);
  fixture.detectChanges();
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement, homeSvc, revenueSvc };
}

function kpiCard(host: HTMLElement, key: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`[data-kpi="${key}"]`);
  expect(el, `cartão ${key}`).not.toBeNull();
  return el as HTMLElement;
}

function pill(host: HTMLElement, label: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>('app-date-range-picker button')).find(
    (b) => flat(b) === label,
  );
  expect(found, `pílula "${label}"`).toBeTruthy();
  return found as HTMLElement;
}

/** O `Intl` escreve "R$" com espaço não quebrável. */
const plain = (text: string): string => text.replace(/ /g, ' ');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('AdminHome v2 — cartões', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('mostra os 10 cartões na ordem do desenho', () => {
    const { host } = setup();
    const labels = Array.from(host.querySelectorAll('[data-home-kpis] > [data-kpi]')).map((el) => el.getAttribute('data-kpi'));
    expect(labels).toEqual(['mrrReal', 'profit', 'mrrEstimated', 'arr', 'costs', 'subs', 'companies', 'users', 'vehicles', 'managed']);
  });

  it('MRR real é o laranja pintado e tem o valor cobrado, com a variação contra o início do período', () => {
    const { host } = setup();
    const card = kpiCard(host, 'mrrReal');
    expect(card.className).toContain('bg-primary-500');
    expect(plain(flat(card))).toContain('R$ 569,10');
    expect(flat(card)).toContain('↗ 137%');
    expect(flat(card)).toContain('vs 01/12');
  });

  it('MRR estimado fica ao lado, branco, com "preço de tabela"', () => {
    const card = kpiCard(setup().host, 'mrrEstimated');
    expect(card.className).not.toContain('bg-primary-500');
    // Owner rule 18/11/2026: KPI money always shows cents.
    expect(plain(flat(card))).toContain('R$ 768,50');
    expect(flat(card)).toContain('preço de tabela');
  });

  it('sem custo lançado, lucro e custos mostram "—" e o motivo, nunca R$ 0', () => {
    const { host } = setup();
    for (const key of ['profit', 'costs']) {
      const text = flat(kpiCard(host, key));
      expect(text).toContain('—');
      expect(text).toContain('nenhum custo lançado em novembro');
      expect(text).not.toContain('R$ 0');
    }
  });

  it('empresas dizem quantas são de teste; usuários e veículos, os novos do período', () => {
    const { host } = setup();
    expect(flat(kpiCard(host, 'companies'))).toContain('6 de teste');
    expect(flat(kpiCard(host, 'users'))).toContain('↗ 19');
    expect(flat(kpiCard(host, 'vehicles'))).toContain('cadastrados no período');
    expect(flat(kpiCard(host, 'subs'))).toContain('conversões no período');
  });

  it('valor gerenciado é o cartão verde pintado, com recebido e esperado completos, com centavos', () => {
    const { host } = setup();
    const card = kpiCard(host, 'managed');
    expect(card.className).toContain('bg-emerald-600');
    const text = plain(flat(card));
    expect(text).toContain('R$ 80.000,00');
    expect(text).toContain('de R$ 120.416,87 esperados pelo vencimento (66,4% já entrou)');
    // Nada abreviado no cartão, nada escondido no title (regra do dono 18/11).
    expect(text).not.toMatch(/\dk\b/);
    expect(card.querySelector('[title]')).toBeNull();
  });
});

describe('AdminHome v2 — chips, período e escopo', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('chip com zero não aparece; os outros levam ao lugar de agir', () => {
    const { host } = setup();
    const chips = Array.from(host.querySelectorAll('[data-chip]'));
    expect(chips.map((c) => c.getAttribute('data-chip'))).toEqual(['pastDue', 'feedback', 'reconciliation']);
    expect(host.querySelector('[data-chip="feedback"]')!.getAttribute('href')).toBe('/admin/feedback');
    expect(host.querySelector('[data-chip="reconciliation"]')!.getAttribute('aria-label')).toBe('1 falha de conciliação');
  });

  it('UM controle de período na tela: as pílulas do dashboard do dono, e a receita sem pílulas próprias', () => {
    const { host } = setup();
    expect(host.querySelectorAll('app-date-range-picker')).toHaveLength(1);
    const labels = Array.from(host.querySelectorAll('app-date-range-picker button')).map(flat);
    expect(labels).toEqual(['Hoje', '7 dias', 'Mês atual', '30 dias', 'Mês passado', 'Este ano', 'Personalizado']);
    expect(host.querySelector('app-admin-revenue-section app-pill-tabs')).toBeNull();
    expect(host.querySelector('[data-admin-home] app-pill-tabs[ariaLabel="Período"]')).toBeNull();
  });

  it('abre em "Mês atual" até HOJE, com as datas escritas, e pede home, uso, receita e feed com elas', () => {
    const { host, homeSvc, revenueSvc } = setup();
    expect(homeSvc.home).toHaveBeenLastCalledWith(MONTH_TO_DATE, 'clients');
    expect(homeSvc.usage).toHaveBeenLastCalledWith(MONTH_TO_DATE, 'clients');
    expect(revenueSvc.fetch).toHaveBeenLastCalledWith(MONTH_TO_DATE);
    expect(homeSvc.movements).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-11-01', to: '2026-11-18', includeInternal: false }),
    );
    expect(flat(host.querySelector('[data-range-text]'))).toBe('01/11/2026 a 18/11/2026');
  });

  it('a linha de datas mostra o intervalo que o SERVIDOR usou', () => {
    const { host } = setup({
      home: (_range, scope) => of({ ...HOME, meta: { ...HOME.meta, scope, from: '2026-11-02', to: '2026-11-17' } }),
    });
    expect(flat(host.querySelector('[data-range-text]'))).toBe('02/11/2026 a 17/11/2026');
  });

  it('trocar a pílula pede a tela inteira de novo com as datas novas', () => {
    const { host, fixture, homeSvc, revenueSvc } = setup();
    pill(host, '7 dias').click();
    fixture.detectChanges();
    const week = { from: '2026-11-12', to: '2026-11-18' };
    expect(homeSvc.home).toHaveBeenLastCalledWith(week, 'clients');
    expect(homeSvc.usage).toHaveBeenLastCalledWith(week, 'clients');
    expect(revenueSvc.fetch).toHaveBeenLastCalledWith(week);
    expect(homeSvc.movements).toHaveBeenLastCalledWith(expect.objectContaining(week));
  });

  it('"Incluir contas internas" pede o escopo all para a tela inteira', () => {
    const { host, fixture, homeSvc } = setup();
    host.querySelector<HTMLInputElement>('[data-testid="toggle-internal"]')!.click();
    fixture.detectChanges();
    expect(homeSvc.home).toHaveBeenLastCalledWith(MONTH_TO_DATE, 'all');
    expect(homeSvc.movements).toHaveBeenLastCalledWith(expect.objectContaining({ includeInternal: true }));
    expect(homeSvc.upcoming).toHaveBeenLastCalledWith('all');
  });

  it('resposta de outro período nunca aparece sob as datas marcadas', () => {
    const replies: Subject<AdminHomeData>[] = [];
    const { host, fixture } = setup({
      home: () => {
        const reply = new Subject<AdminHomeData>();
        replies.push(reply);
        return reply;
      },
    });
    pill(host, '7 dias').click();
    fixture.detectChanges();
    // A resposta atrasada do "Mês atual" chega depois da troca: não pinta nada.
    replies[0].next(HOME);
    fixture.detectChanges();
    expect(plain(flat(kpiCard(host, 'mrrReal')))).not.toContain('R$ 569');
    replies[replies.length - 1].next(HOME);
    fixture.detectChanges();
    expect(plain(flat(kpiCard(host, 'mrrReal')))).toContain('R$ 569,10');
  });

  it('período que terminou antes de hoje: os cartões do mês dizem qual mês', () => {
    const { host } = setup({
      home: (range, scope) =>
        of({
          ...HOME,
          meta: { ...HOME.meta, scope, from: range.from, to: range.to, live: false, referenceMonth: '2026-10' },
        }),
    });
    expect(flat(kpiCard(host, 'profit'))).toContain('Lucro de outubro');
    expect(flat(kpiCard(host, 'costs'))).toContain('nenhum custo lançado em outubro');
    expect(flat(kpiCard(host, 'managed'))).toContain('Gerenciado em out');
  });

  it('Mês atual diz "do mês"; outro período até hoje nomeia o mês (o valor é do mês, não do período)', () => {
    const { host, fixture } = setup({
      home: (range, scope) =>
        of({ ...HOME, meta: { ...HOME.meta, scope, from: range.from, to: range.to, live: true, referenceMonth: '2026-11' } }),
    });
    expect(flat(kpiCard(host, 'profit'))).toContain('Lucro do mês');
    expect(flat(kpiCard(host, 'costs'))).toContain('Custos do mês');
    expect(flat(kpiCard(host, 'managed'))).toContain('Gerenciado no mês');
    pill(host, '7 dias').click();
    fixture.detectChanges();
    expect(flat(kpiCard(host, 'profit'))).toContain('Lucro de novembro');
    expect(flat(kpiCard(host, 'costs'))).toContain('Custos de novembro');
    expect(flat(kpiCard(host, 'profit'))).not.toContain('do mês');
    expect(flat(kpiCard(host, 'managed'))).toContain('Gerenciado em nov');
  });

  it('Usuários: período que já terminou diz que conta os ativos de hoje; ao vivo, não', () => {
    const live = setup().host;
    expect(flat(kpiCard(live, 'users'))).not.toContain('ativos hoje');
    const past = setup({
      home: (range, scope) =>
        of({ ...HOME, meta: { ...HOME.meta, scope, from: range.from, to: range.to, live: false, referenceMonth: '2026-10' } }),
    }).host;
    expect(flat(kpiCard(past, 'users'))).toContain('ativos hoje, cadastrados até o fim do período');
  });
});

describe('AdminHome v2 — cores e gráficos', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('nenhuma cor fora da marca (roxo, azul, rosa, âmbar) nos gráficos e barras', () => {
    const html = setup().host.innerHTML.toLowerCase();
    for (const off of ['#8b5cf6', '#3b82f6', '#fb7185', '#60a5fa', '#f59e0b', '#a3a3a3', 'bg-blue-', 'bg-amber-', 'bg-neutral-400']) {
      expect(html, off).not.toContain(off);
    }
  });

  it('as colunas empilhadas dos custos têm nome para leitor de tela', () => {
    const withCost: AdminHomeData = {
      ...HOME,
      costs: {
        ...HOME.costs,
        months: [{ month: '2026-11', totalCents: 9_900, byVendor: [{ vendorId: 'v-render', amountCents: 9_900 }] }],
      },
    };
    const chart = setup({ home: () => of(withCost) }).host.querySelector('app-stacked-bar-chart');
    expect(chart).not.toBeNull();
    expect(chart!.innerHTML).toContain('empilhados por fornecedor');
  });
});

describe('AdminHome v2 — Lançar custo', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('o botão só existe para quem tem custo.gerir', () => {
    expect(setup({ codes: ['ver'] }).host.querySelector('[data-testid="launch-cost"]')).toBeNull();
    expect(setup({ codes: ['ver', 'custo.gerir'] }).host.querySelector('[data-testid="launch-cost"]')).not.toBeNull();
  });

  it('abre a folha de custo', async () => {
    const { host, fixture } = setup({ codes: ['ver', 'custo.gerir'] });
    host.querySelector<HTMLButtonElement>('[data-testid="launch-cost"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="cost-sheet"]')).not.toBeNull();
  });

  it('o lucro sem custo vira atalho para lançar (para o Dono)', async () => {
    const { host, fixture } = setup({ codes: ['ver', 'custo.gerir'] });
    const card = kpiCard(host, 'profit');
    expect(card.getAttribute('role')).toBe('button');
    card.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="cost-sheet"]')).not.toBeNull();
  });

  it('sem custo.gerir o cartão nulo não é botão', () => {
    expect(kpiCard(setup().host, 'profit').getAttribute('role')).toBeNull();
  });
});

describe('AdminHome v2 — saúde, funil e uso', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('saúde é uma fileira de cartões própria, que diz que não segue o período', () => {
    const { host } = setup();
    const section = host.querySelector('section[data-health]');
    expect(section).not.toBeNull();
    expect(flat(section)).toContain('não segue o período');
    // Sem cartão dentro de cartão: a fileira não mora num app-page-card.
    expect(section!.closest('app-page-card')).toBeNull();
  });

  it('cada ladrilho de saúde diz a definição ou por que não tem número', () => {
    const { host } = setup();
    const text = (k: string) => flat(host.querySelector(`[data-health="${k}"]`));
    expect(text('churn')).toContain('0%');
    expect(text('churn')).toContain('0 cancelamentos de 4 pagantes no mês');
    expect(text('ltv')).toContain('sem cancelamentos');
    expect(text('cac')).toContain('informe o gasto com aquisição');
    expect(text('retention')).toContain('calcula a partir de 27/12/2026');
    expect(text('margin')).toContain('nenhum custo lançado em novembro');
  });

  it('o funil usa a mesma coorte e diz a conversão do teste para pago', () => {
    const { host } = setup();
    const step = (k: string) => flat(host.querySelector(`[data-funnel-step="${k}"]`));
    expect(step('signups')).toBe('Cadastros60');
    expect(step('paying')).toBe('Assinam um plano6');
    const text = flat(host.querySelector('[data-funnel]'));
    expect(text).toContain('Conversão do teste para pago: 20%');
  });

  it('sem captura de acessos, o mapa e o ranking dizem que são AÇÕES', () => {
    const { host } = setup();
    expect(flat(host.querySelector('app-home-activity-map'))).toContain('Quando agem');
    expect(flat(host.querySelector('app-home-top-users'))).toContain('Quem mais age');
    expect(flat(host.querySelector('app-home-top-users'))).toContain('12 ações');
  });

  it('"Sem UF" aparece com o número, senão 3 empresas pareceriam o total', () => {
    const rows = Array.from(setup().host.querySelectorAll('[data-uf-row]')).map(flat);
    expect(rows).toEqual(['SP2', 'PR1', 'Sem UF41']);
  });

  it('motoristas: só o que a plataforma já guarda, nada de ganho ou gasto', () => {
    const text = flat(setup().host.querySelector('[data-role-card="DRIVER"]'));
    expect(text).toContain('80');
    expect(text).toContain('Com acesso ao app');
    expect(text).not.toContain('Ganho');
    expect(text).not.toContain('Sobra');
  });
});

/**
 * Os cartões da Visão geral antiga que não estão no desenho FICAM (dono, 17/11), refeitos no
 * padrão novo. As armadilhas de antes continuam cobertas: "fechado" não é "concluído", assinados
 * não é o total, e `byStatus` esparso vira zero.
 */
describe('AdminHome v2 — cartões mantidos', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function statValue(host: HTMLElement, label: string): string {
    const found = Array.from(host.querySelectorAll('[data-legacy-kpis] p')).find((p) => flat(p) === label);
    expect(found, `rótulo "${label}"`).toBeTruthy();
    return flat(found?.nextElementSibling ?? null);
  }

  function ringCount(host: HTMLElement, ring: string, label: string): string {
    const rows = Array.from(host.querySelectorAll(`[data-status-ring="${ring}"] [data-legend-row]`));
    const found = rows.find((r) => flat(r).startsWith(label));
    expect(found, `fatia "${label}"`).toBeTruthy();
    return flat(found?.querySelector('b') ?? null);
  }

  it('aluguéis fechados, concluídos, contratos e assinados, cada um com o seu rótulo', () => {
    const { host } = setup();
    // Regra do dono 18/11/2026: sempre com centavos; o cartão encolhe o número para caber.
    expect(statValue(host, 'Aluguéis fechados')).toContain('R$ 1.234,56');
    expect(statValue(host, 'Aluguéis concluídos')).toBe('R$ 900,00');
    expect(statValue(host, 'Contratos gerados')).toBe('25');
    expect(statValue(host, 'Contratos assinados')).toBe('9');
    const text = flat(host);
    expect(text).toContain('42 aluguéis · exclui cancelados');
    expect(text).toContain('30 aluguéis finalizados');
    expect(text).toContain('de 25 contratos');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  it('online agora: o número, sem bolinha, e leva à lista filtrada', () => {
    const { host } = setup();
    const card = host.querySelector<HTMLElement>('[data-testid="online-now-card"]')!;
    expect(statValue(host, 'Online agora')).toBe('3');
    expect(card.getAttribute('role')).toBe('link');
    expect(card.querySelector('.rounded-full.bg-success-500')).toBeNull();
  });

  it('status por anel com legenda (como o dashboard do dono); ausente do mapa esparso vale zero', () => {
    const { host } = setup();
    expect(host.querySelectorAll('[data-status-ring]')).toHaveLength(3);
    expect(ringCount(host, 'rentals', 'Reservado')).toBe('7');
    expect(ringCount(host, 'rentals', 'Em andamento')).toBe('5');
    expect(ringCount(host, 'rentals', 'Concluído')).toBe('0');
    expect(ringCount(host, 'rentals', 'Cancelado')).toBe('0');
  });

  it('a receita da plataforma continua na página, sem um segundo gráfico de MRR', () => {
    const { host } = setup();
    expect(host.querySelector('app-admin-revenue-section')).not.toBeNull();
    expect(host.querySelectorAll('[data-mrr-chart]').length).toBe(1);
  });
});
