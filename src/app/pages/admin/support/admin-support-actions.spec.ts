import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminSupportList } from './admin-support-list';
import { SupportTicketService } from '../../../services/support-ticket.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type { SupportTicketAdminItem } from '../../../types/support.types';

/**
 * Padrão de listagem: a coluna de ações é o menu de três pontos
 * (`app-actions-menu`). Esta tela não tem ação destrutiva — só transições de
 * status —, então não há diálogo de confirmação.
 */
describe('AdminSupportList — menu de ações', () => {
  const OPEN_TICKET: SupportTicketAdminItem = {
    id: 'tkt-abcdef12',
    createdDate: '2026-01-10T12:00:00',
    companyId: 'co-1',
    companyName: 'Locadora Aurora',
    userId: 'usr-1',
    userName: 'Marina Prado',
    userEmail: 'marina@aurora.com.br',
    message: 'Não consigo emitir o contrato.',
    channel: 'EMAIL',
    status: 'OPEN',
    resolvedAt: null,
    resolvedBy: null,
    resolvedByName: null,
    assignedTo: null,
    assignedToName: null,
    assignedAt: null,
    replyCount: 0,
    lastReplyAt: null,
  };

  let adminUpdateStatus: ReturnType<typeof vi.fn>;

  function openMenuItems(fixture: {
    nativeElement: unknown;
    detectChanges: () => void;
  }): HTMLElement[] {
    const host = fixture.nativeElement as HTMLElement;
    const container = host.querySelector('app-actions-menu') as HTMLElement;
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    adminUpdateStatus = vi
      .fn()
      .mockReturnValue(of({ ticket: { ...OPEN_TICKET, status: 'RESOLVED' }, replies: [] }));
    TestBed.configureTestingModule({
      imports: [AdminSupportList],
      providers: [
        ApiErrorService,
        {
          provide: SupportTicketService,
          useValue: {
            adminList: vi
              .fn()
              .mockReturnValue(of({ content: [OPEN_TICKET], page: 0, size: 20, total: 1 })),
            adminGet: vi.fn().mockReturnValue(of({ ticket: OPEN_TICKET, replies: [] })),
            adminUpdateStatus,
            adminReply: vi.fn(),
            adminAssign: vi.fn(),
            adminUnassign: vi.fn(),
            adminAssignees: vi.fn().mockReturnValue(of([])),
            adminCompanies: vi.fn().mockReturnValue(of([])),
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
      ],
    });
  });

  it('expõe as transições de status do ticket aberto no menu', () => {
    const fixture = TestBed.createComponent(AdminSupportList);
    fixture.detectChanges();

    const labels = openMenuItems(fixture).map((el) => el.textContent?.trim());

    expect(labels).toContain('Marcar em atendimento');
    expect(labels).toContain('Resolver');
    expect(labels).not.toContain('Reabrir');
  });

  it('"Resolver" chama o service com o novo status', () => {
    const fixture = TestBed.createComponent(AdminSupportList);
    fixture.detectChanges();

    const resolve = openMenuItems(fixture).find((el) => el.textContent?.trim() === 'Resolver');
    resolve?.click();
    fixture.detectChanges();

    expect(adminUpdateStatus).toHaveBeenCalledWith('tkt-abcdef12', { status: 'RESOLVED' });
  });
});
