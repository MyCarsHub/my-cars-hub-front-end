import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { MaintenancesList } from './maintenances-list';
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import type { MaintenanceListItem } from '../../types/maintenance.types';

/**
 * Cobre a coluna de ações padronizada (menu de 3 pontos) da listagem de manutenções:
 *  - Editar / Excluir presentes no menu, iguais em mobile e desktop;
 *  - "Excluir" só chama o service depois da confirmação no diálogo;
 *  - erro do servidor mantém a manutenção na lista e mostra a mensagem inline.
 */
describe('MaintenancesList — menu de ações', () => {
  const maintenance: MaintenanceListItem = {
    id: 'm-1',
    vehicleId: 'v-1',
    type: 'PREVENTIVE',
    description: 'Troca de óleo',
    serviceDate: '2026-01-05',
    hodometerReading: 45000,
    costCents: 25000,
    nextServiceDate: '2026-07-05',
    status: 'DONE',
    createdDate: '2026-01-06T10:00:00Z',
  };

  let items: ReturnType<typeof signal<MaintenanceListItem[]>>;
  let removeSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    items = signal<MaintenanceListItem[]>([maintenance]);
    removeSpy = vi.fn().mockReturnValue(of(void 0));
    errorSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [MaintenancesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: MaintenancesService,
          useValue: {
            items,
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(1),
            list: vi.fn().mockReturnValue(of({ content: [maintenance], totalElements: 1 })),
            remove: removeSpy,
          },
        },
        {
          provide: VehiclesService,
          useValue: { list: vi.fn().mockReturnValue(of({ content: [], totalElements: 0 })) },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: errorSpy } },
      ],
    });
  }

  /** Abre o menu de ações do escopo informado e devolve seus itens já renderizados. */
  function openMenuItems(
    fixture: { nativeElement: unknown; detectChanges: () => void },
    scope: 'mobile' | 'desktop',
  ): HTMLElement[] {
    const host = fixture.nativeElement as HTMLElement;
    const containers = Array.from(host.querySelectorAll('app-actions-menu'));
    // Os cards mobile vêm antes da tabela desktop no template.
    const container = scope === 'mobile' ? containers[0] : containers[containers.length - 1];
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    configure();
  });

  it.each(['mobile', 'desktop'] as const)('expõe Editar e Excluir no menu (%s)', (scope) => {
    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const labels = openMenuItems(fixture, scope).map((el) => el.textContent?.trim());

    expect(labels).toContain('Editar');
    expect(labels).toContain('Excluir');
  });

  it('"Editar" aponta para a rota de edição da manutenção', () => {
    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const hrefs = openMenuItems(fixture, 'mobile')
      .filter((el): el is HTMLAnchorElement => el.tagName === 'A')
      .map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/manutencoes/m-1/editar');
  });

  it('"Excluir" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      deleting: () => MaintenanceListItem | null;
      confirmDelete: () => void;
    };

    openMenuItems(fixture, 'mobile')
      .find((el) => el.textContent?.trim() === 'Excluir')
      ?.click();
    fixture.detectChanges();

    expect(component.deleting()?.id).toBe('m-1');
    expect(removeSpy).not.toHaveBeenCalled();

    component.confirmDelete();
    expect(removeSpy).toHaveBeenCalledWith('m-1');
  });

  it('erro do servidor mantém a manutenção na lista e mostra a mensagem inline, sem toast', () => {
    removeSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({ status: 409, error: { message: 'Manutenção em andamento.' } }),
      ),
    );

    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      askDelete: (m: MaintenanceListItem) => void;
      confirmDelete: () => void;
    };

    component.askDelete(maintenance);
    component.confirmDelete();
    fixture.detectChanges();

    expect(items()).toHaveLength(1);

    const banners = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-alert-banner'),
    );
    expect(banners.some((b) => b.textContent?.includes('Manutenção em andamento.'))).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
