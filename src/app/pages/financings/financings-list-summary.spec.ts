import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FleetFinanceService } from '../../services/fleet-finance.service';
import { NotificationService } from '../../services/notification.service';
import { VehiclesService } from '../../services/vehicles.service';
import type { FinancingListItem } from '../../types/vehicle.types';
import { FinancingsList } from './financings-list';

/**
 * STORY-VEHICLE-FINANCE — topo com os números da frota (do servidor) e "Adicionar
 * financiamento", que escolhe um carro sem financiamento ativo e segue para o formulário do
 * veículo com o bloco aberto. Na Gerência de um carro (prefiltro) nenhum dos dois aparece.
 */
describe('FinancingsList — resumo e Adicionar financiamento', () => {
  let fleet: { financingsSummary: ReturnType<typeof vi.fn>; pickVehicles: ReturnType<typeof vi.fn> };
  let listSpy: ReturnType<typeof vi.fn>;
  let rows: ReturnType<typeof signal<FinancingListItem[]>>;

  const financing: FinancingListItem = {
    id: 'fin-1',
    createdDate: '2026-01-02T10:00:00Z',
    vehicleId: 'v-1',
    vehiclePlate: 'ABC1D23',
    vehicleBrand: 'Fiat',
    vehicleModel: 'Argo',
    contractDate: '2026-01-01',
    purchasePrice: 8_000_000,
    totalFinanced: 6_000_000,
    installments: 48,
    installmentAmount: 150_000,
    status: 'ACTIVE',
    paidOffDate: null,
    overdueInstallments: 0,
  };

  beforeEach(() => {
    rows = signal<FinancingListItem[]>([financing]);
    fleet = {
      financingsSummary: vi.fn().mockReturnValue(
        of({
          activeCount: 4,
          paidOffCount: 2,
          overdueInstallments: 3,
          totalFinancedActive: 12_000_000,
          monthlyInstallmentsActive: 450_000,
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
    listSpy = vi.fn().mockReturnValue(of({ content: [], total: 0, page: 0, size: 20 }));
    TestBed.configureTestingModule({
      imports: [FinancingsList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: VehiclesService,
          useValue: {
            financings: rows,
            financingsLoading: signal(false),
            financingsError: signal<string | null>(null),
            financingsPage: signal(0),
            financingsSize: signal(20),
            financingsTotal: signal(0),
            list: vi.fn().mockReturnValue(of({ content: [], total: 0 })),
            listFleetFinancings: listSpy,
          },
        },
        { provide: FleetFinanceService, useValue: fleet },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
  });

  it('shows the fleet numbers from the server', () => {
    const fixture = TestBed.createComponent(FinancingsList);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(fleet.financingsSummary).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-kpi="active"]')?.textContent).toContain('2 quitados');
    expect(host.querySelector('[data-kpi="overdue"]')?.textContent).toContain('nos contratos ativos');
    expect(host.querySelectorAll('[data-kpi] app-kpi-glyph').length).toBe(4);
  });

  it('the status pill is the same server filter the select used to be', () => {
    const fixture = TestBed.createComponent(FinancingsList);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="status-PAID_OFF"]')!
      .click();

    expect(listSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'PAID_OFF', page: 0 }),
    );
  });

  it('"Adicionar financiamento" picks a vehicle and opens its form with the block open', () => {
    const fixture = TestBed.createComponent(FinancingsList);
    fixture.detectChanges();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>('[data-testid="add-financing"]')!.click();
    fixture.detectChanges();
    expect(fleet.pickVehicles).toHaveBeenCalledWith({ kind: 'withoutActiveFinancing' }, '');

    host.ownerDocument.querySelector<HTMLButtonElement>('[data-testid="picker-option"]')!.click();

    expect(navigate).toHaveBeenCalledWith(['/veiculos', 'v9', 'editar'], {
      queryParams: { abrir: 'financiamento' },
    });
  });

  it('an empty fleet hides the filters and offers the first one, like Cupons', () => {
    rows.set([]);
    const fixture = TestBed.createComponent(FinancingsList);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="add-financing"]')).toBeNull();
    expect(host.querySelector('#fin-sort')).toBeNull();
    host.querySelector<HTMLButtonElement>('[data-testid="empty-add"]')!.click();
    fixture.detectChanges();
    expect(host.ownerDocument.querySelector('[data-testid="vehicle-picker"]')).not.toBeNull();
  });

  it('inside one vehicle Gerência there is no fleet summary and no picker', () => {
    const fixture = TestBed.createComponent(FinancingsList);
    fixture.componentRef.setInput('vehicleIdPrefilter', 'v-1');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(fleet.financingsSummary).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="financing-kpis"]')).toBeNull();
    expect(host.querySelector('[data-testid="add-financing"]')).toBeNull();
  });
});
