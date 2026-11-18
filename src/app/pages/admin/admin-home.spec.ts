import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NEVER, Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminHome } from './admin-home';
import { AdminHomeService } from './home/admin-home.service';
import { AdminMetricsService } from '../../services/admin-metrics.service';
import { AdminCapabilitiesService } from '../../services/admin-capabilities.service';
import { NotificationService } from '../../services/notification.service';
import { AdminRevenueService } from './revenue/admin-revenue.service';
import type { AdminOverviewResponse } from '../../types/admin-overview.types';
import type { AdminHome as AdminHomeData, AdminHomePeriod, AdminHomeScope } from '../../types/admin-home.types';
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

interface Setup {
  codes?: AdminCapabilityCode[];
  home?: (period: AdminHomePeriod, scope: AdminHomeScope) => unknown;
}

function setup(opts: Setup = {}) {
  const granted = new Set(opts.codes ?? ['ver']);
  const homeSvc = {
    home: vi.fn(
      opts.home ??
        ((period: AdminHomePeriod, scope: AdminHomeScope) => of({ ...HOME, meta: { ...HOME.meta, period, scope } })),
    ),
    usage: vi.fn((period: AdminHomePeriod, scope: AdminHomeScope) =>
      of({ ...USAGE, meta: { ...USAGE.meta, period, scope } }),
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
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AdminHome],
    providers: [
      provideRouter([]),
      provideNoopAnimations(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AdminHomeService, useValue: homeSvc },
      { provide: AdminRevenueService, useValue: { fetch: () => NEVER } },
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
  return { fixture, host: fixture.nativeElement as HTMLElement, homeSvc };
}

function kpiCard(host: HTMLElement, key: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`[data-kpi="${key}"]`);
  expect(el, `cartão ${key}`).not.toBeNull();
  return el as HTMLElement;
}

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
    expect(flat(card)).toContain('R$ 569');
    expect(flat(card)).toContain('↗ 137%');
    expect(flat(card)).toContain('vs 01/12');
  });

  it('MRR estimado fica ao lado, branco, com "preço de tabela"', () => {
    const card = kpiCard(setup().host, 'mrrEstimated');
    expect(card.className).not.toContain('bg-primary-500');
    expect(flat(card)).toContain('R$ 769');
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

  it('valor gerenciado mostra o esperado E o recebido, lado a lado', () => {
    const { host } = setup();
    const card = kpiCard(host, 'managed');
    // Compacto para caber lado a lado sem quebrar o número; o exato fica no title.
    expect(flat(card.querySelector('[data-managed-expected]'))).toBe('R$ 120,4k');
    const title = (sel: string) => card.querySelector(sel)?.getAttribute('title')?.replace(/\s/g, ' ');
    expect(title('[data-managed-expected]')).toBe('R$ 120.417');
    expect(flat(card.querySelector('[data-managed-received]'))).toBe('R$ 80k');
    expect(title('[data-managed-received]')).toBe('R$ 80.000');
    expect(flat(card)).toContain('66,4% do esperado já entrou');
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

  it('trocar o período pede de novo com o período novo', () => {
    const { host, fixture, homeSvc } = setup();
    const pill = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => flat(b) === '30 dias');
    pill!.click();
    fixture.detectChanges();
    expect(homeSvc.home).toHaveBeenLastCalledWith('30d', 'clients');
    expect(homeSvc.usage).toHaveBeenLastCalledWith('30d', 'clients');
  });

  it('"Com contas internas" pede o escopo all para a tela inteira', () => {
    const { host, fixture, homeSvc } = setup();
    const pill = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) =>
      flat(b).includes('Com contas internas'),
    );
    pill!.click();
    fixture.detectChanges();
    expect(homeSvc.home).toHaveBeenLastCalledWith('12m', 'all');
    expect(homeSvc.movements).toHaveBeenLastCalledWith(expect.objectContaining({ includeInternal: true }));
    expect(homeSvc.upcoming).toHaveBeenLastCalledWith('all');
  });

  it('resposta de outro período nunca aparece sob a pílula marcada', () => {
    const late = new Subject<AdminHomeData>();
    const { host, fixture } = setup({ home: () => late });
    late.next({ ...HOME, meta: { ...HOME.meta, period: '30d' } });
    fixture.detectChanges();
    expect(flat(kpiCard(host, 'mrrReal'))).not.toContain('R$ 569');
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

  function barCount(host: HTMLElement, label: string): string {
    const found = Array.from(host.querySelectorAll('span')).find((s) => flat(s) === label);
    expect(found, `barra "${label}"`).toBeTruthy();
    return flat(found?.nextElementSibling ?? null);
  }

  it('aluguéis fechados, concluídos, contratos e assinados, cada um com o seu rótulo', () => {
    const { host } = setup();
    expect(statValue(host, 'Aluguéis fechados')).toContain('1.235');
    // Reais inteiros: o valor com centavos quebrava a linha no cartão estreito.
    expect(statValue(host, 'Aluguéis concluídos')).toContain('900');
    expect(statValue(host, 'Aluguéis concluídos')).not.toContain(',');
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

  it('status ausente do mapa esparso vale zero', () => {
    const { host } = setup();
    expect(barCount(host, 'Reservado')).toBe('7');
    expect(barCount(host, 'Em andamento')).toBe('5');
    expect(barCount(host, 'Concluído')).toBe('0');
    expect(barCount(host, 'Cancelado')).toBe('0');
  });

  it('a receita da plataforma continua na página, sem um segundo gráfico de MRR', () => {
    const { host } = setup();
    expect(host.querySelector('app-admin-revenue-section')).not.toBeNull();
    expect(host.querySelectorAll('[data-mrr-chart]').length).toBe(1);
  });
});
