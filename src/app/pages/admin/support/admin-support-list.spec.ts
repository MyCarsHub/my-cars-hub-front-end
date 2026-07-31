import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AdminSupportList } from './admin-support-list';
import { SupportTicketService } from '../../../services/support-ticket.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type { SupportTicketDto } from '../../../types/support.types';

const TICKET: SupportTicketDto = {
  id: 'tkt-1',
  createdDate: '2026-01-10T12:00:00Z',
  companyId: 'co-1',
  userId: 'usr-1',
  message: 'Não consigo emitir o contrato.',
  channel: 'EMAIL',
  status: 'OPEN',
  resolvedAt: null,
  resolvedBy: null,
};

/**
 * Feedback standard (phase 3): a 4xx de `adminUpdateStatus` deve aparecer INLINE
 * na própria linha do ticket, com a mensagem do backend VERBATIM (nunca trocada
 * pelo texto genérico), e nunca virar toast. O sucesso é o único toast da tela.
 */
describe('AdminSupportList — feedback de erro/sucesso', () => {
  let adminUpdateStatus: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<AdminSupportList>>;

  function changeStatus(): void {
    (
      fixture.componentInstance as unknown as {
        changeStatus: (t: SupportTicketDto, next: 'RESOLVED') => void;
      }
    ).changeStatus(TICKET, 'RESOLVED');
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    adminUpdateStatus = vi.fn();
    notifyError = vi.fn();
    notifySuccess = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AdminSupportList],
      providers: [
        ApiErrorService,
        {
          provide: SupportTicketService,
          useValue: {
            adminList: vi.fn().mockReturnValue(of({ content: [TICKET], total: 1 })),
            adminUpdateStatus,
          },
        },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            warning: vi.fn(),
            info: vi.fn(),
            success: notifySuccess,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminSupportList);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra a mensagem do backend verbatim na linha do ticket, sem toast', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { message: 'Ticket já foi resolvido por outro administrador.' },
    });
    adminUpdateStatus.mockReturnValue(throwError(() => error));

    changeStatus();

    const banner = fixture.nativeElement.querySelector(
      'app-alert-banner [role="alert"]',
    ) as HTMLElement | null;
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Ticket já foi resolvido por outro administrador.');
    // o texto genérico é apenas FALLBACK — não pode substituir o do backend
    expect(fixture.nativeElement.textContent).not.toContain('Falha ao atualizar status.');

    // e nunca toast — a rede de segurança do interceptor fica quieta
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('cai no fallback genérico quando o backend não manda mensagem', () => {
    const error = new HttpErrorResponse({ status: 400, error: null });
    adminUpdateStatus.mockReturnValue(throwError(() => error));

    changeStatus();

    expect(fixture.nativeElement.textContent).toContain('Falha ao atualizar status.');
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('dispara exatamente um toast de sucesso ao mover o status', () => {
    adminUpdateStatus.mockReturnValue(of({ ...TICKET, status: 'RESOLVED' }));

    changeStatus();

    expect(notifySuccess).toHaveBeenCalledTimes(1);
    expect(notifySuccess).toHaveBeenCalledWith('Ticket movido para "Resolvido".');
    expect(notifyError).not.toHaveBeenCalled();
  });
});
