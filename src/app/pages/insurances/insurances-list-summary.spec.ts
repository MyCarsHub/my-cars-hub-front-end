import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FleetFinanceService } from '../../services/fleet-finance.service';
import { InsurancesService } from '../../services/insurances.service';
import { NotificationService } from '../../services/notification.service';
import { VehiclesService } from '../../services/vehicles.service';
import type { InsuranceListItem } from '../../types/insurance.types';
import { InsurancesList } from './insurances-list';

/**
 * STORY-VEHICLE-FINANCE — topo com os números da frota (do servidor, janela de 30 dias) e
 * "Adicionar seguro", que escolhe um carro sem apólice ativa e segue para o formulário do
 * veículo com o bloco aberto. Na Gerência de um carro (prefiltro) nenhum dos dois aparece.
 */
describe('InsurancesList — resumo e Adicionar seguro', () => {
  let rows: ReturnType<typeof signal<InsuranceListItem[]>>;
  const insurance: InsuranceListItem = {
    id: 'ins-1',
    createdDate: '2026-01-02T10:00:00Z',
    vehicleId: 'v-1',
    vehiclePlate: 'ABC1D23',
    vehicleBrand: 'Fiat',
    vehicleModel: 'Argo',
    insurer: 'Porto Seguro',
    policyNumber: 'AP-99887',
    coverageType: 'COMPREHENSIVE',
    premiumAmount: 240_050,
    deductibleAmount: 300_000,
    startDate: '2026-01-01',
    endDate: '2027-01-01',
    paymentMethod: 'CREDIT_CARD',
    status: 'ACTIVE',
    cancelledDate: null,
    daysToExpiry: 90,
  };
  let fleet: { insurancesSummary: ReturnType<typeof vi.fn>; pickVehicles: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    rows = signal<InsuranceListItem[]>([insurance]);
    fleet = {
      insurancesSummary: vi.fn().mockReturnValue(
        of({
          activeCount: 5,
          expiringSoonCount: 2,
          expiredCount: 1,
          cancelledCount: 3,
          premiumTotalActive: 900_000,
        }),
      ),
      pickVehicles: vi.fn().mockReturnValue(
        of({
          content: [{ id: 'v9', plate: 'XYZ9W87', brand: 'Toyota', model: 'Yaris', yearModel: 2024 }],
          page: 0,
          size: 50,
          total: 1,
        }),
      ),
    };
    TestBed.configureTestingModule({
      imports: [InsurancesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: InsurancesService,
          useValue: {
            insurances: rows,
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(0),
            list: vi.fn().mockReturnValue(of({ content: [], total: 0, page: 0, size: 20 })),
          },
        },
        {
          provide: VehiclesService,
          useValue: { list: vi.fn().mockReturnValue(of({ content: [], total: 0 })) },
        },
        { provide: FleetFinanceService, useValue: fleet },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
  });

  it('asks the summary for the 30-day window and shows it', () => {
    const fixture = TestBed.createComponent(InsurancesList);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(fleet.insurancesSummary).toHaveBeenCalledWith(30);
    expect(host.querySelector('[data-kpi="active"]')?.textContent).toContain('3 canceladas');
    expect(host.querySelector('[data-kpi="expiring"]')?.textContent).toContain('Vencem em 30 dias');
    expect(host.querySelectorAll('[data-kpi] app-kpi-glyph').length).toBe(4);
  });

  it('"Adicionar seguro" picks a vehicle and opens its form with the block open', () => {
    const fixture = TestBed.createComponent(InsurancesList);
    fixture.detectChanges();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>('[data-testid="add-insurance"]')!.click();
    fixture.detectChanges();
    expect(fleet.pickVehicles).toHaveBeenCalledWith({ kind: 'withoutActiveInsurance' }, '');

    host.ownerDocument.querySelector<HTMLButtonElement>('[data-testid="picker-option"]')!.click();

    expect(navigate).toHaveBeenCalledWith(['/veiculos', 'v9', 'editar'], {
      queryParams: { abrir: 'seguro' },
    });
  });

  it('an empty fleet hides the filters and offers the first one, like Cupons', () => {
    rows.set([]);
    const fixture = TestBed.createComponent(InsurancesList);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="add-insurance"]')).toBeNull();
    expect(host.querySelector('#seg-sort')).toBeNull();
    host.querySelector<HTMLButtonElement>('[data-testid="empty-add"]')!.click();
    fixture.detectChanges();
    expect(host.ownerDocument.querySelector('[data-testid="vehicle-picker"]')).not.toBeNull();
  });

  it('only the status chip carries the expiry colour, never the card or the row', () => {
    rows.set([{ ...insurance, daysToExpiry: 3 }]);
    const fixture = TestBed.createComponent(InsurancesList);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const records = Array.from(host.querySelectorAll<HTMLElement>('article, tbody tr'));
    expect(records.length).toBe(2);
    for (const record of records) {
      expect(record.className).not.toMatch(/bg-(rose|amber|red|orange)-/);
    }
    expect(host.textContent).toContain('Vence em 3d');
  });

  it('inside one vehicle Gerência there is no fleet summary and no picker', () => {
    const fixture = TestBed.createComponent(InsurancesList);
    fixture.componentRef.setInput('vehicleIdPrefilter', 'v-1');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(fleet.insurancesSummary).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="insurance-kpis"]')).toBeNull();
    expect(host.querySelector('[data-testid="add-insurance"]')).toBeNull();
  });
});
