import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Route,
  Router,
  RouterStateSnapshot,
  Routes,
  provideRouter,
} from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Component, ChangeDetectionStrategy } from '@angular/core';

import { DashboardHome } from './dashboard-home';
import { DashboardService } from '../../services/dashboard.service';
import { BillingAccessService } from '../../services/billing-access.service';
import { FleetActivationService } from '../../services/fleet-activation.service';
import { ReportsService } from '../../services/reports.service';
import { SessionService } from '../../services/session.service';
import { routes as APP_ROUTES } from '../../app.routes';
import type { DashboardSummaryDto } from '../../types/dashboard.types';

/**
 * FEAT-0146 — a tela de POUSO não pode oferecer caminho que o guard recusa.
 *
 * Era o pior caso da família: as quatro "ações rápidas" apareciam SEMPRE, sem
 * depender nem de dado, e seis dos sete chips de alerta levam a rotas
 * `roleGuard(['OWNER', 'MANAGER'])`. Todo motorista cai em `/dashboard`, então
 * era o primeiro contato dele com o produto — e o `roleGuard` REDIRECIONA para
 * `/dashboard`, ou seja, tocar recarregava a tela nela mesma, sem erro nenhum.
 *
 * >>> A MUTAÇÃO QUE IMPORTA: uma trava que lê o ESPELHO tem de matar os MESMOS
 * casos que NÃO TER TRAVA. <<< O teste discrimina a FONTE do papel, não a
 * presença de uma checagem — senão alguém "conserta" pondo uma trava que lê o
 * lugar errado, e o teste aprova.
 *
 * E a comparação é contra os GUARDS DE VERDADE, importados de `app.routes.ts`:
 * conferir rótulo contra uma lista escrita no próprio teste não prova nada.
 */
describe('DashboardHome — o que a tela oferece é o que o guard aceita', () => {
  /**
   * Caminho completo -> `canActivate` da própria rota, lido da árvore real.
   * Mesmo utilitário de `sidebar-role-source.spec.ts`, mesma razão.
   */
  function collectGuards(
    list: Routes,
    prefix: string,
    into: Map<string, CanActivateFn[]>,
  ): Map<string, CanActivateFn[]> {
    for (const route of list as Route[]) {
      const segment = route.path ?? '';
      const full = segment ? `${prefix}/${segment}` : prefix;
      if (segment || route.canActivate) {
        into.set(full === '' ? '/' : full, (route.canActivate ?? []) as CanActivateFn[]);
      }
      if (route.children) collectGuards(route.children, full, into);
    }
    return into;
  }

  const GUARDS_BY_PATH = collectGuards(APP_ROUTES, '', new Map());

  function guardAdmits(path: string): boolean {
    const guards = GUARDS_BY_PATH.get(path);
    if (!guards || guards.length === 0) return true;
    return TestBed.runInInjectionContext(() =>
      guards.every(
        (guard) =>
          guard(
            {} as unknown as ActivatedRouteSnapshot,
            {} as unknown as RouterStateSnapshot,
          ) === true,
      ),
    );
  }

  function summaryWithAlerts(): DashboardSummaryDto {
    return {
      period: { from: '2026-09-01', to: '2026-09-30' },
      alerts: {
        // um contador em CADA chip: a tela tenta oferecer tudo, e é o papel
        // que decide o que sobra
        docsExpiring7d: { count: 2 },
        expiringInsurance30d: { count: 1 },
        openFines: { count: 3, amountCents: 30_000 },
        openMaintenances: { count: 1 },
        expiringCnh30d: { count: 1 },
        expiringLicensing30d: { count: 1 },
        reservedRentals: { count: 1 },
        paidFinesInPeriod: { count: 0, amountCents: 0 },
      },
      fleet: {
        vehiclesTotal: 0,
        vehicleLimit: null,
        driversActive: 0,
        driversTotal: 0,
        rentedNow: 0,
        reservedNow: 0,
        utilizationPct: 0,
      },
      finance: {
        revenueCents: 0,
        receivedCents: 0,
        expensesCents: 0,
        saleRevenueCents: 0,
        resultCents: 0,
        maintenanceExpenseCents: 0,
        fineExpenseCents: 0,
        pendingChargesCents: 0,
        overdueChargesCents: 0,
        previousRevenueCents: 0,
        previousReceivedCents: 0,
        revenueDaily: [],
        byVehicle: [],
        byDriver: [],
        monthlyBilling: [],
        cashflow: [],
      },
      charges: {
        byStatus: [],
        ticketMedioCents: 0,
        completedRentalsCount: 0,
        ticketMedioLast6Months: [],
      },
      distributions: { rentalsByStatus: [], vehiclesByStatus: [] },
      topOffenders: { vehicles: [], drivers: [] },
    } as unknown as DashboardSummaryDto;
  }

  /**
   * Rotas de mentira, e elas são obrigatórias: com `provideRouter([])` o
   * `routerLink` das ações rápidas não gera `href` nenhum, a colheita vem
   * VAZIA e o teste passaria por ausência de sinal — a mesma armadilha do
   * `provideRouter([])` que já mordeu este projeto.
   */
  @Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
  class StubPage {}

  const TEST_ROUTES: Routes = [
    '/alertas',
    '/seguros',
    '/multas',
    '/manutencoes',
    '/motoristas',
    '/veiculos',
    '/alugueis',
    '/alugueis/novo',
    '/veiculos/novo',
    '/manutencoes/novo',
    '/multas/novo',
  ].map((path) => ({ path: path.slice(1), component: StubPage }));

  let navigateByUrl: ReturnType<typeof vi.spyOn>;

  /**
   * O ESPELHO mente em todos os casos: diz OWNER. Se a trava o lesse, o
   * motorista continuaria vendo os quatro cartões e os seis chips.
   */
  function render(tokenRole: string | null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardHome],
      providers: [
        provideRouter(TEST_ROUTES),
        provideNoopAnimations(),
        {
          provide: DashboardService,
          useValue: {
            loadOverview: vi.fn().mockReturnValue(of(summaryWithAlerts())),
            loadCashAccumulation: vi.fn().mockReturnValue(of(null)),
          },
        },
        { provide: BillingAccessService, useValue: { status: signal(null) } },
        { provide: FleetActivationService, useValue: { hasVehicles: () => of(true) } },
        {
          provide: SessionService,
          useValue: {
            getItem: vi.fn((key: string) => (key === 'selectedRole' ? 'OWNER' : null)),
            isPlatformAdmin: () => false,
            getCompanyRoleFromToken: () => tokenRole,
          },
        },
        {
          provide: ReportsService,
          useValue: {
            loadVehicleRoi: vi.fn().mockReturnValue(of({ vehicles: [] })),
            vehicleRoi: signal(null),
            vehicleRoiLoading: signal(false),
            vehicleRoiError: signal(null),
          },
        },
      ],
    });
    // Espião no Router DE VERDADE: o `routerLink` precisa dele para montar
    // `href`, e um Router de mentira deixaria as ações rápidas sem destino
    // nenhum no DOM.
    navigateByUrl = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    const fixture = TestBed.createComponent(DashboardHome);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** Destino de cada chip: o alvo vive no handler, então o chip é clicado. */
  function chipTargets(host: HTMLElement): string[] {
    const targets: string[] = [];
    for (const chip of Array.from(host.querySelectorAll('app-alert-chip'))) {
      navigateByUrl.mockClear();
      chip.querySelector('button')?.click();
      for (const call of navigateByUrl.mock.calls) targets.push(String(call[0]));
    }
    return targets;
  }

  /** Destino de cada ação rápida: `routerLink` vira href no DOM. */
  function quickActionTargets(host: HTMLElement): string[] {
    return Array.from(host.querySelectorAll('app-quick-action-card a[href]')).map((a) =>
      (a.getAttribute('href') ?? '').replace(/^#/, ''),
    );
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  // --------------------------------------- o teste que mantém os outros honestos
  it('leu a árvore de rotas de verdade (mapa vazio faria tudo parecer permitido)', () => {
    // Terceira forma da mesma armadilha em três dias: `provideRouter([])` que
    // não navega, menu que só monta ao abrir, e agora uma varredura de rotas
    // que poderia devolver nada. Colheita vazia PASSA, e passa em silêncio.
    expect(GUARDS_BY_PATH.get('/alugueis')?.length).toBe(1);
    expect(GUARDS_BY_PATH.get('/veiculos')?.length).toBe(1);
    expect(GUARDS_BY_PATH.get('/multas')?.length).toBe(1);
    expect(GUARDS_BY_PATH.get('/manutencoes')?.length).toBe(1);
    /*
     * ESTA ASSERÇÃO MUDOU DE LADO em 2026-09-25 (FEAT-0108). Antes afirmava que
     * `/alertas` NÃO tinha guard — era isso que tornava o chip de documentos um
     * chip legítimo para o motorista. Agora afirma que TEM.
     *
     * O propósito do teste é o mesmo: provar que a varredura leu a árvore de
     * verdade, porque um mapa vazio faria tudo parecer permitido. `/alertas`
     * serve a esse propósito dos dois lados — o que não serve é a colheita
     * vazia.
     *
     * TEMPORÁRIO, e o motivo está no FEAT-0178: `/v1/alerts` não está no
     * `DriverReadScopePolicy` e o `DocumentAlertService` recorta só por empresa.
     * Quando o endpoint ganhar escopo por motorista, o guard sai e esta linha
     * volta para `0`.
     */
    expect(GUARDS_BY_PATH.has('/alertas')).toBe(true);
    expect(GUARDS_BY_PATH.get('/alertas')?.length).toBe(1);
  });

  // ------------------------------------------------------- IGUALDADE DAS PONTAS
  it.each(['DRIVER', 'MANAGER', 'OWNER'] as const)(
    'IGUALDADE: com o token em %s (e o espelho mentindo OWNER), nada que a tela oferece é recusado pelo guard',
    (tokenRole) => {
      const host = render(tokenRole);

      const offered = [...chipTargets(host), ...quickActionTargets(host)];
      const bounced = offered.filter((route) => !guardAdmits(route));

      expect(bounced).toEqual([]);
    },
  );

  // -------------------------------------- NÃO ESCONDA O QUE FUNCIONA
  /*
   * INVERTIDO em 2026-09-25 (FEAT-0108), e é DÍVIDA, não regra de produto.
   *
   * Este teste afirmava o contrário: que o motorista CONTINUAVA vendo o chip,
   * porque `/alertas` não tinha guard e ele podia abrir. Isso era verdade sobre
   * o FRONTEND e falso sobre a API — `/v1/alerts` nunca esteve no
   * `DriverReadScopePolicy`, então a tela era 403 inteira. O chip prometia uma
   * porta que o servidor fechava.
   *
   * O dono decidiu que o motorista DEVE ver os alertas de CNH e documento DELE.
   * O que impede é o backend: `DocumentAlertService.listDocumentAlerts` recorta
   * só por empresa, sem corte por motorista, então abrir hoje mostraria a CNH de
   * todos os motoristas e o CRLV da frota inteira a cada um. Abrir a rota não é
   * recortar o dado.
   *
   * ESTE TESTE É O ALARME DA DÍVIDA: quando o FEAT-0178 der escopo por motorista
   * ao endpoint, ele volta a afirmar que o chip aparece. Enquanto isso, se o
   * chip reaparecer sem o backend recortar, é aqui que tem de gritar.
   */
  it('o motorista NÃO vê o chip de documentos enquanto /alertas não recorta por motorista (FEAT-0178)', () => {
    const host = render('DRIVER');

    expect(chipTargets(host)).toEqual([]);
    // A razão de esconder: o guard recusa o destino. As duas pontas concordam.
    expect(guardAdmits('/alertas')).toBe(false);
    expect(host.textContent).not.toContain('Documentos a vencer');
  });

  it('sem o alerta de documentos, o motorista não fica com uma faixa VAZIA no lugar', () => {
    // A faixa inteira sai quando não sobrou chip nenhum: um buraco entre os
    // cartões seria outro jeito de não explicar nada.
    TestBed.resetTestingModule();
    const semDocs = summaryWithAlerts();
    (semDocs.alerts as unknown as { docsExpiring7d: { count: number } }).docsExpiring7d = {
      count: 0,
    };
    TestBed.configureTestingModule({
      imports: [DashboardHome],
      providers: [
        provideRouter(TEST_ROUTES),
        provideNoopAnimations(),
        {
          provide: DashboardService,
          useValue: {
            loadOverview: vi.fn().mockReturnValue(of(semDocs)),
            loadCashAccumulation: vi.fn().mockReturnValue(of(null)),
          },
        },
        { provide: BillingAccessService, useValue: { status: signal(null) } },
        { provide: FleetActivationService, useValue: { hasVehicles: () => of(true) } },
        {
          provide: SessionService,
          useValue: {
            getItem: vi.fn(() => 'OWNER'),
            isPlatformAdmin: () => false,
            getCompanyRoleFromToken: () => 'DRIVER',
          },
        },
        {
          provide: ReportsService,
          useValue: {
            loadVehicleRoi: vi.fn().mockReturnValue(of({ vehicles: [] })),
            vehicleRoi: signal(null),
            vehicleRoiLoading: signal(false),
            vehicleRoiError: signal(null),
          },
        },
      ],
    });
    navigateByUrl = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    const fixture = TestBed.createComponent(DashboardHome);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('app-alert-chip').length).toBe(0);
  });

  // ------------------------------------------------------------ AÇÕES RÁPIDAS
  it('o motorista não recebe as ações rápidas — nem os cartões nem um card VAZIO', () => {
    const host = render('DRIVER');

    expect(quickActionTargets(host)).toEqual([]);
    // o título também some: um "Ações rápidas" sem ação é um defeito novo
    expect(host.textContent).not.toContain('Ações rápidas');
  });

  it.each(['OWNER', 'MANAGER'] as const)(
    '%s continua com as quatro ações rápidas — a trava não tirou a tela de ninguém',
    (tokenRole) => {
      const host = render(tokenRole);

      expect(quickActionTargets(host)).toEqual([
        '/alugueis/novo',
        '/veiculos/novo',
        '/manutencoes/novo',
        '/multas/novo',
      ]);
      expect(host.textContent).toContain('Ações rápidas');
    },
  );

  it.each(['OWNER', 'MANAGER'] as const)('%s continua com os sete chips', (tokenRole) => {
    const host = render(tokenRole);

    expect(host.querySelectorAll('app-alert-chip').length).toBe(7);
  });

  // ------------------------------------------------- omissão não vira permissão
  /*
   * Segue a inversão acima (FEAT-0108, 2026-09-25): sessão sem token é tratada
   * como não-operador, e não-operador deixou de ver o chip de documentos. A
   * regra afirmada é a mesma de antes — omissão não vira permissão —, só que
   * agora ela nega também o único chip que escapava. Volta a `['/alertas']`
   * quando o FEAT-0178 fechar a dívida.
   */
  it('token ausente é tratado como não-operador, como faz o roleGuard', () => {
    const host = render(null);

    expect(quickActionTargets(host)).toEqual([]);
    expect(chipTargets(host)).toEqual([]);
  });
});
