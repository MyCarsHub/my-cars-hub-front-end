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
 * Padrão de listagem: a coluna de ações é o menu de três pontos
 * (`app-actions-menu`), com as MESMAS ações em mobile (cards) e desktop
 * (tabela), e a ação destrutiva só chama o service depois da confirmação.
 */
describe('AdminCompanies — menu de ações', () => {
  const COMPANY: AdminCompanyListItem = {
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
  };

  let updateStatus: ReturnType<typeof vi.fn>;

  function openMenuItems(
    fixture: { nativeElement: unknown; detectChanges: () => void },
    scope: 'mobile' | 'desktop',
  ): HTMLElement[] {
    const host = fixture.nativeElement as HTMLElement;
    const containers = Array.from(host.querySelectorAll('app-actions-menu'));
    // os cards mobile vêm antes da tabela desktop no template
    const container = scope === 'mobile' ? containers[0] : containers[containers.length - 1];
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    updateStatus = vi.fn().mockReturnValue(of(void 0));
    TestBed.configureTestingModule({
      imports: [AdminCompanies],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: AdminCompaniesService,
          useValue: {
            companies: signal<AdminCompanyListItem[]>([COMPANY]),
            loading: signal(false),
            total: signal(1),
            load: vi.fn().mockReturnValue(of({ content: [COMPANY], total: 1 })),
            updateStatus,
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
      ],
    });
  });

  it.each(['mobile', 'desktop'] as const)(
    'expõe Ver detalhes e Suspender no menu (%s)',
    (scope) => {
      const fixture = TestBed.createComponent(AdminCompanies);
      fixture.detectChanges();

      const labels = openMenuItems(fixture, scope).map((el) => el.textContent?.trim());

      expect(labels).toContain('Ver detalhes');
      expect(labels).toContain('Suspender');
      // "Suspender" é a última (destrutiva) do menu
      expect(labels[labels.length - 1]).toBe('Suspender');
    },
  );

  it('"Suspender" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(AdminCompanies);
    fixture.detectChanges();

    const suspend = openMenuItems(fixture, 'mobile').find(
      (el) => el.textContent?.trim() === 'Suspender',
    );
    suspend?.click();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      confirmMessage: () => string;
      confirmPending: () => void;
    };
    expect(component.confirmMessage()).toContain('Locadora Alpha');
    expect(updateStatus).not.toHaveBeenCalled();

    component.confirmPending();
    expect(updateStatus).toHaveBeenCalledWith('co-1', false);
  });
});
