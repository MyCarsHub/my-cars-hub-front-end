import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { InsurancesList } from './insurances-list';
import { InsurancesService } from '../../services/insurances.service';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import type { InsuranceListItem } from '../../types/insurance.types';

/**
 * Cobre a listagem de seguros:
 *  - menu de ações padronizado (Ver detalhes / Editar / Cancelar / Excluir),
 *    igual em mobile e desktop, escondendo o que a regra de negócio proíbe;
 *  - as mutações só chamam o service depois da confirmação no diálogo;
 *  - `status` e `expiringInDays` nunca são enviados juntos;
 *  - erro do servidor mantém a apólice na lista e mostra a mensagem inline.
 */
describe('InsurancesList', () => {
  const insurance: InsuranceListItem = {
    id: 'ins-1',
    createdDate: '2026-01-02T10:00:00Z',
    vehicleId: 'v-1',
    vehiclePlate: 'ABC1D23',
    vehicleBrand: 'Fiat',
    vehicleModel: 'Argo',
    insurer: 'Porto Seguro',
    policyNumber: 'AP-99887',
    coverageType: 'COMPREHENSIVE',
    premiumAmount: 240_050,
    deductibleAmount: 300_000,
    startDate: '2026-01-01',
    endDate: '2027-01-01',
    paymentMethod: 'CREDIT_CARD',
    status: 'ACTIVE',
    cancelledDate: null,
    daysToExpiry: 90,
  };

  let items: ReturnType<typeof signal<InsuranceListItem[]>>;
  let listSpy: ReturnType<typeof vi.fn>;
  let cancelSpy: ReturnType<typeof vi.fn>;
  let removeSpy: ReturnType<typeof vi.fn>;
  let successSpy: ReturnType<typeof vi.fn>;

  interface ListInternals {
    pendingAction: () => 'cancel' | 'delete' | null;
    askAction: (action: 'cancel' | 'delete', i: InsuranceListItem) => void;
    confirmAction: () => void;
    onExpiringChange: (value: string) => void;
    onStatusChange: (value: 'ACTIVE' | '') => void;
  }

  function configure(): void {
    items = signal<InsuranceListItem[]>([insurance]);
    listSpy = vi.fn().mockReturnValue(of({ content: [insurance], total: 1, page: 0, size: 20 }));
    cancelSpy = vi.fn().mockReturnValue(of({ id: 'ins-1' }));
    removeSpy = vi.fn().mockReturnValue(of(void 0));
    successSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [InsurancesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: InsurancesService,
          useValue: {
            insurances: items,
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(1),
            list: listSpy,
            cancel: cancelSpy,
            remove: removeSpy,
          },
        },
        {
          provide: VehiclesService,
          useValue: { list: vi.fn().mockReturnValue(of({ content: [], total: 0 })) },
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
    'expõe Ver detalhes, Editar, Cancelar apólice e Excluir no menu (%s)',
    (scope) => {
      const fixture = TestBed.createComponent(InsurancesList);
      fixture.detectChanges();

      const labels = openMenuItems(fixture, scope).map((el) => el.textContent?.trim());

      expect(labels).toEqual(['Ver detalhes', 'Editar', 'Cancelar apólice', 'Excluir']);
    },
  );

  it('"Ver detalhes" e "Editar" apontam para as rotas da apólice', () => {
    const fixture = TestBed.createComponent(InsurancesList);
    fixture.detectChanges();

    const hrefs = openMenuItems(fixture, 'mobile')
      .filter((el): el is HTMLAnchorElement => el.tagName === 'A')
      .map((a) => a.getAttribute('href'));

    expect(hrefs).toEqual(['/seguros/ins-1', '/seguros/ins-1/editar']);
  });

  it.each(['CANCELLED', 'EXPIRED'] as const)(
    'esconde Editar e Cancelar quando a apólice está %s',
    (status) => {
      items.set([{ ...insurance, status }]);

      const fixture = TestBed.createComponent(InsurancesList);
      fixture.detectChanges();

      const labels = openMenuItems(fixture, 'desktop').map((el) => el.textContent?.trim());

      expect(labels).toEqual(['Ver detalhes', 'Excluir']);
    },
  );

  it('"Excluir" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(InsurancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as ListInternals;

    openMenuItems(fixture, 'mobile')
      .find((el) => el.textContent?.trim() === 'Excluir')
      ?.click();
    fixture.detectChanges();

    expect(component.pendingAction()).toBe('delete');
    expect(removeSpy).not.toHaveBeenCalled();

    component.confirmAction();
    expect(removeSpy).toHaveBeenCalledWith('v-1', 'ins-1');
  });

  it('"Cancelar apólice" confirma antes e envia a data de hoje', () => {
    const fixture = TestBed.createComponent(InsurancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as ListInternals;

    openMenuItems(fixture, 'desktop')
      .find((el) => el.textContent?.trim() === 'Cancelar apólice')
      ?.click();
    fixture.detectChanges();

    expect(component.pendingAction()).toBe('cancel');
    expect(cancelSpy).not.toHaveBeenCalled();

    component.confirmAction();

    const [vehicleId, insuranceId, payload] = cancelSpy.mock.calls[0];
    expect(vehicleId).toBe('v-1');
    expect(insuranceId).toBe('ins-1');
    expect(payload.cancelledDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(successSpy).toHaveBeenCalled();
  });

  it('nunca envia status e expiringInDays juntos', () => {
    const fixture = TestBed.createComponent(InsurancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as ListInternals;

    component.onStatusChange('ACTIVE');
    component.onExpiringChange('7');

    const lastFilters = listSpy.mock.calls[listSpy.mock.calls.length - 1][0];
    expect(lastFilters.expiringInDays).toBe(7);
    expect(lastFilters.status).toBeUndefined();
  });

  /**
   * SUSPENDED escapava do `expiryBadge` e caía na contagem regressiva, ficando
   * com o chip âmbar "Vence em Xd" — visualmente igual a uma apólice em vigor.
   * A regra agora é a mesma do detalhe: contagem só para ACTIVE.
   */
  it('apólice SUSPENDED mostra o status, não a contagem regressiva', () => {
    items.set([{ ...insurance, status: 'SUSPENDED', daysToExpiry: 12 }]);

    const fixture = TestBed.createComponent(InsurancesList);
    fixture.detectChanges();

    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).not.toContain('Vence em 12d');
    expect(html).toContain('Suspensa');
  });

  it('erro do servidor mantém a apólice na lista e mostra a mensagem inline', () => {
    removeSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Apólice vinculada a um sinistro em aberto.' },
          }),
      ),
    );

    const fixture = TestBed.createComponent(InsurancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as ListInternals;

    component.askAction('delete', insurance);
    component.confirmAction();
    fixture.detectChanges();

    expect(items()).toHaveLength(1);

    const banners = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-alert-banner'),
    );
    expect(
      banners.some((b) => b.textContent?.includes('Apólice vinculada a um sinistro em aberto.')),
    ).toBe(true);
    expect(successSpy).not.toHaveBeenCalled();
  });
});

/**
 * FIX: paginação que prendia o usuário.
 *
 * O paginador vivia dentro do `@if (items().length > 0)`: excluir a última
 * linha da última página deixava lista vazia + paginador escondido, sem como
 * voltar. Agora ele depende de `total()` e a página fora de alcance recua
 * sozinha para a última existente.
 */
describe('InsurancesList — paginação', () => {
  const PAGE_SIZE = 20;

  function makeInsurance(n: number): InsuranceListItem {
    return {
      id: `ins-${n}`,
      createdDate: '2026-01-02T10:00:00Z',
      vehicleId: 'v-1',
      vehiclePlate: 'ABC1D23',
      vehicleBrand: 'Fiat',
      vehicleModel: 'Argo',
      insurer: 'Porto Seguro',
      policyNumber: `AP-${n}`,
      coverageType: 'COMPREHENSIVE',
      premiumAmount: 240_050,
      deductibleAmount: null,
      startDate: '2026-01-01',
      endDate: '2027-01-01',
      paymentMethod: null,
      status: 'ACTIVE',
      cancelledDate: null,
      daysToExpiry: 90,
    };
  }

  let store: InsuranceListItem[];
  let items: ReturnType<typeof signal<InsuranceListItem[]>>;
  let page: ReturnType<typeof signal<number>>;
  let size: ReturnType<typeof signal<number>>;
  let total: ReturnType<typeof signal<number>>;
  let listSpy: ReturnType<typeof vi.fn>;
  let removeSpy: ReturnType<typeof vi.fn>;

  interface ListInternals {
    next: () => void;
    askAction: (action: 'cancel' | 'delete', i: InsuranceListItem) => void;
    confirmAction: () => void;
  }

  /** Serviço falso com paginação de verdade sobre `store`. */
  function configure(): void {
    store = Array.from({ length: 21 }, (_, n) => makeInsurance(n + 1));
    items = signal<InsuranceListItem[]>([]);
    page = signal(0);
    size = signal(PAGE_SIZE);
    total = signal(0);

    listSpy = vi.fn((filters: { page?: number; size?: number }) => {
      const p = filters.page ?? 0;
      const s = filters.size ?? PAGE_SIZE;
      const content = store.slice(p * s, p * s + s);
      items.set(content);
      page.set(p);
      size.set(s);
      total.set(store.length);
      return of({ content, total: store.length, page: p, size: s });
    });

    removeSpy = vi.fn((_vehicleId: string, insuranceId: string) => {
      store = store.filter((i) => i.id !== insuranceId);
      return of(void 0);
    });

    TestBed.configureTestingModule({
      imports: [InsurancesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: InsurancesService,
          useValue: {
            insurances: items,
            loading: signal(false),
            error: signal<string | null>(null),
            page,
            size,
            total,
            list: listSpy,
            cancel: vi.fn(),
            remove: removeSpy,
          },
        },
        {
          provide: VehiclesService,
          useValue: { list: vi.fn().mockReturnValue(of({ content: [], total: 0 })) },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    configure();
  });

  it('excluir a única linha da última página volta para a última página válida', () => {
    const fixture = TestBed.createComponent(InsurancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as ListInternals;

    // Página 1 (a segunda): 21 registros, 20 por página → sobra 1.
    component.next();
    fixture.detectChanges();
    expect(page()).toBe(1);
    expect(items()).toHaveLength(1);

    const last = items()[0];
    component.askAction('delete', last);
    component.confirmAction();
    fixture.detectChanges();

    expect(removeSpy).toHaveBeenCalledWith('v-1', last.id);
    // Sem o clamp o usuário ficaria na página 1, agora vazia e inalcançável.
    expect(page()).toBe(0);
    expect(items()).toHaveLength(20);
    expect(total()).toBe(20);
  });

  it('o paginador é renderizado enquanto houver total, mesmo com a página vazia', () => {
    const fixture = TestBed.createComponent(InsurancesList);
    fixture.detectChanges();

    // Estado de resgate: página fora de alcance, lista vazia, total intacto.
    items.set([]);
    total.set(21);
    page.set(1);
    fixture.detectChanges();

    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).map((b) => b.textContent?.trim());

    expect(labels).toContain('Anterior');
    expect(labels).toContain('Próxima');
  });
});
