import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';

import { DashboardHome } from './dashboard-home';
import { DashboardService } from '../../services/dashboard.service';
import type { DashboardSummaryDto, FleetDto } from '../../types/dashboard.types';

/**
 * Cobre o KPI de motoristas do dashboard:
 *  - o numerador de "X de Y do plano" vem de `fleet.driversTotal` (mesmo
 *    predicado do bloqueio no backend), NUNCA de `driversActive` — era essa
 *    divergência que fazia a tela dizer "2 de 5" e o cadastro devolver 409;
 *  - `driverLimit` nulo (PRO) mostra "ilimitado", sem "X de null"/"X de 0".
 *
 * E o KPI de veículos, que divide a mesma grade e precisa ler igual:
 *  - `vehicleLimit` nulo (ENTERPRISE) troca a frase inteira, em vez de
 *    interpolar um denominador quebrado ("2 de sem limite do plano").
 */
describe('DashboardHome — KPIs de frota', () => {
    function summaryWithFleet(fleet: Partial<FleetDto>): DashboardSummaryDto {
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
                driverLimit: 4,
                rentedNow: 1,
                reservedNow: 0,
                utilizationPct: 50,
                ...fleet,
            },
            finance: {
                revenueCents: 0,
                receivedCents: 0,
                expensesCents: 0,
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
        };
    }

    /** Texto de um card da grade de KPIs, pelo título, com espaços normalizados. */
    function cardText(fleet: Partial<FleetDto>, title: string): string {
        const loadSpy = vi.fn().mockReturnValue(of(summaryWithFleet(fleet)));

        TestBed.configureTestingModule({
            imports: [DashboardHome],
            providers: [
                provideRouter([]),
                provideNoopAnimations(),
                { provide: DashboardService, useValue: { loadOverview: loadSpy } },
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
    function driversCardText(fleet: Partial<FleetDto>): string {
        return cardText(fleet, 'Motoristas');
    }

    /** Texto do card "Veículos" da grade de KPIs. */
    function vehiclesCardText(fleet: Partial<FleetDto>): string {
        return cardText(fleet, 'Veículos');
    }

    it('usa driversTotal como numerador do limite do plano, não driversActive', () => {
        const text = driversCardText({ driversActive: 2, driversTotal: 4, driverLimit: 4 });

        expect(text).toContain('4 de 4 do plano');
        expect(text).not.toContain('2 de 4');
    });

    it('mostra os motoristas ativos como recorte operacional secundário', () => {
        const text = driversCardText({ driversActive: 2, driversTotal: 4, driverLimit: 4 });

        expect(text).toContain('2 ativos agora');
    });

    it('mostra "ilimitado" quando driverLimit é nulo (PRO), sem número quebrado', () => {
        const text = driversCardText({ driversActive: 5, driversTotal: 9, driverLimit: null });

        expect(text).toContain('ilimitados');
        expect(text).not.toContain('de null');
        expect(text).not.toContain('9 de 0');
        expect(text).not.toContain('de sem limite');
    });

    it('mostra "X de Y do plano" quando vehicleLimit é numérico', () => {
        const text = vehiclesCardText({ vehiclesTotal: 2, vehicleLimit: 3 });

        expect(text).toContain('2 de 3 do plano');
    });

    it('mostra "ilimitado" quando vehicleLimit é nulo (ENTERPRISE), sem frase quebrada', () => {
        const text = vehiclesCardText({ vehiclesTotal: 12, vehicleLimit: null });

        expect(text).toContain('ilimitados');
        expect(text).not.toContain('de sem limite');
        expect(text).not.toContain('de null');
        expect(text).not.toContain('12 de 0');
    });
});
