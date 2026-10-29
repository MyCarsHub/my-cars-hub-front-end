import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';
import type { AdminMember } from '../../../types/admin-roles.types';
import { AdminAdmins } from './admin-admins';
import { AdminRolesService } from './admin-roles.service';

const ME = 'me-1';
const MEMBERS: AdminMember[] = [
  { id: ME, name: 'Lorran Sarmento', email: 'l@x.com', adminRole: 'OWNER', active: true, lastLoginAt: null, lastSeenAt: '2026-10-29T12:00:00Z' },
  { id: 'a-2', name: 'Marina Alves', email: 'm@x.com', adminRole: 'SUPPORT', active: true, lastLoginAt: null, lastSeenAt: null },
  { id: 'a-3', name: 'Rafael Costa', email: 'r@x.com', adminRole: 'READONLY', active: true, lastLoginAt: null, lastSeenAt: null },
];

describe('AdminAdmins (Admins e papéis)', () => {
  let svc: {
    list: ReturnType<typeof vi.fn>;
    grant: ReturnType<typeof vi.fn>;
    changeRole: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
    searchCandidates: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    svc = {
      list: vi.fn().mockReturnValue(of(MEMBERS)),
      grant: vi.fn().mockReturnValue(of(MEMBERS[1])),
      changeRole: vi.fn().mockReturnValue(of(MEMBERS[1])),
      revoke: vi.fn().mockReturnValue(of(undefined)),
      searchCandidates: vi.fn().mockReturnValue(of([])),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminAdmins],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: AdminRolesService, useValue: svc },
        { provide: SessionService, useValue: { getUserId: () => ME } },
        { provide: NotificationService, useValue: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      ],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(AdminAdmins);
    fixture.detectChanges();
    return fixture;
  }

  it('lista os admins com papel e as contagens por papel', () => {
    const el: HTMLElement = render().nativeElement;
    expect(svc.list).toHaveBeenCalled();
    expect(el.querySelectorAll('[data-testid^="admin-row-"]').length).toBe(3);
    expect(el.querySelector('[data-testid="admin-counts"]')?.textContent).toMatch(/1\s*Dono[\s\S]*1\s*Suporte[\s\S]*1\s*Leitura/);
    expect(el.textContent).toContain('Dono da plataforma');
    expect(el.textContent).toContain('Leitura');
  });

  it('a própria linha não tem menu de ações; as outras têm o kebab padrão', () => {
    const el: HTMLElement = render().nativeElement;
    expect(el.querySelector(`[data-testid="admin-row-${ME}"] app-actions-menu`)).toBeNull();
    expect(el.querySelector('[data-testid="admin-row-a-2"] app-actions-menu')).not.toBeNull();
    expect(el.querySelector('[data-testid="only-owner-note"]')).not.toBeNull();
  });

  it('remover acesso só habilita depois de digitar REMOVER, e manda o motivo', () => {
    const fixture = render();
    const cmp = fixture.componentInstance as unknown as { openRevoke(m: AdminMember): void };
    cmp.openRevoke(MEMBERS[2]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const submit = () => el.querySelector<HTMLButtonElement>('[data-testid="sheet-submit"]')!;
    expect(submit().disabled).toBe(true);

    const input = el.querySelector<HTMLInputElement>('[data-testid="revoke-confirm"]')!;
    input.value = 'remover';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(submit().disabled).toBe(false);

    submit().click();
    expect(svc.revoke).toHaveBeenCalledWith('a-3', 'LEFT_TEAM');
  });

  it('mudar papel fica desabilitado no papel atual e mostra o que muda ao escolher outro', () => {
    const fixture = render();
    const cmp = fixture.componentInstance as unknown as { openChange(m: AdminMember): void };
    cmp.openChange(MEMBERS[1]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector<HTMLButtonElement>('[data-testid="sheet-submit"]')!.disabled).toBe(true);

    el.querySelector<HTMLInputElement>('[data-testid="reason-READONLY"] input')!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="role-diff"]')?.textContent).toContain('Perde');

    el.querySelector<HTMLButtonElement>('[data-testid="sheet-submit"]')!.click();
    expect(svc.changeRole).toHaveBeenCalledWith('a-2', 'READONLY', 'ROLE_CHANGE');
  });

  it('a recusa do servidor (último Dono) aparece na folha, sem fechar', () => {
    svc.changeRole.mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 409, error: { message: 'É preciso ter pelo menos um Dono da plataforma ativo.' },
    })));
    const fixture = render();
    const cmp = fixture.componentInstance as unknown as { openChange(m: AdminMember): void };
    cmp.openChange({ ...MEMBERS[1], adminRole: 'OWNER' });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLInputElement>('[data-testid="reason-SUPPORT"] input')!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-testid="sheet-submit"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="bottom-sheet"]')).not.toBeNull();
    expect(el.textContent).toContain('Dono da plataforma ativo');
  });

  it('adicionar: busca, escolhe a pessoa e concede o papel escolhido', async () => {
    svc.searchCandidates.mockReturnValue(of([
      { id: 'u-9', name: 'Nova Pessoa', email: 'n@x.com', systemRole: 'USER', active: true, createdDate: null, lastCompanyName: null },
    ]));
    vi.useFakeTimers();
    const fixture = render();
    const cmp = fixture.componentInstance as unknown as { openGrant(): void };
    cmp.openGrant();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const search = el.querySelector<HTMLInputElement>('[data-testid="grant-search"]')!;
    expect(search.className).toContain('text-base'); // 16px: sem zoom do iOS no foco
    search.value = 'nova';
    search.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    vi.useRealTimers();

    el.querySelector<HTMLButtonElement>('[data-testid="grant-candidates"] button')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-testid="sheet-submit"]')!.click();
    expect(svc.grant).toHaveBeenCalledWith('u-9', 'SUPPORT', 'NEW_TEAM_MEMBER');
  });
});
