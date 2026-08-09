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
  let cancelSpy: ReturnType<typeof vi.fn>;
  let pushSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    items = signal<RentalListItemDto[]>([rental]);
    removeSpy = vi.fn().mockReturnValue(of(void 0));
    cancelSpy = vi.fn().mockReturnValue(of(void 0));
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
            cancel: cancelSpy,
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

  /**
   * Teste de integração da tela que originou o relato. A trava da regra em si
   * vive em `actions-menu.spec.ts` — aqui só garantimos que ESTA listagem entrega
   * os itens no formato que o painel consegue empilhar.
   *
   * Regressão real: no desktop, um aluguel RESERVED (4 ações — o máximo) mostrava
   * só "Editar" e "Iniciar aluguel"; "Cancelar" e "Excluir" ficavam fora da vista,
   * lado a lado, atrás de uma barra de rolagem horizontal.
   */
  it.each(['mobile', 'desktop'] as const)(
    'entrega os itens como filhos diretos do painel que empilha (%s)',
    (scope) => {
      const fixture = TestBed.createComponent(RentalsList);
      fixture.detectChanges();

      const items = openMenuItems(fixture, scope);
      const panel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '[role="menu"]',
      );

      expect(items.length).toBeGreaterThan(1);
      expect(panel?.classList.contains('flex-col')).toBe(true);
      for (const item of items) {
        // A blockificação do container de coluna só alcança filhos DIRETOS.
        expect(
          item.parentElement,
          `"${item.textContent?.trim()}" (${scope}) está aninhado e escaparia do empilhamento`,
        ).toBe(panel);
      }
    },
  );

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
    expect(removeSpy).toHaveBeenCalledWith('r-1', false);
  });

  it('opt-in de vencidas nasce desmarcado e viaja em excluir/cancelar quando marcado', () => {
    const fixture = TestBed.createComponent(RentalsList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      askAction: (a: 'delete' | 'cancel', r: RentalListItemDto, ev: Event) => void;
      onRemoveOverdueChange: (checked: boolean) => void;
      removeOverdueCharges: () => boolean;
      confirmDialog: () => void;
    };

    // Excluir com o opt-in marcado → query param true (segundo argumento).
    component.askAction('delete', rental, new Event('click'));
    expect(component.removeOverdueCharges()).toBe(false);
    component.onRemoveOverdueChange(true);
    component.confirmDialog();
    expect(removeSpy).toHaveBeenCalledWith('r-1', true);

    // Reabrir outra ação sempre reseta o opt-in — apagar dívida é irreversível.
    component.askAction('cancel', rental, new Event('click'));
    expect(component.removeOverdueCharges()).toBe(false);
    component.confirmDialog();
    expect(cancelSpy).toHaveBeenCalledWith('r-1', { removeOverdueCharges: false });
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

/**
 * Visibilidade da integração Asaas na listagem. O dado já vem da API
 * (`RentalListItemDto.automaticCharge`) — nenhum endpoint novo envolvido.
 * O badge aparece duas vezes por aluguel (card mobile + célula "Cobrança" do
 * desktop), ambos renderizados no mesmo DOM.
 */
describe('RentalsList — badge de integração Asaas', () => {
  function configureWith(automaticCharge: boolean): void {
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
      automaticCharge,
    };

    TestBed.configureTestingModule({
      imports: [RentalsList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: RentalService,
          useValue: {
            items: signal<RentalListItemDto[]>([rental]),
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(1),
            list: vi.fn().mockReturnValue(of({ content: [rental], totalElements: 1 })),
            remove: vi.fn().mockReturnValue(of(void 0)),
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
        { provide: NotificationService, useValue: { push: vi.fn(), success: vi.fn() } },
      ],
    });
  }

  function asaasBadges(host: HTMLElement): Element[] {
    return Array.from(host.querySelectorAll('[aria-label="Cobrança automática via Asaas"]'));
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('mostra o badge Asaas (mobile + desktop) quando automaticCharge=true', () => {
    configureWith(true);
    const fixture = TestBed.createComponent(RentalsList);
    fixture.detectChanges();

    const badges = asaasBadges(fixture.nativeElement as HTMLElement);
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent?.trim()).toBe('Asaas');
  });

  it('não mostra o badge Asaas quando automaticCharge=false', () => {
    configureWith(false);
    const fixture = TestBed.createComponent(RentalsList);
    fixture.detectChanges();

    expect(asaasBadges(fixture.nativeElement as HTMLElement)).toHaveLength(0);
  });
});
