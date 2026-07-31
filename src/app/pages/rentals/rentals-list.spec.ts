import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { RentalsList } from './rentals-list';
import { RentalService } from './rental.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { NotificationService } from '../../services/notification.service';
import type { RentalListItemDto } from '../../types/rental.types';

/**
 * Cobre a coluna de ações padronizada (menu de 3 pontos) da listagem de aluguéis:
 *  - Editar / Iniciar / Cancelar / Excluir presentes no menu, iguais em mobile e desktop;
 *  - "Excluir" só chama o service depois da confirmação no diálogo;
 *  - erro do servidor mantém o aluguel na lista e mostra a mensagem inline.
 *
 * O menu antigo era um popover `absolute` recortado pelo `overflow-hidden` do
 * `app-page-card`; `<app-actions-menu>` renderiza `fixed` e resolve isso.
 */
describe('RentalsList — menu de ações', () => {
  const rental: RentalListItemDto = {
    id: 'r-1',
    vehicleId: 'v-1',
    driverId: 'd-1',
    startDate: '2026-01-01',
    endDate: '2026-01-10',
    totalAmount: 1000,
    caucaoAmount: 0,
    status: 'RESERVED',
    billingFrequency: 'DAILY',
    automaticCharge: false,
  };

  let items: ReturnType<typeof signal<RentalListItemDto[]>>;
  let removeSpy: ReturnType<typeof vi.fn>;
  let pushSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    items = signal<RentalListItemDto[]>([rental]);
    removeSpy = vi.fn().mockReturnValue(of(void 0));
    pushSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [RentalsList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: RentalService,
          useValue: {
            items,
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(1),
            list: vi.fn().mockReturnValue(of({ content: [rental], totalElements: 1 })),
            remove: removeSpy,
            activate: vi.fn().mockReturnValue(of(void 0)),
            cancel: vi.fn().mockReturnValue(of(void 0)),
          },
        },
        {
          provide: VehiclesService,
          useValue: { list: vi.fn().mockReturnValue(of({ content: [], totalElements: 0 })) },
        },
        {
          provide: DriverService,
          useValue: { list: vi.fn().mockReturnValue(of({ content: [], totalElements: 0 })) },
        },
        { provide: NotificationService, useValue: { push: pushSpy, success: vi.fn() } },
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
    'expõe Editar, Iniciar aluguel, Cancelar e Excluir no menu (%s)',
    (scope) => {
      const fixture = TestBed.createComponent(RentalsList);
      fixture.detectChanges();

      const labels = openMenuItems(fixture, scope).map((el) => el.textContent?.trim());

      expect(labels).toContain('Editar');
      expect(labels).toContain('Iniciar aluguel');
      expect(labels).toContain('Cancelar');
      expect(labels).toContain('Excluir');
    },
  );

  it('o painel do menu é fixed (não é recortado pelo overflow do page-card)', () => {
    const fixture = TestBed.createComponent(RentalsList);
    fixture.detectChanges();

    openMenuItems(fixture, 'mobile');
    const panel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="menu"]');

    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('fixed');
  });

  it('"Excluir" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(RentalsList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      pendingRental: () => RentalListItemDto | null;
      pendingAction: () => string | null;
      confirmDialog: () => void;
    };

    openMenuItems(fixture, 'mobile')
      .find((el) => el.textContent?.trim() === 'Excluir')
      ?.click();
    fixture.detectChanges();

    expect(component.pendingAction()).toBe('delete');
    expect(component.pendingRental()?.id).toBe('r-1');
    expect(removeSpy).not.toHaveBeenCalled();

    component.confirmDialog();
    expect(removeSpy).toHaveBeenCalledWith('r-1');
  });

  it('erro do servidor mantém o aluguel na lista e mostra a mensagem inline', () => {
    removeSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Aluguel possui cobranças em aberto.' },
          }),
      ),
    );

    const fixture = TestBed.createComponent(RentalsList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      askAction: (a: 'delete', r: RentalListItemDto, ev: Event) => void;
      confirmDialog: () => void;
    };

    component.askAction('delete', rental, new Event('click'));
    component.confirmDialog();
    fixture.detectChanges();

    expect(items()).toHaveLength(1);

    const banners = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-alert-banner'),
    );
    expect(banners.some((b) => b.textContent?.includes('Aluguel possui cobranças em aberto.'))).toBe(
      true,
    );
  });
});
