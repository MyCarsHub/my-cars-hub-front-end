import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AdminUsers } from './admin-users';
import { AdminUsersService } from '../admin-users.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type { AdminUserListItem } from '../../../types/admin-user.types';

/**
 * Feedback standard (phase 3): a backend 4xx on this screen must render INLINE
 * (`app-alert-banner`) and must NEVER produce a toast — the screen claims the
 * error through `ApiErrorService`, which disarms the interceptor safety net.
 */
describe('AdminUsers — erros do backend', () => {
  const INACTIVE_USER: AdminUserListItem = {
    id: 'usr-1',
    name: 'Fulano',
    email: 'fulano@empresa.com',
    systemRole: 'USER',
    active: false,
    createdDate: '2025-01-01T00:00:00Z',
    lastCompanyName: null,
  };

  let load: ReturnType<typeof vi.fn>;
  let updateStatus: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;

  function configure(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminUsers],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: AdminUsersService,
          useValue: {
            items: signal<AdminUserListItem[]>([]),
            total: signal(0),
            page: signal(0),
            size: signal(20),
            loading: signal(false),
            load,
            updateStatus,
            updateSystemRole: vi.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            success: notifySuccess,
            warning: vi.fn(),
            info: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    load = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));
    updateStatus = vi.fn();
    notifyError = vi.fn();
    notifySuccess = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra a falha de carregamento inline, sem toast', () => {
    const error = new HttpErrorResponse({
      status: 403,
      error: { message: 'Você não tem acesso a esta área.' },
    });
    load.mockReturnValue(throwError(() => error));
    configure();

    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('app-alert-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Você não tem acesso a esta área.');
    expect(banner?.querySelector('[role="alert"]')).not.toBeNull();

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('mostra a falha de ativação inline, sem toast e sem toast de sucesso', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { message: 'Usuário já está ativo em outra empresa.' },
    });
    load.mockReturnValue(of({ content: [INACTIVE_USER], page: 0, size: 20, total: 1 }));
    updateStatus.mockReturnValue(throwError(() => error));
    configure();

    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();

    // Usuário inativo → "Ativar" aplica direto, sem diálogo de confirmação.
    (
      fixture.componentInstance as unknown as {
        requestToggleStatus: (u: AdminUserListItem) => void;
      }
    ).requestToggleStatus(INACTIVE_USER);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('app-alert-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Usuário já está ativo em outra empresa.');

    expect(notifySuccess).not.toHaveBeenCalled();

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
