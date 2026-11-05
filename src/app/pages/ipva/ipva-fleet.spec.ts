import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FleetFinanceService } from '../../services/fleet-finance.service';
import { NotificationService } from '../../services/notification.service';
import { VehicleIpvaService } from '../../services/vehicle-ipva.service';
import type { IpvaFleetRow, IpvaFleetSummary } from '../../types/fleet-finance.types';
import type { VehicleListItem } from '../../types/vehicle.types';
import { IpvaFleet } from './ipva-fleet';

/**
 * Página IPVA da frota: os números do topo vêm do `/ipva/summary` (a tela não soma a lista,
 * que é paginada); as abas de ano e de situação viram parâmetros da requisição; a linha leva à
 * Gerência do carro no mesmo ano; "Adicionar IPVA" escolhe um carro e gera as parcelas.
 */
describe('IpvaFleet', () => {
  const YEAR = Number(new Date().toISOString().slice(0, 4));

  const summary: IpvaFleetSummary = {
    year: YEAR,
    vehiclesWithIpva: 2,
    totalCents: 600_000,
    paidCents: 150_000,
    openCents: 450_000,
    overdueCount: 1,
    overdueCents: 100_000,
    nextDueDate: `${YEAR}-12-10`,
  };

  const rows: IpvaFleetRow[] = [
    {
      vehicleId: 'v1',
      vehiclePlate: 'ABC1D23',
      vehicleBrand: 'Fiat',
      vehicleModel: 'Argo',
      year: YEAR,
      totalCents: 300_000,
      paidCents: 150_000,
      openCents: 150_000,
      installmentsCount: 2,
      paidCount: 1,
      overdueCount: 1,
      nextDueDate: `${YEAR}-10-10`,
      status: 'OVERDUE',
    },
  ];

  let fleet: {
    ipvaSummary: ReturnType<typeof vi.fn>;
    ipvaList: ReturnType<typeof vi.fn>;
    pickVehicles: ReturnType<typeof vi.fn>;
  };
  let ipva: { generate: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<IpvaFleet>;

  const el = () => fixture.nativeElement as HTMLElement;
  const doc = () => el().ownerDocument;
  const text = (node: Element | null) =>
    (node?.textContent ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

  function type(selector: string, value: string): void {
    const input = doc().querySelector<HTMLInputElement>(selector);
    expect(input, selector).not.toBeNull();
    input!.value = value;
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(IpvaFleet);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    fleet = {
      ipvaSummary: vi.fn().mockReturnValue(of(summary)),
      ipvaList: vi.fn().mockReturnValue(of({ content: rows, page: 0, size: 20, total: 1 })),
      pickVehicles: vi.fn().mockReturnValue(
        of({
          content: [
            { id: 'v9', plate: 'XYZ9W87', brand: 'Toyota', model: 'Yaris', yearModel: 2024 } as VehicleListItem,
          ],
          page: 0,
          size: 50,
          total: 1,
        }),
      ),
    };
    ipva = { generate: vi.fn() };
    TestBed.configureTestingModule({
      imports: [IpvaFleet],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: FleetFinanceService, useValue: fleet },
        { provide: VehicleIpvaService, useValue: ipva },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
  });

  it('opens on the current year and shows the server summary in the KPIs', async () => {
    await render();

    expect(fleet.ipvaSummary).toHaveBeenCalledWith(YEAR);
    expect(fleet.ipvaList).toHaveBeenCalledWith(
      expect.objectContaining({ year: YEAR, status: undefined, page: 0 }),
    );
    expect(el().querySelector('[data-kpi="total"]')).not.toBeNull();
    expect(text(el().querySelector('[data-kpi="total"]'))).toContain('2 veículos');
    expect(text(el().querySelector('[data-kpi="paid"]'))).toContain('25% do total');
    expect(text(el().querySelector('[data-kpi="open"]'))).toContain('próximo em 10/12');
    // Mesmo vocabulário de Cupons: todo cartão leva um ícone ao lado do rótulo.
    expect(el().querySelectorAll('[data-kpi] app-kpi-glyph').length).toBe(4);
  });

  it('lists one row per vehicle with the status chip', async () => {
    await render();
    const list = el().querySelectorAll('[data-testid="ipva-row"]');
    expect(list.length).toBe(1);
    expect(text(list[0])).toContain('ABC-1D23');
    expect(text(list[0])).toContain('Vencido');
    expect(text(list[0])).toContain('1 parcela vencida');
  });

  it('the status tab goes to the server as a filter; the year tab reloads the summary too', async () => {
    await render();

    el().querySelector<HTMLButtonElement>('[data-testid="status-OVERDUE"]')!.click();
    fixture.detectChanges();
    expect(fleet.ipvaList).toHaveBeenLastCalledWith(
      expect.objectContaining({ year: YEAR, status: 'OVERDUE' }),
    );

    el().querySelector<HTMLButtonElement>(`[data-testid="year-${YEAR - 1}"]`)!.click();
    fixture.detectChanges();
    expect(fleet.ipvaSummary).toHaveBeenLastCalledWith(YEAR - 1);
    expect(fleet.ipvaList).toHaveBeenLastCalledWith(
      expect.objectContaining({ year: YEAR - 1, status: 'OVERDUE' }),
    );
  });

  it('tapping a row opens the vehicle Gerência on the same IPVA year', async () => {
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    el().querySelector<HTMLElement>('[data-testid="ipva-row"]')!.click();

    expect(navigate).toHaveBeenCalledWith(['/veiculos', 'v1'], {
      queryParams: { aba: 'gerencia', ipva: YEAR },
    });
  });

  it('"Adicionar IPVA" picks a vehicle without IPVA in the year, then generates the installments', async () => {
    await render();
    ipva.generate.mockReturnValue(of({}));

    el().querySelector<HTMLButtonElement>('[data-testid="add-ipva"]')!.click();
    fixture.detectChanges();
    expect(fleet.pickVehicles).toHaveBeenCalledWith({ kind: 'withoutIpvaYear', year: YEAR }, '');

    doc().querySelector<HTMLButtonElement>('[data-testid="picker-option"]')!.click();
    fixture.detectChanges();
    expect(doc().querySelector('[data-sheet-step="generate"]')).not.toBeNull();

    type('#ipva-fleet-total', '1000,00');
    type('#ipva-fleet-count', '3');
    type('#ipva-fleet-first-due', `${YEAR}-12-10`);
    fixture.detectChanges();
    expect(text(doc().querySelector('[data-testid="ipva-preview"]'))).toContain('1x de');

    doc()
      .querySelector<HTMLFormElement>('#ipva-fleet-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(ipva.generate).toHaveBeenCalledWith('v9', YEAR, {
      totalCents: 100_000,
      installments: 3,
      firstDueDate: `${YEAR}-12-10`,
    });
    // Depois de gerar, topo e lista são relidos.
    expect(fleet.ipvaSummary).toHaveBeenCalledTimes(2);
  });

  it('an invalid amount never reaches the server', async () => {
    await render();
    el().querySelector<HTMLButtonElement>('[data-testid="add-ipva"]')!.click();
    fixture.detectChanges();
    doc().querySelector<HTMLButtonElement>('[data-testid="picker-option"]')!.click();
    fixture.detectChanges();

    type('#ipva-fleet-first-due', `${YEAR}-12-10`);
    doc()
      .querySelector<HTMLFormElement>('#ipva-fleet-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(ipva.generate).not.toHaveBeenCalled();
  });

  it('a year with no IPVA offers the first one', async () => {
    fleet.ipvaSummary.mockReturnValue(of({ ...summary, vehiclesWithIpva: 0, totalCents: 0, paidCents: 0 }));
    fleet.ipvaList.mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));
    await render();
    expect(text(el().querySelector('[data-testid="empty"]'))).toContain(`Nenhum IPVA lançado em ${YEAR}`);
    expect(el().querySelector('[data-testid="empty-add"]')).not.toBeNull();
  });
});
