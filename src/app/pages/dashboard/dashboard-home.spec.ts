import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';

import { DashboardHome } from './dashboard-home';
import { BillingAccessService } from '../../services/billing-access.service';
import { DashboardService } from '../../services/dashboard.service';
import { FleetActivationService } from '../../services/fleet-activation.service';
import { SessionService } from '../../services/session.service';
import { ReportsService } from '../../services/reports.service';
import type { AccessStatus } from '../../types/billing-access.types';
import type { DashboardSummaryDto, FinanceDto, FleetDto } from '../../types/dashboard.types';
import { PLAN_CAPACITY } from '../../utils/plan-limits';

/**
 * Cobre o KPI de motoristas do dashboard:
 *  - o numerador de "X de Y do plano" vem de `fleet.driversTotal` (mesmo
 *    predicado do bloqueio no backend), NUNCA de `driversActive` — era essa
 *    divergência que fazia a tela dizer "2 de 5" e o cadastro devolver 409;
 *  - limite nulo mostra "ilimitado", sem "X de null"/"X de 0".
 *
 * E o KPI de veículos, que divide a mesma grade e precisa ler igual.
 *
 * Depois da V59 nenhum plano tem limite nulo em produção: quem dispara o
 * "ilimitado" é o PLANO (ENTERPRISE, maquiado), não o nulo. Os dois ramos são
 * testados — o nulo segue sendo a semântica documentada da coluna.
 *
 * <h4>Os tetos saem de `PLAN_CAPACITY`, nunca redigitados</h4>
 * A cópia à mão que morava aqui descrevia um catálogo pré-V59 (PRO 20/40) que
 * contradizia `plan-limits.spec.ts` (PRO 25/75) — e os dois arquivos ficavam
 * VERDES ao mesmo tempo, porque nenhum lia o outro. Derivar da constante faz a
 * próxima migration quebrar um lugar só, em vez de deixar dois discordando em
 * silêncio.
 *
 * Vale inclusive para o ENTERPRISE maquiado: o teto real vem de
 * `PLAN_CAPACITY`, e o que se afirma é que ele NÃO aparece na tela.
 */
describe('DashboardHome — KPIs de frota', () => {
    /** Plano vigente devolvido pelo access-status; `null` = sem plano conhecido. */
    function accessStatusFor(planName: string | null): AccessStatus | null {
        if (!planName) return null;
        return {
            status: 'ACTIVE',
            trialEndsAt: null,
            graceEndsAt: null,
            plan: {
                id: 'plan-1',
                code: `${planName}_MONTHLY_STRIPE`,
                name: planName,
                period: 'MONTHLY',
                price: 0,
                maxVehicles: null,
                maxDrivers: null,
            },
            blocked: false,
            reason: null,
        };
    }

    function summaryWithFleet(
        fleet: Partial<FleetDto>,
        finance: Partial<FinanceDto> = {},
    ): DashboardSummaryDto {
        return {
            period: { from: '2026-08-01', to: '2026-08-31' },
            alerts: {
                openFines: { count: 0, amountCents: 0 },
                openMaintenances: { count: 0 },
                expiringCnh30d: { count: 0 },
                expiringLicensing30d: { count: 0 },
                reservedRentals: { count: 0 },
                paidFinesInPeriod: { count: 0, amountCents: 0 },
            },
            fleet: {
                vehiclesTotal: 2,
                vehicleLimit: 3,
                driversActive: 2,
                driversTotal: 4,
                rentedNow: 1,
                reservedNow: 0,
                utilizationPct: 50,
                ...fleet,
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
                ...finance,
            },
            charges: {
                byStatus: [],
                ticketMedioCents: 0,
                completedRentalsCount: 0,
                ticketMedioLast6Months: [],
            },
            distributions: { rentalsByStatus: [], vehiclesByStatus: [] },
            topOffenders: { vehicles: [], drivers: [] },
        };
    }

    /** Texto de um card da grade de KPIs, pelo título, com espaços normalizados. */
    function cardText(fleet: Partial<FleetDto>, title: string, planName: string | null): string {
        const loadSpy = vi.fn().mockReturnValue(of(summaryWithFleet(fleet)));
        const status = signal(accessStatusFor(planName));

        TestBed.configureTestingModule({
            imports: [DashboardHome],
            providers: [
                provideRouter([]),
                provideNoopAnimations(),
                {
                    provide: DashboardService,
                    useValue: {
                        loadOverview: loadSpy,
                        loadCashAccumulation: vi.fn().mockReturnValue(of(null)),
                    },
                },
                { provide: BillingAccessService, useValue: { status } },
                { provide: FleetActivationService, useValue: { hasVehicles: () => of(true) } },
            ],
        });

        const fixture = TestBed.createComponent(DashboardHome);
        fixture.detectChanges();

        const host: HTMLElement = fixture.nativeElement;
        const cards = Array.from(host.querySelectorAll<HTMLElement>('section.grid > div'));
        const card = cards.find((c) => c.textContent?.trim().startsWith(title));
        expect(card).toBeTruthy();
        return (card?.textContent ?? '').replace(/\s+/g, ' ').trim();
    }

    /** Texto do card "Motoristas" da grade de KPIs. */
    function driversCardText(fleet: Partial<FleetDto>, planName: string | null = 'PRO'): string {
        return cardText(fleet, 'Motoristas', planName);
    }

    /** Texto do card "Veículos" da grade de KPIs. */
    function vehiclesCardText(fleet: Partial<FleetDto>, planName: string | null = 'PRO'): string {
        return cardText(fleet, 'Veículos', planName);
    }

    /**
     * FEAT-0070 — o card de motoristas mostra OPERAÇÃO, não capacidade: total
     * e quantos estão ativos. Nada de "X de Y do plano" nem de "ilimitados",
     * porque o teto virou guarda-corpo interno e `driverLimit` saiu do
     * `FleetDto`. Esta é a guarda que impede a legenda de voltar.
     */
    it('mostra o total de motoristas sem nenhuma legenda de capacidade', () => {
        const text = driversCardText({ driversActive: 2, driversTotal: 4 });

        expect(text).toContain('4');
        expect(text).toContain('2 ativos agora');
        expect(text).not.toContain('do plano');
        expect(text).not.toContain('ilimitados');
    });

    // Um `TestBed` por teste: o helper configura o módulo a cada chamada.
    it('não vaza capacidade de motorista no ENTERPRISE (plano maquiado)', () => {
        const text = driversCardText({ driversActive: 30, driversTotal: 80 }, 'ENTERPRISE');

        expect(text).toContain('80');
        expect(text).not.toContain('do plano');
        expect(text).not.toContain('ilimitados');
    });

    it('não vaza capacidade de motorista no PRO (plano sem maquiagem)', () => {
        const text = driversCardText({ driversActive: 5, driversTotal: 9 }, 'PRO');

        expect(text).toContain('9');
        expect(text).not.toContain('do plano');
        expect(text).not.toContain('ilimitados');
        expect(text).not.toContain('de sem limite');
    });

    it('mostra "X de Y do plano" quando vehicleLimit é numérico', () => {
        const text = vehiclesCardText({ vehiclesTotal: 2, vehicleLimit: 3 });

        expect(text).toContain('2 de 3 do plano');
    });

    it('mostra "ilimitado" quando vehicleLimit é nulo, sem frase quebrada', () => {
        const text = vehiclesCardText({ vehiclesTotal: 12, vehicleLimit: null });

        expect(text).toContain('ilimitados');
        expect(text).not.toContain('de sem limite');
        expect(text).not.toContain('de null');
        expect(text).not.toContain('12 de 0');
    });

    // Maquiagem por PLANO: o ENTERPRISE tem teto real na V59 e a API manda esse
    // número; a UI precisa dizer "ilimitado" mesmo assim. O teto é guarda-corpo
    // técnico — existe para que uma entrada absurda não quebre o sistema — e
    // não limite comercial, então ele não vai para a tela. O valor vem de
    // `PLAN_CAPACITY` justamente para que o teste continue provando o
    // NÃO-VAZAMENTO se a migration mudar o número.
    it('maquia o ENTERPRISE como ilimitado, sem vazar o teto no card de veículos', () => {
        const cap = PLAN_CAPACITY.ENTERPRISE.vehicles;
        const text = vehiclesCardText({ vehiclesTotal: 40, vehicleLimit: cap }, 'ENTERPRISE');

        expect(text).toContain('veículos ilimitados no plano');
        expect(text).not.toContain(String(cap));
        expect(text).not.toContain(`de ${cap}`);
    });

    // O PRO nunca foi maquiado: o teto real é número e aparece.
    it('mostra o teto real de veículos do PRO em vez de "ilimitado"', () => {
        const cap = PLAN_CAPACITY.PRO.vehicles;
        const text = vehiclesCardText({ vehiclesTotal: 7, vehicleLimit: cap }, 'PRO');

        expect(text).toContain(`7 de ${cap} do plano`);
        expect(text).not.toContain('ilimitados');
    });

    // Sem access-status (admin de plataforma, falha de rede) a maquiagem some,
    // mas o card não pode quebrar: cai no número real.
    it('sem plano conhecido, mostra o número real', () => {
        const cap = PLAN_CAPACITY.PRO.vehicles;
        const text = vehiclesCardText({ vehiclesTotal: 7, vehicleLimit: cap }, null);

        expect(text).toContain(`7 de ${cap} do plano`);
    });
});

/**
 * FEAT-0074 — a VENDA de veículo na tela do dashboard.
 *
 * Decisão do usuário (FIX-0257): o resultado usa o valor BRUTO e o card mostra
 * a ENTRADA DE CAIXA do mês. As duas garantias que este bloco trava:
 *  1. venda é categoria PRÓPRIA — nunca somada ao faturamento de aluguel;
 *  2. o gráfico mensal, que NÃO tem a venda quebrada por mês, diz que ela está
 *     fora — um gráfico que soma sem distinguir é mentira silenciosa, e
 *     distribuir um escalar pelos meses seria inventar dado.
 */
describe('DashboardHome — venda de veículos (FEAT-0074)', () => {
    function render(finance: Partial<FinanceDto>): HTMLElement {
        const summary: DashboardSummaryDto = {
            period: { from: '2026-08-01', to: '2026-08-31' },
            alerts: {
                openFines: { count: 0, amountCents: 0 },
                openMaintenances: { count: 0 },
                expiringCnh30d: { count: 0 },
                expiringLicensing30d: { count: 0 },
                reservedRentals: { count: 0 },
                paidFinesInPeriod: { count: 0, amountCents: 0 },
            },
            fleet: {
                vehiclesTotal: 2,
                vehicleLimit: 3,
                driversActive: 1,
                driversTotal: 1,
                rentedNow: 1,
                reservedNow: 0,
                utilizationPct: 50,
            },
            finance: {
                revenueCents: 500_000,
                receivedCents: 500_000,
                expensesCents: 0,
                saleRevenueCents: 0,
                resultCents: 500_000,
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
                ...finance,
            },
            charges: {
                byStatus: [],
                ticketMedioCents: 0,
                completedRentalsCount: 0,
                ticketMedioLast6Months: [],
            },
            distributions: { rentalsByStatus: [], vehiclesByStatus: [] },
            topOffenders: { drivers: [], vehicles: [] },
        } as unknown as DashboardSummaryDto;

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [DashboardHome],
            providers: [
                provideRouter([]),
                provideNoopAnimations(),
                {
                    provide: DashboardService,
                    useValue: {
            loadOverview: vi.fn().mockReturnValue(of(summary)),
            loadCashAccumulation: vi.fn().mockReturnValue(of(null)),
          },
                },
                { provide: BillingAccessService, useValue: { status: signal(null) } },
                { provide: FleetActivationService, useValue: { hasVehicles: () => of(true) } },
            ],
        });

        const fixture = TestBed.createComponent(DashboardHome);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    function text(host: HTMLElement): string {
        return (host.textContent ?? '').replace(/\s+/g, ' ');
    }

    it('mostra a venda como categoria própria, sem somar no faturamento', () => {
        const host = render({ saleRevenueCents: 4_500_000 });

        const card = host.querySelector('[data-sale-revenue-card]');
        expect(card).not.toBeNull();
        const cardText = (card?.textContent ?? '').replace(/\s+/g, ' ');
        expect(cardText).toContain('Venda de veículos');
        expect(cardText).toContain('45.000,00');
        expect(cardText).toContain('entrada única no período');

        // O faturamento continua sendo SÓ o aluguel: 5.000,00, não 50.000,00.
        expect(text(host)).toContain('5.000,00');
    });

    it('sem venda no período, a categoria não aparece', () => {
        const host = render({ saleRevenueCents: 0 });

        expect(host.querySelector('[data-sale-revenue-card]')).toBeNull();
        expect(text(host)).not.toContain('Venda de veículos');
    });

    /**
     * O backend não manda a venda quebrada por mês (`saleRevenueCents` é
     * escalar da janela). Então a série mensal segue sendo de aluguel e a
     * legenda DIZ isso, com o valor que ficou de fora — é o que impede o
     * usuário de comparar gráfico com card e achar que sumiu dinheiro.
     */
    it('a série mensal declara que é só aluguel e nomeia a venda que ficou de fora', () => {
        const host = render({ saleRevenueCents: 4_500_000 });

        const note = host.querySelector('[data-monthly-chart-note]');
        expect(note).not.toBeNull();
        const noteText = (note?.textContent ?? '').replace(/\s+/g, ' ');
        expect(noteText).toContain('Só aluguel (recorrente)');
        expect(noteText).toContain('45.000,00');
    });

    /**
     * INVARIANTE do nó: sem venda, a tela é IDÊNTICA à de antes. Nem tile, nem
     * nota — uma legenda apontando "o card Venda" num estado em que esse card
     * está oculto mandaria o usuário procurar o que não está lá.
     */
    it('sem venda, não há nota no gráfico — a tela fica como era antes', () => {
        const host = render({ saleRevenueCents: 0 });

        expect(host.querySelector('[data-monthly-chart-note]')).toBeNull();
        expect(text(host)).not.toContain('Só aluguel');
        expect(text(host)).not.toContain('card Venda');
    });
});

/**
 * FEAT-0080 — lembrete persistente pós-pulo: quem pulou o gate cai no
 * dashboard e continua vendo o convite enquanto a frota estiver vazia.
 */
describe('DashboardHome — lembrete de ativação (FEAT-0080)', () => {
  function render(
    hasVehicles: boolean,
    opts: { role?: string | null; admin?: boolean } = {},
  ): { host: HTMLElement; hasVehiclesSpy: ReturnType<typeof vi.fn> } {
    const hasVehiclesSpy = vi.fn().mockReturnValue(of(hasVehicles));
    // `null` é papel válido no teste (sessão sem selectedRole) — só undefined cai no padrão.
    const role = opts.role === undefined ? 'OWNER' : opts.role;
    // Resumo mínimo que satisfaz todos os blocos do template (fleet, finance…).
    const summary = {
      period: { from: '2026-09-01', to: '2026-09-30' },
      alerts: {
        openFines: { count: 0, amountCents: 0 },
        openMaintenances: { count: 0 },
        expiringCnh30d: { count: 0 },
        expiringLicensing30d: { count: 0 },
        reservedRentals: { count: 0 },
        paidFinesInPeriod: { count: 0, amountCents: 0 },
      },
      fleet: {
        vehiclesTotal: 0,
        vehicleLimit: 3,
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

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardHome],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DashboardService,
          useValue: {
            loadOverview: vi.fn().mockReturnValue(of(summary)),
            loadCashAccumulation: vi.fn().mockReturnValue(of(null)),
          },
        },
        { provide: BillingAccessService, useValue: { status: signal(null) } },
        { provide: FleetActivationService, useValue: { hasVehicles: hasVehiclesSpy } },
        {
          provide: SessionService,
          useValue: {
            getItem: (key: string) => (key === 'selectedRole' ? role : null),
            isPlatformAdmin: () => opts.admin ?? false,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(DashboardHome);
    fixture.detectChanges();
    return { host: fixture.nativeElement as HTMLElement, hasVehiclesSpy };
  }

  it('frota vazia → convite discreto (info, não alarme) com link para /veiculos/novo?ativacao=1', () => {
    const { host } = render(false);

    const banner = host.querySelector('[data-activation-reminder]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('cadastre o primeiro veículo');
    // Convite, não alarme: role=status (polite), nunca role=alert.
    expect(banner?.querySelector('[role="status"]')).not.toBeNull();
    expect(banner?.querySelector('[role="alert"]')).toBeNull();

    const link = banner?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/veiculos/novo?ativacao=1');
  });

  it('com veículo na frota o lembrete não existe', () => {
    const { host } = render(true);
    expect(host.querySelector('[data-activation-reminder]')).toBeNull();
  });

  // MESMAS exclusões do guard: fora do papel certo, nem o convite (que
  // apontaria para rota bloqueada pelo roleGuard) nem o GET acontecem.
  it.each(['DRIVER', 'VIEWER', null])(
    'papel %s → sem lembrete e sem consulta de frota',
    (role) => {
      const { host, hasVehiclesSpy } = render(false, { role });
      expect(host.querySelector('[data-activation-reminder]')).toBeNull();
      expect(hasVehiclesSpy).not.toHaveBeenCalled();
    },
  );

  it('PLATFORM_ADMIN → sem lembrete e sem consulta, mesmo com papel OWNER', () => {
    const { host, hasVehiclesSpy } = render(false, { role: 'OWNER', admin: true });
    expect(host.querySelector('[data-activation-reminder]')).toBeNull();
    expect(hasVehiclesSpy).not.toHaveBeenCalled();
  });
});

/**
 * FEAT-0103 — quem ENXERGA o retorno por veiculo.
 *
 * O backend ja resolveu a autorizacao: `/reports/vehicle-roi` passa por
 * `RoleGuard.assertOperatorRole` e devolve 403 para DRIVER, que esta fora da
 * allow-list do `DriverReadScopePolicy`. O front nao reimplementa essa regra —
 * ele so evita PEDIR o que sabe que sera recusado, reusando a MESMA leitura de
 * papel que o lembrete de ativacao ja fazia. Sem isso, todo dashboard aberto por
 * um motorista geraria um 403 e um toast de "Acesso negado" sobre um card que
 * ele nem deveria ver.
 */
describe('DashboardHome — retorno por veiculo por papel', () => {
  /** Envelope minimo que o template inteiro consegue renderizar. */
  function emptySummary(): DashboardSummaryDto {
    return {
      period: { from: '2026-09-01', to: '2026-09-30' },
      alerts: {
        openFines: { count: 0, amountCents: 0 },
        openMaintenances: { count: 0 },
        expiringCnh30d: { count: 0 },
        expiringLicensing30d: { count: 0 },
        reservedRentals: { count: 0 },
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

  function render(role: string | null, vehicles?: unknown[]) {
    const loadVehicleRoi = vi.fn().mockReturnValue(
      of({
        vehicles: [
          {
            vehicleId: 'v-1',
            plate: 'ABC1D23',
            brand: 'Fiat',
            model: 'Argo',
            returnedCents: 100_00,
            returnBreakdown: { rentalCents: 100_00, saleCents: 0 },
            costCents: 50_00,
            costBreakdown: {
              acquisitionCents: 50_00,
              maintenanceCents: 0,
              insuranceCents: 0,
              fineCents: 0,
              incidentCents: 0,
            },
            netCents: 50_00,
            roiPercent: 100,
            paybackMonth: '2026-01',
            paybackReached: true,
            remainingToPaybackCents: 0,
          },
        ],
      }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardHome],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DashboardService,
          useValue: {
            loadOverview: vi.fn().mockReturnValue(of(emptySummary())),
            loadCashAccumulation: vi.fn().mockReturnValue(of(null)),
          },
        },
        { provide: BillingAccessService, useValue: { status: signal(null) } },
        { provide: FleetActivationService, useValue: { hasVehicles: () => of(true) } },
        {
          provide: SessionService,
          useValue: {
            getItem: (key: string) => (key === 'selectedRole' ? role : null),
            isPlatformAdmin: () => false,
          },
        },
        {
          provide: ReportsService,
          useValue: {
            loadVehicleRoi,
            vehicleRoi: signal({ vehicles: vehicles ?? [] }),
            vehicleRoiLoading: signal(false),
            vehicleRoiError: signal(null),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(DashboardHome);
    fixture.detectChanges();
    return { host: fixture.nativeElement as HTMLElement, loadVehicleRoi };
  }

  for (const role of ['OWNER', 'MANAGER']) {
    it(`${role} ve o card e o GET sai`, () => {
      const { host, loadVehicleRoi } = render(role);

      expect(host.textContent).toContain('ROI');
      expect(loadVehicleRoi).toHaveBeenCalledTimes(1);
    });
  }

  it('DRIVER nao ve o card E nao dispara o GET que levaria 403', () => {
    const { host, loadVehicleRoi } = render('DRIVER');

    expect(host.querySelector('[data-roi-card]')).toBeNull();
    expect(loadVehicleRoi).not.toHaveBeenCalled();
  });

  it('sem papel na sessao tambem nao pede nada', () => {
    const { loadVehicleRoi } = render(null);

    expect(loadVehicleRoi).not.toHaveBeenCalled();
  });
});

/**
 * FIX-0420 — o card KPI de ROI da frota.
 *
 * A lista por veiculo saiu daqui (vai para a gerencia do veiculo, FEAT-0119):
 * com 100 carros ela tornava o dashboard inutilizavel no celular. O que fica e
 * UM numero, no formato dos outros KPIs — e um numero que precisa nao mentir
 * quando algum veiculo esta sem preco de compra.
 */
describe('DashboardHome — card KPI de ROI da frota', () => {
  function priced(id: string, costCents: number, returnedCents: number) {
    return {
      vehicleId: id,
      plate: id.toUpperCase(),
      brand: 'Fiat',
      model: 'Argo',
      returnedCents,
      returnBreakdown: { rentalCents: returnedCents, saleCents: 0 },
      costCents,
      costBreakdown: {
        acquisitionCents: costCents,
        maintenanceCents: 0,
        insuranceCents: 0,
        fineCents: 0,
        incidentCents: 0,
      },
      netCents: returnedCents - costCents,
      roiPercent: costCents > 0 ? ((returnedCents - costCents) / costCents) * 100 : null,
      paybackMonth: null,
      paybackReached: false,
      remainingToPaybackCents: Math.max(0, costCents - returnedCents),
    };
  }

  function unpriced(id: string, returnedCents: number) {
    return { ...priced(id, 0, returnedCents), roiPercent: null };
  }

  function card(vehicles: unknown[]): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardHome],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DashboardService,
          useValue: {
            loadOverview: vi.fn().mockReturnValue(of(roiEmptySummary())),
            loadCashAccumulation: vi.fn().mockReturnValue(of(null)),
          },
        },
        { provide: BillingAccessService, useValue: { status: signal(null) } },
        { provide: FleetActivationService, useValue: { hasVehicles: () => of(true) } },
        {
          provide: SessionService,
          useValue: {
            getItem: (key: string) => (key === 'selectedRole' ? 'OWNER' : null),
            isPlatformAdmin: () => false,
          },
        },
        {
          provide: ReportsService,
          useValue: {
            loadVehicleRoi: vi.fn().mockReturnValue(of({ vehicles })),
            vehicleRoi: signal({ vehicles }),
            vehicleRoiLoading: signal(false),
            vehicleRoiError: signal(null),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(DashboardHome);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return host.querySelector('[data-roi-card]') as HTMLElement;
  }

  it('mostra o ROI da frota e o dinheiro devolvido', () => {
    const text = card([priced('a', 10_000_00, 12_000_00)])?.textContent ?? '';

    expect(text).toContain('ROI');
    expect(text).toContain('+20%');
    expect(text).toContain('2.000,00');
    expect(text).toContain('já devolvido');
  });

  /**
   * O CASO QUE ESTE NO EXISTE PARA NAO ERRAR: um carro sem preco de compra entra
   * com custo ZERO e retorno CHEIO. Somando cegamente o card diria +520%; a base
   * honesta diz +20% E DECLARA que fala de 1 de 2 carros.
   */
  describe('veiculo sem preco de compra na frota', () => {
    const frota = [priced('a', 10_000_00, 12_000_00), unpriced('b', 50_000_00)];

    it('nao infla o numero com o carro de custo desconhecido', () => {
      const text = card(frota)?.textContent ?? '';

      expect(text).toContain('+20%');
      expect(text).not.toContain('520');
    });

    it('DECLARA a base em vez de excluir em silencio', () => {
      expect(card(frota)?.textContent).toContain('base: 1 de 2 veículos');
    });

    /**
     * GRADACAO da ressalva. 1 de 2 e metade, nao minoria: rodape discreto, sem
     * alarme. Sem este teste o proximo leitor conclui que toda base parcial vira
     * ambar, e o aviso perde o significado por inflacao.
     */
    it('base que NAO e minoria fica discreta, sem alarme', () => {
      const el = card(frota);

      expect(el?.innerHTML).not.toContain('amber');
      expect(el?.textContent).not.toContain('têm preço de compra');
    });

    /**
     * O PIOR CASO desta tela: o dono le "+35%" sem reparar que aquilo fala de 3
     * carros de 40, e decide comprar mais carro. Com a base em MINORIA a
     * ressalva sai do rodape e ganha peso de aviso — mas o NUMERO CONTINUA na
     * tela: esconder transformaria o cartao em travessao justamente quando ha
     * dado de 3 carros para mostrar.
     */
    describe('base em minoria', () => {
      const minoria = [
        priced('a', 10_000_00, 13_500_00),
        unpriced('b', 0),
        unpriced('c', 0),
        unpriced('d', 0),
      ];

      it('mantem o percentual visivel', () => {
        expect(card(minoria)?.textContent).toContain('+35%');
      });

      it('a ressalva ganha tratamento de aviso, nao rodape', () => {
        const el = card(minoria);

        // Afirma a FORMA, nao a paleta: a ressalva tem caixa propria — fundo E
        // borda —, que e o que a separa de um rodape em texto corrido. Uma
        // assercao em 'bg-amber-50' quebraria a cada mudanca de cor sem que a
        // promessa mudasse, e e por isso que ela nao esta aqui.
        // Localiza a caixa pela FORMA (tem fundo proprio), nao pelo texto: o
        // texto tem acento e casar acento aqui ja falhou uma vez por causa de
        // codificacao — o teste caiu sem que a promessa tivesse mudado.
        const caixa = Array.from(
          el?.querySelectorAll('div[class*="rounded-lg"]') ?? [],
        ).find((d) => (d.getAttribute('class') ?? '').includes('bg-'));

        expect(caixa).toBeTruthy();
        const cls = caixa?.getAttribute('class') ?? '';
        expect(cls).toContain('bg-');
        expect(cls).toContain('border');
      });

      it('o texto diz o que FALTA, nao so a contagem', () => {
        expect(card(minoria)?.textContent).toContain(
          'só 1 de 4 veículos têm preço de compra',
        );
      });

      it('oferece o caminho para cadastrar', () => {
        const links = card(minoria)?.querySelectorAll('a[href]') ?? [];
        const hrefs = Array.from(links).map((a) => a.getAttribute('href'));

        expect(hrefs).toContain('/veiculos');
      });
    });

    it('nao declara base quando todos os veiculos tem preco', () => {
      const text = card([priced('a', 10_000_00, 12_000_00)])?.textContent ?? '';

      expect(text).not.toContain('base:');
    });
  });

  /**
   * Sem base para calcular, o card fica IGUAL aos vizinhos: 0% e o valor
   * embaixo. Nada de travessao e nada de "informe o preco de compra" — numa
   * empresa de frota VAZIA aquilo pedia o preco de um carro que nao existe, na
   * primeira tela que um usuario novo ve (decisao do dono, 2026-09-17).
   */
  describe('sem base para calcular', () => {
    /** `Intl` separa "R$" do numero com espaco NAO-QUEBRAVEL (U+00A0). */
    function money(el: HTMLElement | null): string {
      return (el?.textContent ?? '').replace(/ /g, ' ');
    }

    it('frota vazia mostra 0% e R$ 0,00, sem pedido de acao', () => {
      const el = card([]);

      expect(el?.textContent).toContain('0%');
      expect(money(el)).toContain('R$ 0,00');
      expect(el?.textContent).not.toContain('—');
      expect(el?.textContent).not.toContain('preço de compra');
      expect(el?.querySelector('a[href]')).toBeNull();
    });

    it('frota com carros mas nenhum com preco cai no mesmo 0%', () => {
      const el = card([unpriced('a', 9_000_00)]);

      expect(el?.textContent).toContain('0%');
      expect(money(el)).toContain('R$ 0,00');
      expect(el?.querySelector('a[href]')).toBeNull();
    });

    /** Zero nao e lucro nem prejuizo — nem verde, nem rose. */
    it('o zero fica em tom neutro', () => {
      const html = card([])?.innerHTML ?? '';

      expect(html).not.toContain('text-emerald-700');
      expect(html).not.toContain('text-rose-700');
    });
  });

  it('prejuizo da frota se distingue pelo TEXTO, nao pela cor', () => {
    const prejuizo = card([priced('a', 10_000_00, 4_000_00)]);
    const lucro = card([priced('a', 10_000_00, 12_000_00)]);

    // O cartao tem UMA cor (decisao do dono): o numero e branco tambem no
    // prejuizo. Entao a promessa deixou de ser "prejuizo tem cor propria" e
    // passou a ser esta — e ela precisa continuar sendo verificavel, senao a
    // troca de paleta teria simplesmente APAGADO uma garantia em vez de
    // move-la.
    //
    // O sinal de menos e a palavra carregam o recado sozinhos, e carregam
    // melhor: cor nao e lida por quem enxerga pouco, nem por leitor de tela.
    expect(prejuizo?.textContent).toContain('-60%');
    expect(prejuizo?.textContent).toContain('no prejuízo');

    expect(lucro?.textContent).not.toContain('no prejuízo');
    expect(lucro?.textContent).not.toContain('-');

    // E a cor NAO distingue mais — afirmado de proposito, para que voltar a
    // pintar por tom exija mexer aqui e reabrir a conversa.
    const corDe = (el: HTMLElement | null | undefined): string =>
      el?.querySelector('p.tabular-nums')?.getAttribute('class') ?? '';

    expect(corDe(prejuizo)).not.toBe('');
    expect(corDe(prejuizo)).toBe(corDe(lucro));
  });

  /** Envelope minimo para o template inteiro renderizar. */
  function roiEmptySummary(): DashboardSummaryDto {
    return {
      period: { from: '2026-09-01', to: '2026-09-30' },
      alerts: {
        openFines: { count: 0, amountCents: 0 },
        openMaintenances: { count: 0 },
        expiringCnh30d: { count: 0 },
        expiringLicensing30d: { count: 0 },
        reservedRentals: { count: 0 },
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
});
