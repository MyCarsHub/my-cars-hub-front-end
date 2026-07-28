import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { VehiclesList } from './vehicles-list';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import type { VehicleListItem } from '../../types/vehicle.types';

/**
 * Cobre as ações do menu "Ações" da listagem de veículos:
 *  - Gerenciar / Editar / Remover presentes no menu (mobile e desktop);
 *  - "Remover" só chama o service depois da confirmação no diálogo;
 *  - erro do servidor mantém o item na lista e mostra a mensagem do backend inline.
 */
describe('VehiclesList — menu de ações', () => {
  const vehicle: VehicleListItem = {
    id: 'v-1',
    plate: 'ABC1D23',
    type: 'CAR',
    brand: 'Fiat',
    model: 'Argo',
    yearModel: 2022,
    licensingExpiration: null,
    status: 'AVAILABLE',
    createdDate: '2024-01-01',
  };

  let items: ReturnType<typeof signal<VehicleListItem[]>>;
  let removeSpy: ReturnType<typeof vi.fn>;
  let listSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    items = signal<VehicleListItem[]>([vehicle]);
    removeSpy = vi.fn().mockReturnValue(of(void 0));
    listSpy = vi.fn().mockReturnValue(of({ content: [vehicle], totalElements: 1 }));
    errorSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [VehiclesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: VehiclesService,
          useValue: {
            items,
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(1),
            list: listSpy,
            remove: removeSpy,
            updateStatus: vi.fn().mockReturnValue(of(vehicle)),
          },
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

  it.each(['mobile', 'desktop'] as const)(
    'expõe Gerenciar, Editar e Remover no menu (%s)',
    (scope) => {
      const fixture = TestBed.createComponent(VehiclesList);
      fixture.detectChanges();

      const menuItems = openMenuItems(fixture, scope);
      const labels = menuItems.map((el) => el.textContent?.trim());

      expect(menuItems.length).toBeGreaterThan(0);
      expect(labels).toContain('Gerenciar');
      expect(labels).toContain('Editar');
      expect(labels).toContain('Remover');
    },
  );

  it('Gerenciar e Editar apontam para as rotas de gerência e edição', () => {
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();

    const hrefs = openMenuItems(fixture, 'mobile')
      .filter((el): el is HTMLAnchorElement => el.tagName === 'A')
      .map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/veiculos/v-1/gerencia');
    expect(hrefs).toContain('/veiculos/v-1/editar');
  });

  it('"Remover" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      deletingVehicle: () => VehicleListItem | null;
      deleteMessage: () => string;
      confirmDelete: () => void;
    };

    const remove = openMenuItems(fixture, 'mobile').find(
      (el) => el.textContent?.trim() === 'Remover',
    );
    remove?.click();
    fixture.detectChanges();

    expect(component.deletingVehicle()?.id).toBe('v-1');
    expect(component.deleteMessage()).toContain('ABC-1D23');
    expect(component.deleteMessage()).toContain('não pode ser desfeita');
    expect(removeSpy).not.toHaveBeenCalled();

    component.confirmDelete();
    expect(removeSpy).toHaveBeenCalledWith('v-1');
  });

  it('erro do servidor mantém o veículo na lista e mostra a mensagem inline, sem toast', () => {
    removeSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Veículo possui aluguel ativo.' },
          }),
      ),
    );

    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      askDelete: (v: VehicleListItem) => void;
      confirmDelete: () => void;
    };

    component.askDelete(vehicle);
    component.confirmDelete();
    fixture.detectChanges();

    expect(removeSpy).toHaveBeenCalledWith('v-1');
    expect(items()).toHaveLength(1);

    // Feedback standard: banner inline, nunca toast.
    const banner = (fixture.nativeElement as HTMLElement).querySelector('app-alert-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Veículo possui aluguel ativo.');
    expect(banner?.querySelector('[role="alert"]')).not.toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
