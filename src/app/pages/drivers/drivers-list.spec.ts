import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { DriversList } from './drivers-list';
import { DriverService } from '../../services/driver.service';
import { NotificationService } from '../../services/notification.service';
import type { DriverListItem } from '../../types/driver.types';

/**
 * Cobre a coluna de ações padronizada (menu de 3 pontos) da listagem de motoristas:
 *  - Editar / Suspender / Excluir presentes no menu, iguais em mobile e desktop;
 *  - "Excluir" só chama o service depois da confirmação no diálogo;
 *  - erro do servidor mantém o motorista na lista e mostra a mensagem inline.
 */
describe('DriversList — menu de ações', () => {
  const driver: DriverListItem = {
    id: 'd-1',
    name: 'Maria Souza',
    email: 'maria@example.com',
    phone: '11988887777',
    licenseNumber: '12345678900',
    licenseCategory: 'B',
    licenseExpiry: '2030-01-01',
    status: 'AVAILABLE',
  };

  let items: ReturnType<typeof signal<DriverListItem[]>>;
  let removeSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    items = signal<DriverListItem[]>([driver]);
    removeSpy = vi.fn().mockReturnValue(of(void 0));
    errorSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [DriversList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DriverService,
          useValue: {
            items,
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(1),
            list: vi.fn().mockReturnValue(of({ content: [driver], totalElements: 1 })),
            remove: removeSpy,
            changeStatus: vi.fn().mockReturnValue(of(driver)),
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
    'expõe Editar, Suspender e Excluir no menu (%s)',
    (scope) => {
      const fixture = TestBed.createComponent(DriversList);
      fixture.detectChanges();

      const labels = openMenuItems(fixture, scope).map((el) => el.textContent?.trim());

      expect(labels).toContain('Editar');
      expect(labels).toContain('Suspender');
      expect(labels).toContain('Excluir');
    },
  );

  it('"Editar" aponta para a rota de edição do motorista', () => {
    const fixture = TestBed.createComponent(DriversList);
    fixture.detectChanges();

    const hrefs = openMenuItems(fixture, 'mobile')
      .filter((el): el is HTMLAnchorElement => el.tagName === 'A')
      .map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/motoristas/d-1/editar');
  });

  it('"Excluir" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(DriversList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      deletingDriver: () => DriverListItem | null;
      confirmDelete: () => void;
    };

    openMenuItems(fixture, 'mobile')
      .find((el) => el.textContent?.trim() === 'Excluir')
      ?.click();
    fixture.detectChanges();

    expect(component.deletingDriver()?.id).toBe('d-1');
    expect(removeSpy).not.toHaveBeenCalled();

    component.confirmDelete();
    expect(removeSpy).toHaveBeenCalledWith('d-1');
  });

  it('erro do servidor mantém o motorista na lista e mostra a mensagem inline, sem toast', () => {
    removeSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Motorista possui aluguel ativo.' },
          }),
      ),
    );

    const fixture = TestBed.createComponent(DriversList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      askDelete: (d: DriverListItem) => void;
      confirmDelete: () => void;
    };

    component.askDelete(driver);
    component.confirmDelete();
    fixture.detectChanges();

    expect(items()).toHaveLength(1);

    const banner = (fixture.nativeElement as HTMLElement).querySelector('app-alert-banner');
    expect(banner?.textContent).toContain('Motorista possui aluguel ativo.');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
