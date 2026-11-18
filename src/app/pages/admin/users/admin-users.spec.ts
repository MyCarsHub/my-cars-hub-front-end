import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AdminUsers } from './admin-users';
import { AdminUsersService } from '../admin-users.service';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
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
        { provide: AdminCapabilitiesService, useValue: { can: () => true, ensureLoaded: () => of(null) } },
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

/**
 * Padrao da plataforma: UMA fileira de pilulas de situacao (servidor filtra situacao e
 * presenca) + select de papel na linha da busca. Papel e convite pendente o servidor nao
 * filtra: recortam a pagina e a tela diz isso.
 */
describe('AdminUsers — filtros no padrão da lista', () => {
  const user = (over: Partial<AdminUserListItem>): AdminUserListItem => ({
    id: 'u',
    name: 'Ana',
    email: 'ana@x.com',
    systemRole: 'USER',
    active: true,
    createdDate: null,
    lastCompanyName: null,
    accountStatus: 'ACTIVE',
    companyCount: 1,
    companies: [{ companyId: 'c1', companyName: 'Alfa', role: 'DRIVER' }],
    ...over,
  });
  const ROWS = [
    user({ id: 'u1', name: 'Ana Motorista' }),
    user({
      id: 'u2',
      name: 'Bruno Dono',
      accountStatus: 'PRE_REGISTERED',
      companies: [{ companyId: 'c2', companyName: 'Beta', role: 'OWNER' }],
    }),
  ];
  let load: ReturnType<typeof vi.fn>;

  function render() {
    TestBed.resetTestingModule();
    load = vi.fn().mockReturnValue(of({ content: ROWS, page: 0, size: 20, total: 57 }));
    TestBed.configureTestingModule({
      imports: [AdminUsers],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: AdminCapabilitiesService, useValue: { can: () => true, ensureLoaded: () => of(null) } },
        {
          provide: AdminUsersService,
          useValue: {
            items: signal(ROWS),
            total: signal(57),
            page: signal(0),
            size: signal(20),
            loading: signal(false),
            load,
            updateStatus: vi.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), push: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();
    return fixture;
  }

  function chip(host: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (b) => b.textContent?.trim() === label,
    );
    expect(found, `pílula "${label}"`).toBeTruthy();
    return found!;
  }

  it('lista dentro do cartão "Lista", com a contagem do servidor', () => {
    const host: HTMLElement = render().nativeElement;
    expect(host.querySelector('app-page-card')?.textContent).toContain('Lista');
    expect(host.querySelector('[data-list-results]')?.textContent).toContain('57 usuários');
    expect(host.querySelector('[data-testid="role-note"]')).toBeNull();
  });

  it('uma fileira de pílulas de situação; papel é select, não pílula', () => {
    const host: HTMLElement = render().nativeElement;
    expect(host.querySelectorAll('[role="radiogroup"]').length).toBe(1);
    const labels = Array.from(host.querySelectorAll('[role="radio"]')).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Todos', 'Ativos', 'Inativos', 'Convite pendente', 'Online agora']);
    const select = host.querySelector<HTMLSelectElement>('[data-testid="role-filter"]')!;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
      'Papel: Todos',
      'Papel: Donos',
      'Papel: Gerenciadores',
      'Papel: Motoristas',
    ]);
  });

  it('"Inativos" e "Online agora" pedem ao servidor, voltando à primeira página', () => {
    const fixture = render();
    const host: HTMLElement = fixture.nativeElement;
    chip(host, 'Inativos').click();
    fixture.detectChanges();
    expect(load).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'INACTIVE', online: false, page: 0 }),
    );
    chip(host, 'Online agora').click();
    fixture.detectChanges();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ALL', online: true }));
  });

  it('"Convite pendente" recorta a página, conta só o recorte e explica', () => {
    const fixture = render();
    const host: HTMLElement = fixture.nativeElement;
    chip(host, 'Convite pendente').click();
    fixture.detectChanges();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ACTIVE' }));
    const table = host.querySelector('[data-table]')!;
    expect(table.textContent).toContain('Bruno Dono');
    expect(table.textContent).not.toContain('Ana Motorista');
    expect(host.querySelector('[data-testid="role-note"]')).not.toBeNull();
    expect(host.querySelector('[data-list-results]')?.textContent).toContain('1 usuário');
    expect(host.querySelector('[data-testid="role-note"]')?.textContent).toContain('2 de 57');
  });

  it('papel recorta sem nova requisição; o chip de papel é neutro', () => {
    const fixture = render();
    const host: HTMLElement = fixture.nativeElement;
    const calls = load.mock.calls.length;
    const select = host.querySelector<HTMLSelectElement>('[data-testid="role-filter"]')!;
    select.value = 'DRIVER';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const table = host.querySelector('[data-table]')!;
    expect(table.textContent).toContain('Ana Motorista');
    expect(table.textContent).not.toContain('Bruno Dono');
    expect(load.mock.calls.length).toBe(calls);
    const roleChip = table.querySelector('[data-row] app-status-chip');
    expect(roleChip?.outerHTML ?? '').toContain('bg-surface-sunken');
  });

  it('Empresas mostra o resumo e a lista inteira no balão', () => {
    const host: HTMLElement = render().nativeElement;
    const cell = host.querySelector<HTMLElement>('[data-table] [data-testid="user-companies"]')!;
    expect(cell.getAttribute('title')).toBe('Alfa (Motorista)');
  });
});
