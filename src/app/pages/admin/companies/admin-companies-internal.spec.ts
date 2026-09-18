import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminCompanies } from './admin-companies';
import { AdminCompaniesService } from '../admin-companies.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type { AdminCompanyListItem } from '../../../types/admin-company.types';

/**
 * FEAT-0141 — marcar empresa como INTERNA pela LISTAGEM do admin.
 *
 * >>> A TRAVA DESTE ARQUIVO: empresa interna CONTINUA APARECENDO NA LISTAGEM. <<<
 * Ela sai da CONTA das métricas, não da LISTA. Esconder trocaria um erro por
 * outro, e a perda seria SILENCIOSA: o dono marcaria as sete empresas de teste,
 * elas sumiriam da tela e ninguém conseguiria mais desmarcá-las. Sem este teste,
 * alguém "limpa" a lista depois achando que é coerência com as métricas.
 */
describe('AdminCompanies — marca de empresa interna', () => {
  const BASE: AdminCompanyListItem = {
    id: 'co-1',
    name: 'Locadora Alpha',
    documentMasked: '12.***.***/0001-**',
    planCode: 'PRO_MONTHLY',
    planName: 'Pro (mensal)',
    subscriptionStatus: 'ACTIVE',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    active: true,
    memberCount: 3,
    createdAt: '2025-01-01T00:00:00Z',
    internal: false,
  };

  const EXTERNA: AdminCompanyListItem = { ...BASE, id: 'co-1', name: 'Locadora Alpha' };
  const INTERNA: AdminCompanyListItem = {
    ...BASE,
    id: 'co-2',
    name: 'Teste do Dono',
    internal: true,
  };

  let updateInternal: ReturnType<typeof vi.fn>;

  function render(companies: AdminCompanyListItem[]) {
    TestBed.resetTestingModule();
    updateInternal = vi.fn().mockReturnValue(of({ id: companies[0].id }));
    TestBed.configureTestingModule({
      imports: [AdminCompanies],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: AdminCompaniesService,
          useValue: {
            companies: signal<AdminCompanyListItem[]>(companies),
            loading: signal(false),
            total: signal(companies.length),
            load: vi.fn().mockReturnValue(of({ content: companies, total: companies.length })),
            updateStatus: vi.fn().mockReturnValue(of(void 0)),
            updateInternal,
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(AdminCompanies);
    fixture.detectChanges();
    return fixture;
  }

  /** Itens do menu de ações da empresa na posição `index` do escopo pedido. */
  function openMenuItems(
    fixture: { nativeElement: unknown; detectChanges: () => void },
    scope: 'mobile' | 'desktop',
    index: number,
    totalCompanies: number,
  ): HTMLElement[] {
    const host = fixture.nativeElement as HTMLElement;
    const menus = Array.from(host.querySelectorAll('app-actions-menu'));
    // os cards mobile vêm antes da tabela desktop: um menu por empresa em cada
    const container = scope === 'mobile' ? menus[index] : menus[totalCompanies + index];
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  // ------------------------------------------------------------------ TRAVA
  it.each(['mobile', 'desktop'] as const)(
    'TRAVA: empresa marcada como interna CONTINUA na listagem, ao lado das outras (%s)',
    (scope) => {
      const fixture = render([EXTERNA, INTERNA]);
      const host = fixture.nativeElement as HTMLElement;

      // um menu de ações por empresa, em CADA um dos dois layouts
      const menus = host.querySelectorAll('app-actions-menu');
      expect(menus.length).toBe(4);

      // e o nome da interna está escrito na tela, nos dois layouts
      const names = Array.from(host.querySelectorAll('a[aria-label^="Ver detalhes de"]')).map(
        (el) => el.getAttribute('aria-label'),
      );
      expect(names.filter((n) => n === 'Ver detalhes de Teste do Dono').length).toBe(2);
      expect(names.filter((n) => n === 'Ver detalhes de Locadora Alpha').length).toBe(2);

      // o menu da interna existe e oferece a volta atrás
      const labels = openMenuItems(fixture, scope, 1, 2).map((el) => el.textContent?.trim());
      expect(labels).toContain('Desmarcar como interna');
    },
  );

  // ------------------------------------------------------------ MARCA VISÍVEL
  it('mostra a marca na LINHA da empresa interna — e só nela', () => {
    const host = render([EXTERNA, INTERNA]).nativeElement as HTMLElement;

    const badges = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="internal-badge"]'));
    // uma marca em cada layout (cartão mobile + linha desktop), só para a interna
    expect(badges.length).toBe(2);
    for (const badge of badges) {
      expect(badge.textContent?.trim()).toBe('Interna · fora das métricas');
    }
  });

  it('não mostra marca nenhuma quando nenhuma empresa é interna', () => {
    const host = render([EXTERNA]).nativeElement as HTMLElement;

    expect(host.querySelectorAll('[data-testid="internal-badge"]').length).toBe(0);
  });

  // --------------------------------------------------------------- VOCABULÁRIO
  it('o texto do controle não usa verbo de exclusão — marcar não apaga nada', () => {
    const fixture = render([EXTERNA, INTERNA]);

    // o menu só monta o conteúdo ao abrir: abre os quatro (2 empresas × 2 layouts)
    const texts: string[] = [];
    for (const scope of ['mobile', 'desktop'] as const) {
      for (const index of [0, 1]) {
        const item = openMenuItems(fixture, scope, index, 2).find(
          (el) => el.getAttribute('data-testid') === 'internal-menu-item',
        );
        texts.push(item?.textContent?.trim() ?? '');
      }
    }
    expect(texts.length).toBe(4);

    for (const text of texts) {
      expect(text.toLowerCase()).not.toMatch(/remov|ocult|desativ|exclu|apag|esconde/);
    }
    expect(texts).toContain('Marcar como interna (fora das métricas)');
    expect(texts).toContain('Desmarcar como interna');
  });

  // ------------------------------------------------------------------- AÇÃO
  it.each(['mobile', 'desktop'] as const)(
    'marcar chama o PATCH com internal=true na empresa certa (%s)',
    (scope) => {
      const fixture = render([EXTERNA, INTERNA]);

      const mark = openMenuItems(fixture, scope, 0, 2).find(
        (el) => el.getAttribute('data-testid') === 'internal-menu-item',
      );
      mark?.click();

      expect(updateInternal).toHaveBeenCalledWith('co-1', true);
    },
  );

  it.each(['mobile', 'desktop'] as const)(
    'desmarcar chama o PATCH com internal=false na empresa certa (%s)',
    (scope) => {
      const fixture = render([EXTERNA, INTERNA]);

      const unmark = openMenuItems(fixture, scope, 1, 2).find(
        (el) => el.getAttribute('data-testid') === 'internal-menu-item',
      );
      unmark?.click();

      expect(updateInternal).toHaveBeenCalledWith('co-2', false);
    },
  );

  it('a ação é direta: não abre diálogo de confirmação', () => {
    const fixture = render([EXTERNA]);
    const host = fixture.nativeElement as HTMLElement;

    const mark = openMenuItems(fixture, 'mobile', 0, 1).find(
      (el) => el.getAttribute('data-testid') === 'internal-menu-item',
    );
    mark?.click();
    fixture.detectChanges();

    expect(updateInternal).toHaveBeenCalledTimes(1);
    expect(host.querySelector('app-confirm-dialog [role="dialog"]')).toBeNull();
  });
});
