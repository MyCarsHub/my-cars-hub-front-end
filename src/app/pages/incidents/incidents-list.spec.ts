import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IncidentsList } from './incidents-list';
import { VehicleIncidentsService } from '../../services/vehicle-incidents.service';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import type {
  VehicleIncidentFilters,
  VehicleIncidentListItem,
  VehicleIncidentSummary,
} from '../../types/vehicle-incident.types';

/**
 * Visão consolidada de sinistros.
 *
 * Dois contratos travados aqui: as DUAS situações aparecem sempre rotuladas com
 * a dimensão a que pertencem, e nenhum dado pessoal de terceiro chega a esta
 * tela — o backend o mantém fora da listagem de propósito e o front não pode
 * reintroduzi-lo.
 */
describe('IncidentsList', () => {
  const incident: VehicleIncidentListItem = {
    id: 'inc-1',
    vehicleId: 'v-1',
    rentalId: null,
    driverId: null,
    incidentType: 'COLLISION',
    incidentTypeLabel: 'Colisão',
    occurredAt: '2026-03-01T09:00:00',
    location: 'Av. Paulista',
    estimatedCostCents: 250000,
    actualCostCents: 180000,
    resolutionStatus: 'IN_REPAIR',
    resolutionStatusLabel: 'Em reparo',
    insuranceStatus: 'FILED',
    insuranceStatusLabel: 'Aberto na seguradora',
    insuranceClaimNumber: 'SIN-1',
    createdDate: '2026-03-01T10:00:00',
  };

  const summaryData: VehicleIncidentSummary = {
    openCount: 2,
    inRepairCount: 3,
    activeCount: 5,
    writtenOffCount: 1,
    totalEstimatedCostCents: 1_000_000,
    totalActualCostCents: 750_000,
    totalIndemnifiedCents: 300_000,
    totalNetCostCents: 450_000,
  };

  let items: ReturnType<typeof signal<VehicleIncidentListItem[]>>;
  let list: ReturnType<typeof vi.fn>;
  let summary: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let errorToast: ReturnType<typeof vi.fn>;

  function configure(): void {
    items = signal<VehicleIncidentListItem[]>([incident]);
    list = vi.fn(() => of({ content: [incident], page: 0, size: 20, total: 1 }));
    summary = vi.fn(() => of(summaryData));
    remove = vi.fn(() => of(void 0));
    errorToast = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [IncidentsList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: VehicleIncidentsService,
          useValue: {
            items,
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(1),
            list,
            summary,
            remove,
          },
        },
        {
          provide: VehiclesService,
          useValue: {
            list: vi.fn(() =>
              of({
                content: [{ id: 'v-1', plate: 'ABC1D23', brand: 'Fiat', model: 'Argo' }],
                total: 1,
              }),
            ),
          },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: errorToast } },
      ],
    });
  }

  beforeEach(() => configure());

  function render(): ReturnType<typeof TestBed.createComponent<IncidentsList>> {
    const fixture = TestBed.createComponent(IncidentsList);
    fixture.detectChanges();
    return fixture;
  }

  it('mostra as duas situações com o prefixo da sua dimensão', () => {
    const fixture = render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Veículo: Em reparo');
    expect(text).toContain('Seguro: Aberto na seguradora');
  });

  /**
   * LGPD: `VehicleIncidentListItemDto` não traz `thirdParty*` e esta tela não
   * pode buscá-los por baixo para "enriquecer" a lista. Se alguém adicionar um
   * `getOne()` por linha aqui, este teste cai.
   */
  it('não expõe dado de terceiro nem busca o detalhe para enriquecer a linha', () => {
    const fixture = render();
    const service = TestBed.inject(VehicleIncidentsService) as unknown as Record<string, unknown>;

    expect(service['getOne']).toBeUndefined();
    expect(Object.keys(incident)).not.toContain('thirdPartyName');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('thirdParty');
  });

  it('usa o endpoint /summary em vez de somar a página corrente', () => {
    const fixture = render();

    expect(summary).toHaveBeenCalledTimes(1);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // activeCount = 5, e não os 1 item da página.
    expect(text).toContain('5');
    expect(text).toContain('Em aberto + em reparo');
  });

  it('o resumo falhar não apaga a lista', () => {
    summary.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    const fixture = render();

    expect((fixture.nativeElement as HTMLElement).querySelector('article')).not.toBeNull();
  });

  it('o filtro ACTIVE traz aberto + em reparo numa chamada só', () => {
    const fixture = render();
    const component = fixture.componentInstance as unknown as {
      resolutionFilter: { set(v: string): void };
      onFilterChange(): void;
    };

    component.resolutionFilter.set('ACTIVE');
    component.onFilterChange();

    const lastCall = list.mock.calls[list.mock.calls.length - 1] as [VehicleIncidentFilters];
    expect(lastCall[0].resolutionStatus).toBe('ACTIVE');
  });

  it('card e linha navegam para o detalhe pelo teclado, com nome acessível', () => {
    const fixture = render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const host = fixture.nativeElement as HTMLElement;

    const card = host.querySelector('article');
    expect(card?.getAttribute('role')).toBe('button');
    expect(card?.getAttribute('aria-label')).toContain('Colisão');

    const cardSpace = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    card?.dispatchEvent(cardSpace);
    expect(cardSpace.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenLastCalledWith(['/sinistros', 'inc-1']);

    const row = host.querySelector('tbody tr');
    expect(row?.getAttribute('aria-label')).toContain('Colisão');
  });

  it('excluir só chama o service depois da confirmação', () => {
    const fixture = render();
    const component = fixture.componentInstance as unknown as {
      askDelete(i: VehicleIncidentListItem): void;
      confirmDelete(): void;
    };

    component.askDelete(incident);
    expect(remove).not.toHaveBeenCalled();

    component.confirmDelete();
    expect(remove).toHaveBeenCalledWith('inc-1');
  });

  it('erro ao excluir aparece inline, sem toast', () => {
    remove.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({ status: 409, error: { message: 'Sinistro não pode ser removido.' } }),
      ),
    );
    const fixture = render();
    const component = fixture.componentInstance as unknown as {
      askDelete(i: VehicleIncidentListItem): void;
      confirmDelete(): void;
    };

    component.askDelete(incident);
    component.confirmDelete();
    fixture.detectChanges();

    const banners = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-alert-banner'),
    );
    expect(banners.some((b) => b.textContent?.includes('Sinistro não pode ser removido.'))).toBe(
      true,
    );
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('micro-labels usam neutral-500 (contraste AA), nunca neutral-400', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('article span.text-neutral-500').length).toBeGreaterThan(0);
    expect(host.querySelector('.text-neutral-400')).toBeNull();
  });
});
