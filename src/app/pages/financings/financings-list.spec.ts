import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { FinancingsList } from './financings-list';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import type { FinancingListItem } from '../../types/vehicle.types';

/**
 * Cobre a coluna de ações padronizada (menu de 3 pontos) da listagem de
 * financiamentos:
 *  - Ver detalhes / Quitar / Excluir presentes, iguais em mobile e desktop;
 *  - as duas mutações só chamam o service depois da confirmação no diálogo;
 *  - erro do servidor mantém o financiamento na lista e mostra a mensagem inline.
 */
describe('FinancingsList — menu de ações', () => {
  const financing: FinancingListItem = {
    id: 'fin-1',
    createdDate: '2026-01-02T10:00:00Z',
    vehicleId: 'v-1',
    vehiclePlate: 'ABC1D23',
    vehicleBrand: 'Fiat',
    vehicleModel: 'Argo',
    contractDate: '2026-01-01',
    purchasePrice: 8000000,
    totalFinanced: 6000000,
    installments: 48,
    installmentAmount: 150000,
    status: 'ACTIVE',
    paidOffDate: null,
    overdueInstallments: 0,
  };

  let items: ReturnType<typeof signal<FinancingListItem[]>>;
  let markPaidOffSpy: ReturnType<typeof vi.fn>;
  let deleteSpy: ReturnType<typeof vi.fn>;
  let successSpy: ReturnType<typeof vi.fn>;

  interface ListInternals {
    pendingAction: () => 'payOff' | 'delete' | null;
    askAction: (action: 'payOff' | 'delete', f: FinancingListItem) => void;
    confirmAction: () => void;
  }

  function configure(): void {
    items = signal<FinancingListItem[]>([financing]);
    markPaidOffSpy = vi.fn().mockReturnValue(of({ id: 'fin-1' }));
    deleteSpy = vi.fn().mockReturnValue(of(void 0));
    successSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [FinancingsList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: VehiclesService,
          useValue: {
            financings: items,
            financingsLoading: signal(false),
            financingsError: signal<string | null>(null),
            financingsPage: signal(0),
            financingsSize: signal(20),
            financingsTotal: signal(1),
            list: vi.fn().mockReturnValue(of({ content: [], total: 0 })),
            listFleetFinancings: vi
              .fn()
              .mockReturnValue(of({ content: [financing], total: 1, page: 0, size: 20 })),
            markPaidOff: markPaidOffSpy,
            deleteFinancing: deleteSpy,
          },
        },
        { provide: NotificationService, useValue: { success: successSpy, error: vi.fn() } },
      ],
    });
  }

  /** Abre o menu de ações do escopo informado e devolve seus itens renderizados. */
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
    'expõe Ver detalhes, Quitar financiamento e Excluir no menu (%s)',
    (scope) => {
      const fixture = TestBed.createComponent(FinancingsList);
      fixture.detectChanges();

      const labels = openMenuItems(fixture, scope).map((el) => el.textContent?.trim());

      expect(labels).toEqual(['Ver detalhes', 'Quitar financiamento', 'Excluir']);
    },
  );

  it('"Ver detalhes" aponta para a rota de detalhe do financiamento', () => {
    const fixture = TestBed.createComponent(FinancingsList);
    fixture.detectChanges();

    const hrefs = openMenuItems(fixture, 'mobile')
      .filter((el): el is HTMLAnchorElement => el.tagName === 'A')
      .map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/financiamentos/fin-1');
  });

  it('esconde "Quitar financiamento" quando o contrato já está quitado', () => {
    items.set([{ ...financing, status: 'PAID_OFF', paidOffDate: '2026-06-01' }]);

    const fixture = TestBed.createComponent(FinancingsList);
    fixture.detectChanges();

    const labels = openMenuItems(fixture, 'desktop').map((el) => el.textContent?.trim());

    expect(labels).toEqual(['Ver detalhes', 'Excluir']);
  });

  it('"Excluir" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(FinancingsList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as ListInternals;

    openMenuItems(fixture, 'mobile')
      .find((el) => el.textContent?.trim() === 'Excluir')
      ?.click();
    fixture.detectChanges();

    expect(component.pendingAction()).toBe('delete');
    expect(deleteSpy).not.toHaveBeenCalled();

    component.confirmAction();
    expect(deleteSpy).toHaveBeenCalledWith('v-1', 'fin-1');
  });

  it('"Quitar financiamento" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(FinancingsList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as ListInternals;

    openMenuItems(fixture, 'desktop')
      .find((el) => el.textContent?.trim() === 'Quitar financiamento')
      ?.click();
    fixture.detectChanges();

    expect(component.pendingAction()).toBe('payOff');
    expect(markPaidOffSpy).not.toHaveBeenCalled();

    component.confirmAction();
    expect(markPaidOffSpy).toHaveBeenCalledWith('v-1', 'fin-1');
    expect(successSpy).toHaveBeenCalled();
  });

  it('erro do servidor mantém o financiamento na lista e mostra a mensagem inline', () => {
    deleteSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Financiamento possui parcelas pagas.' },
          }),
      ),
    );

    const fixture = TestBed.createComponent(FinancingsList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as ListInternals;

    component.askAction('delete', financing);
    component.confirmAction();
    fixture.detectChanges();

    expect(items()).toHaveLength(1);

    const banners = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-alert-banner'),
    );
    expect(
      banners.some((b) => b.textContent?.includes('Financiamento possui parcelas pagas.')),
    ).toBe(true);
    expect(successSpy).not.toHaveBeenCalled();
  });
});
