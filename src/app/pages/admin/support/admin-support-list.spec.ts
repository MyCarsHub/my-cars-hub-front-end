import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AdminSupportList } from './admin-support-list';
import { SupportTicketService } from '../../../services/support-ticket.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type {
  SupportTicketAdminDetail,
  SupportTicketAdminItem,
} from '../../../types/support.types';

const TICKET: SupportTicketAdminItem = {
  id: 'tkt-1',
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

const DETAIL: SupportTicketAdminDetail = { ticket: TICKET, replies: [] };

describe('AdminSupportList — listagem', () => {
  let adminList: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<AdminSupportList>>;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    adminList = vi.fn().mockReturnValue(of({ content: [TICKET], page: 0, size: 20, total: 1 }));

    await TestBed.configureTestingModule({
      imports: [AdminSupportList],
      providers: [
        ApiErrorService,
        {
          provide: SupportTicketService,
          useValue: {
            adminList,
            adminGet: vi.fn().mockReturnValue(of(DETAIL)),
            adminUpdateStatus: vi.fn().mockReturnValue(of(DETAIL)),
            adminReply: vi.fn().mockReturnValue(of(DETAIL)),
            adminAssign: vi.fn().mockReturnValue(of(DETAIL)),
            adminUnassign: vi.fn().mockReturnValue(of(DETAIL)),
            adminAssignees: vi.fn().mockReturnValue(of([])),
            adminCompanies: vi.fn().mockReturnValue(
              of([
                { id: 'co-1', name: 'Locadora Aurora' },
                { id: 'co-2', name: 'Frota Sul' },
              ]),
            ),
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminSupportList);
    fixture.detectChanges();
  });

  it('mostra empresa e autor por NOME, não por ID', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Locadora Aurora');
    expect(text).toContain('Marina Prado');
    expect(text).toContain('marina@aurora.com.br');
    // o ID cru não é mais o rótulo da linha
    expect(text).not.toContain('Ticket tkt-1');
    expect(text).not.toContain('Company co-1');
  });

  it('mostra "Sem responsável" enquanto ninguém assumiu o ticket', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sem responsável');
  });

  it('filtra por empresa mandando companyId e voltando para a primeira página', () => {
    const selects = (fixture.nativeElement as HTMLElement).querySelectorAll('select');
    const companySelect = selects[1] as HTMLSelectElement;

    expect(Array.from(companySelect.options).map((o) => o.textContent?.trim())).toEqual([
      'Todas as empresas',
      'Locadora Aurora',
      'Frota Sul',
    ]);

    companySelect.value = 'co-2';
    companySelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(adminList).toHaveBeenLastCalledWith({
      status: '',
      companyId: 'co-2',
      page: 0,
      size: 20,
    });
  });

  it('filtra por status sem perder o filtro de empresa', () => {
    const selects = (fixture.nativeElement as HTMLElement).querySelectorAll('select');
    const statusSelect = selects[0] as HTMLSelectElement;
    const companySelect = selects[1] as HTMLSelectElement;

    companySelect.value = 'co-1';
    companySelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    statusSelect.value = 'IN_PROGRESS';
    statusSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(adminList).toHaveBeenLastCalledWith({
      status: 'IN_PROGRESS',
      companyId: 'co-1',
      page: 0,
      size: 20,
    });
  });
});

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
        changeStatus: (t: SupportTicketAdminItem, next: 'RESOLVED') => void;
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
            adminList: vi
              .fn()
              .mockReturnValue(of({ content: [TICKET], page: 0, size: 20, total: 1 })),
            adminGet: vi.fn().mockReturnValue(of(DETAIL)),
            adminUpdateStatus,
            adminReply: vi.fn().mockReturnValue(of(DETAIL)),
            adminAssign: vi.fn().mockReturnValue(of(DETAIL)),
            adminUnassign: vi.fn().mockReturnValue(of(DETAIL)),
            adminAssignees: vi.fn().mockReturnValue(of([])),
            adminCompanies: vi.fn().mockReturnValue(of([])),
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

  /**
   * QUEBRA DE CONTRATO coberta aqui: o PATCH devolve `SupportTicketAdminDetailDto`
   * (`{ ticket, replies }`), não mais a linha crua. Ler `res.status` quebraria o
   * toast — e a linha da lista.
   */
  it('lê o status do envelope de detalhe devolvido pelo PATCH', () => {
    adminUpdateStatus.mockReturnValue(
      of({ ticket: { ...TICKET, status: 'RESOLVED' }, replies: [] }),
    );

    changeStatus();

    expect(notifySuccess).toHaveBeenCalledTimes(1);
    expect(notifySuccess).toHaveBeenCalledWith('Ticket movido para "Resolvido".');
    expect(notifyError).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Resolvido');
  });
});
