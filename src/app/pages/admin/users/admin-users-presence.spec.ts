import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AdminUsers } from './admin-users';
import { AdminUsersService } from '../admin-users.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type { AdminUserListItem } from '../../../types/admin-user.types';

/**
 * Presença na listagem de usuários do admin: selo "Online" para quem fez
 * requisição autenticada dentro da janela do backend, "Visto há …" para quem
 * já foi visto, nada para quem nunca foi; e `?online=true` (cartão do painel)
 * abre a lista já filtrada.
 */
describe('AdminUsers — presença', () => {
  const NOW = Date.parse('2026-10-28T12:00:00Z');

  const ONLINE: AdminUserListItem = {
    id: 'usr-on',
    name: 'Ana Online',
    email: 'ana@empresa.com',
    systemRole: 'USER',
    active: true,
    createdDate: '2025-01-01T00:00:00Z',
    lastCompanyName: null,
    online: true,
    lastSeenAt: '2026-10-28T11:59:00Z',
  };
  const SEEN: AdminUserListItem = {
    ...ONLINE,
    id: 'usr-seen',
    name: 'Bruno Visto',
    email: 'bruno@empresa.com',
    online: false,
    lastSeenAt: '2026-10-28T11:48:00Z',
  };
  const NEVER: AdminUserListItem = {
    ...ONLINE,
    id: 'usr-never',
    name: 'Carla Nunca',
    email: 'carla@empresa.com',
    online: false,
    lastSeenAt: null,
  };

  let load: ReturnType<typeof vi.fn>;
  let items: ReturnType<typeof signal<AdminUserListItem[]>>;

  function configure(queryParams: Record<string, string> = {}): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminUsers],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
        },
        {
          provide: AdminUsersService,
          useValue: {
            items,
            total: signal(3),
            page: signal(0),
            size: signal(20),
            loading: signal(false),
            load,
            updateStatus: vi.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
      ],
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    items = signal<AdminUserListItem[]>([ONLINE, SEEN, NEVER]);
    load = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marca só o usuário online com o selo, nas duas versões da lista', () => {
    configure();
    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();

    const badges: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid="online-badge"]'),
    );
    // Um no cartão (celular) e um na tabela (desktop), ambos do mesmo usuário.
    expect(badges).toHaveLength(2);
    for (const badge of badges) {
      expect(badge.textContent?.trim()).toBe('Online');
    }
  });

  it('mostra "Visto há N min" para quem já foi visto e nada para quem nunca foi', () => {
    configure();
    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();

    const seen: string[] = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid="last-seen"]') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent?.trim() ?? '');
    expect(seen).toEqual(['Visto há 12 min', 'Visto há 12 min']);
  });

  it('sem query param, carrega a lista sem filtro de presença', () => {
    configure();
    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();

    expect(load).toHaveBeenCalledWith(expect.objectContaining({ online: false }));
  });

  it('?online=true (cartão do painel) abre a lista filtrada por online', () => {
    configure({ online: 'true' });
    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();

    expect(load).toHaveBeenCalledWith(expect.objectContaining({ online: true, page: 0 }));
  });
});
