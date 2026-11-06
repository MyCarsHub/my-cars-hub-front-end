import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import { NotificationService } from '../../../services/notification.service';
import type {
  AdminUserCompanyLink,
  AdminUserDetail as DetailDto,
  AdminUserListItem,
} from '../../../types/admin-user.types';
import { AdminUsersService } from '../admin-users.service';
import { AdminUserDetail } from './admin-user-detail';
import { AdminUsers } from './admin-users';

const PENDING: AdminUserListItem = {
  id: 'u-p',
  name: 'Pedro Pendente',
  email: 'pedro@x.com',
  systemRole: 'USER',
  active: true,
  createdDate: null,
  lastCompanyName: null,
  accountStatus: 'PRE_REGISTERED',
  companyCount: 0,
  companies: [],
};
const CLAIMED: AdminUserListItem = { ...PENDING, id: 'u-c', name: 'Clara', accountStatus: 'ACTIVE' };

function menuLabels(fixture: { nativeElement: HTMLElement; detectChanges: () => void }): string[] {
  const menu = fixture.nativeElement.querySelector('app-actions-menu')!;
  menu.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
  fixture.detectChanges();
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
    (el) => el.textContent?.trim() ?? '',
  );
}

describe('AdminUsers — Reenviar convite', () => {
  let resendInvite: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;

  function render(rows: AdminUserListItem[], can: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminUsers],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: AdminCapabilitiesService,
          useValue: { can: () => can, ensureLoaded: () => of(null) },
        },
        {
          provide: AdminUsersService,
          useValue: {
            items: signal(rows),
            total: signal(rows.length),
            page: signal(0),
            size: signal(20),
            loading: signal(false),
            load: vi
              .fn()
              .mockReturnValue(of({ content: rows, page: 0, size: 20, total: rows.length })),
            updateStatus: vi.fn(),
            resendInvite,
          },
        },
        {
          provide: NotificationService,
          useValue: { error: notifyError, success: notifySuccess, warning: vi.fn(), info: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    resendInvite = vi.fn().mockReturnValue(of({ resent: 1 }));
    notifyError = vi.fn();
    notifySuccess = vi.fn();
  });

  it('aparece só para convite pendente, com a capacidade', () => {
    const labels = menuLabels(render([PENDING], true));
    expect(labels).toContain('Reenviar convite');
    expect(menuLabels(render([CLAIMED], true))).not.toContain('Reenviar convite');
  });

  it('falha fechada: sem usuario.gerir não há Reenviar convite nem Desativar', () => {
    const labels = menuLabels(render([PENDING], false));
    expect(labels).toEqual(['Abrir']);
  });

  it.each([
    [404, undefined, 'não encontrado'],
    [409, undefined, 'não tem convite pendente'],
    [429, { retryAfterSeconds: 300 }, '5 min'],
  ])('%i aparece INLINE, sem toast', (status, body, text) => {
    const error = new HttpErrorResponse({ status, error: body });
    resendInvite.mockReturnValue(throwError(() => error));
    vi.useFakeTimers();
    const fixture = render([PENDING], true);
    (
      fixture.componentInstance as unknown as { resendInvite: (u: AdminUserListItem) => void }
    ).resendInvite(PENDING);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="action-error"]')?.textContent).toContain(
      text,
    );
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    vi.useRealTimers();
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifySuccess).not.toHaveBeenCalled();
  });
});

describe('AdminUserDetail — Entrar como e Reenviar convite', () => {
  const link = (id: string, role: string, status = 'ACTIVE'): AdminUserCompanyLink => ({
    companyId: id,
    companyName: `Empresa ${id}`,
    role,
    status,
    joinedAt: null,
  });
  const user = (companies: AdminUserCompanyLink[]): DetailDto => ({
    id: 'u-1',
    name: 'Camila Torres',
    email: 'c@x.com',
    systemRole: 'USER',
    active: true,
    createdDate: null,
    lastLoginAt: null,
    companies,
  });

  let start: ReturnType<typeof vi.fn>;
  let resendInvite: ReturnType<typeof vi.fn>;

  function render(u: DetailDto, can: (c: string) => boolean = () => true) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminUserDetail],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: AdminCapabilitiesService, useValue: { can, ensureLoaded: () => of(null) } },
        { provide: ImpersonationService, useValue: { start } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: u.id })) } },
        {
          provide: AdminUsersService,
          useValue: {
            detail: signal<DetailDto | null>(u),
            detailLoading: signal(false),
            getDetail: vi.fn().mockReturnValue(of(u)),
            clearDetail: vi.fn(),
            updateStatus: vi.fn(),
            listedItem: vi.fn(),
            resendInvite,
          },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(AdminUserDetail);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    start = vi.fn().mockReturnValue(of({ companyName: 'Empresa a' }));
    resendInvite = vi.fn().mockReturnValue(of({ resent: 1 }));
  });

  it('uma empresa elegível: "Entrar como" abre direto o Ver como dela', () => {
    const f = render(user([link('a', 'MANAGER')]));
    const btn = f.nativeElement.querySelector('[data-testid="enter-as"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('Entrar como Camila');
    btn.click();
    expect(start).toHaveBeenCalledWith('a');
  });

  it('duas ou mais: pede a escolha da empresa antes de abrir', () => {
    const f = render(user([link('a', 'MANAGER'), link('b', 'OWNER')]));
    (f.nativeElement.querySelector('[data-testid="enter-as"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(start).not.toHaveBeenCalled();
    const options = document.querySelectorAll<HTMLButtonElement>('[data-testid="enter-option"]');
    expect(options).toHaveLength(2);
    options[1].click();
    expect(start).toHaveBeenCalledWith('b');
  });

  it('motorista, sem vínculo ativo ou sem ver_como: escondido', () => {
    const q = '[data-testid="enter-as"]';
    expect(render(user([link('a', 'DRIVER')])).nativeElement.querySelector(q)).toBeNull();
    expect(render(user([])).nativeElement.querySelector(q)).toBeNull();
    const noCap = render(user([link('a', 'OWNER')]), (c) => c !== 'ver_como');
    expect(noCap.nativeElement.querySelector(q)).toBeNull();
  });

  it('Reenviar convite só com vínculo INVITED e usuario.gerir', () => {
    const q = '[data-testid="resend-invite"]';
    expect(
      render(user([link('a', 'OWNER', 'INVITED')])).nativeElement.querySelector(q),
    ).not.toBeNull();
    expect(render(user([link('a', 'OWNER')])).nativeElement.querySelector(q)).toBeNull();
    const noCap = render(user([link('a', 'OWNER', 'INVITED')]), (c) => c !== 'usuario.gerir');
    expect(noCap.nativeElement.querySelector(q)).toBeNull();
  });

  it('409 do reenvio aparece inline', () => {
    resendInvite.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    const f = render(user([link('a', 'OWNER', 'INVITED')]));
    (f.nativeElement.querySelector('[data-testid="resend-invite"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('app-alert-banner')?.textContent).toContain(
      'não tem convite pendente',
    );
  });
});
