import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminUsers } from './admin-users';
import { AdminUsersService } from '../admin-users.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type { AdminUserListItem } from '../../../types/admin-user.types';

/**
 * Padrão de listagem: a coluna de ações é o menu de três pontos
 * (`app-actions-menu`), com as MESMAS ações em mobile (cards) e desktop
 * (tabela), e a ação destrutiva só chama o service depois da confirmação.
 */
describe('AdminUsers — menu de ações', () => {
  const ACTIVE_USER: AdminUserListItem = {
    id: 'usr-1',
    name: 'Fulano',
    email: 'fulano@empresa.com',
    systemRole: 'USER',
    active: true,
    createdDate: '2025-01-01T00:00:00Z',
    lastCompanyName: null,
  };

  let updateStatus: ReturnType<typeof vi.fn>;

  function openMenuItems(
    fixture: { nativeElement: unknown; detectChanges: () => void },
    scope: 'mobile' | 'desktop',
  ): HTMLElement[] {
    const host = fixture.nativeElement as HTMLElement;
    const containers = Array.from(host.querySelectorAll('app-actions-menu'));
    const container = scope === 'mobile' ? containers[0] : containers[containers.length - 1];
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    updateStatus = vi.fn().mockReturnValue(of(void 0));
    TestBed.configureTestingModule({
      imports: [AdminUsers],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: AdminUsersService,
          useValue: {
            items: signal<AdminUserListItem[]>([ACTIVE_USER]),
            total: signal(1),
            page: signal(0),
            size: signal(20),
            loading: signal(false),
            load: vi.fn().mockReturnValue(of({ content: [ACTIVE_USER], page: 0, size: 20, total: 1 })),
            updateStatus,
            updateSystemRole: vi.fn().mockReturnValue(of(void 0)),
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), push: vi.fn() },
        },
      ],
    });
  });

  it.each(['mobile', 'desktop'] as const)(
    'expõe Ver detalhes, Promover e Desativar no menu (%s)',
    (scope) => {
      const fixture = TestBed.createComponent(AdminUsers);
      fixture.detectChanges();

      const labels = openMenuItems(fixture, scope).map((el) => el.textContent?.trim());

      expect(labels).toContain('Ver detalhes');
      expect(labels).toContain('Promover a PLATFORM_ADMIN');
      expect(labels).toContain('Desativar');
      // a destrutiva fica por último
      expect(labels[labels.length - 1]).toBe('Desativar');
    },
  );

  it('"Desativar" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();

    const deactivate = openMenuItems(fixture, 'mobile').find(
      (el) => el.textContent?.trim() === 'Desativar',
    );
    deactivate?.click();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      confirmMessage: () => string;
      confirmPending: () => void;
    };
    expect(component.confirmMessage()).toContain('Fulano');
    expect(updateStatus).not.toHaveBeenCalled();

    component.confirmPending();
    expect(updateStatus).toHaveBeenCalledWith('usr-1', false);
  });
});
