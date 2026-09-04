import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';

import { DashboardHome } from './dashboard-home';
import { BillingAccessService } from '../../services/billing-access.service';
import { DashboardService } from '../../services/dashboard.service';
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
                { provide: DashboardService, useValue: { loadOverview: loadSpy } },
                { provide: BillingAccessService, useValue: { status } },
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
                    useValue: { loadOverview: vi.fn().mockReturnValue(of(summary)) },
                },
                { provide: BillingAccessService, useValue: { status: signal(null) } },
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
