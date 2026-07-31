import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { FinesList } from './fines-list';
import { FinesService } from '../../services/fines.service';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import type { FineListItem } from '../../types/fine.types';

/**
 * Cobre a coluna de ações padronizada (menu de 3 pontos) da listagem de multas:
 *  - Editar / Excluir presentes no menu, iguais em mobile e desktop;
 *  - "Excluir" só chama o service depois da confirmação no diálogo;
 *  - erro do servidor mantém a multa na lista e mostra a mensagem inline.
 */
describe('FinesList — menu de ações', () => {
  const fine: FineListItem = {
    id: 'f-1',
    vehicleId: 'v-1',
    driverId: null,
    description: 'Excesso de velocidade',
    infractionDate: '2026-01-05T10:00:00Z',
    amountCents: 19500,
    severity: 'MEDIA',
    status: 'PENDING',
    dueDate: '2026-02-05',
    createdDate: '2026-01-06T10:00:00Z',
  };

  let items: ReturnType<typeof signal<FineListItem[]>>;
  let removeSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    items = signal<FineListItem[]>([fine]);
    removeSpy = vi.fn().mockReturnValue(of(void 0));
    errorSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [FinesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: FinesService,
          useValue: {
            items,
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(1),
            list: vi.fn().mockReturnValue(of({ content: [fine], totalElements: 1 })),
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
    const fixture = TestBed.createComponent(FinesList);
    fixture.detectChanges();

    const labels = openMenuItems(fixture, scope).map((el) => el.textContent?.trim());

    expect(labels).toContain('Editar');
    expect(labels).toContain('Excluir');
  });

  it('"Editar" aponta para a rota de edição da multa', () => {
    const fixture = TestBed.createComponent(FinesList);
    fixture.detectChanges();

    const hrefs = openMenuItems(fixture, 'mobile')
      .filter((el): el is HTMLAnchorElement => el.tagName === 'A')
      .map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/multas/f-1/editar');
  });

  it('"Excluir" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(FinesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      deleting: () => FineListItem | null;
      confirmDelete: () => void;
    };

    openMenuItems(fixture, 'mobile')
      .find((el) => el.textContent?.trim() === 'Excluir')
      ?.click();
    fixture.detectChanges();

    expect(component.deleting()?.id).toBe('f-1');
    expect(removeSpy).not.toHaveBeenCalled();

    component.confirmDelete();
    expect(removeSpy).toHaveBeenCalledWith('f-1');
  });

  it('erro do servidor mantém a multa na lista e mostra a mensagem inline, sem toast', () => {
    removeSpy.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 409, error: { message: 'Multa já foi paga.' } }),
      ),
    );

    const fixture = TestBed.createComponent(FinesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      askDelete: (f: FineListItem) => void;
      confirmDelete: () => void;
    };

    component.askDelete(fine);
    component.confirmDelete();
    fixture.detectChanges();

    expect(items()).toHaveLength(1);

    const banners = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-alert-banner'),
    );
    expect(banners.some((b) => b.textContent?.includes('Multa já foi paga.'))).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // Padrão de listagem acessível (mesmo contrato de VehiclesList / TopOffendersTable):
  // card mobile com role="button", card e linha com aria-label e Enter/Espaço navegando.
  it('card e linha navegam pro detalhe no Espaço, com preventDefault e nome acessível', () => {
    const fixture = TestBed.createComponent(FinesList);
    fixture.detectChanges();
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const host = fixture.nativeElement as HTMLElement;

    const card = host.querySelector('article');
    expect(card?.getAttribute('role')).toBe('button');
    expect(card?.getAttribute('aria-label')).toContain('Excesso de velocidade');

    const cardSpace = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    card?.dispatchEvent(cardSpace);
    expect(cardSpace.defaultPrevented).toBe(true);
    expect(navigateSpy).toHaveBeenLastCalledWith(['/multas', 'f-1']);

    const row = host.querySelector('tbody tr');
    expect(row?.getAttribute('aria-label')).toContain('Excesso de velocidade');

    const rowSpace = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    row?.dispatchEvent(rowSpace);
    expect(rowSpace.defaultPrevented).toBe(true);
    expect(navigateSpy).toHaveBeenCalledTimes(2);
  });

  it('micro-labels dos cards usam neutral-500 (contraste AA), nunca neutral-400', () => {
    const fixture = TestBed.createComponent(FinesList);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('article span.text-neutral-500').length).toBeGreaterThan(0);
    expect(host.querySelector('.text-neutral-400')).toBeNull();
  });
});
