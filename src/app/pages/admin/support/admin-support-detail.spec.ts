import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AdminSupportList } from './admin-support-list';
import { SupportTicketService } from '../../../services/support-ticket.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { SUPPORT_REPLY_EMAIL_STATUS_META } from '../../../types/support.types';
import type {
  SupportAssigneeOption,
  SupportTicketAdminDetail,
  SupportTicketAdminItem,
  SupportTicketReply,
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

const ADMINS: SupportAssigneeOption[] = [
  { id: 'adm-1', name: 'Lorran Santos', email: 'lorran@mycarshub.app.br' },
  { id: 'adm-2', name: null, email: 'suporte@mycarshub.app.br' },
];

function reply(overrides: Partial<SupportTicketReply> = {}): SupportTicketReply {
  return {
    id: 'rep-1',
    createdDate: '2026-01-10T14:00:00',
    authorUserId: 'adm-1',
    authorName: 'Lorran Santos',
    message: 'Regeneramos o contrato, pode tentar de novo.',
    emailStatus: 'QUEUED',
    ...overrides,
  };
}

describe('AdminSupportList — thread, resposta e atribuição', () => {
  let fixture: ComponentFixture<AdminSupportList>;
  let service: {
    adminList: ReturnType<typeof vi.fn>;
    adminGet: ReturnType<typeof vi.fn>;
    adminUpdateStatus: ReturnType<typeof vi.fn>;
    adminReply: ReturnType<typeof vi.fn>;
    adminAssign: ReturnType<typeof vi.fn>;
    adminUnassign: ReturnType<typeof vi.fn>;
    adminAssignees: ReturnType<typeof vi.fn>;
    adminCompanies: ReturnType<typeof vi.fn>;
  };
  let notifySuccess: ReturnType<typeof vi.fn>;
  let notifyWarning: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => el().textContent ?? '';

  function openTicket(): void {
    const toggle = Array.from(el().querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Abrir ticket e responder'),
    );
    toggle?.click();
    fixture.detectChanges();
  }

  function typeReply(message: string): void {
    const textarea = el().querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = message;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submitReply(): void {
    const form = el().querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  function assigneeSelect(): HTMLSelectElement {
    return el().querySelector('#ticket-assignee-tkt-1') as HTMLSelectElement;
  }

  function pickAssignee(value: string): void {
    const select = assigneeSelect();
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    notifySuccess = vi.fn();
    notifyWarning = vi.fn();
    notifyError = vi.fn();

    service = {
      adminList: vi.fn().mockReturnValue(of({ content: [TICKET], page: 0, size: 20, total: 1 })),
      adminGet: vi.fn().mockReturnValue(of({ ticket: TICKET, replies: [] })),
      adminUpdateStatus: vi.fn(),
      adminReply: vi.fn(),
      adminAssign: vi.fn(),
      adminUnassign: vi.fn(),
      adminAssignees: vi.fn().mockReturnValue(of(ADMINS)),
      adminCompanies: vi.fn().mockReturnValue(of([{ id: 'co-1', name: 'Locadora Aurora' }])),
    };

    await TestBed.configureTestingModule({
      imports: [AdminSupportList],
      providers: [
        ApiErrorService,
        { provide: SupportTicketService, useValue: service },
        {
          provide: NotificationService,
          useValue: {
            success: notifySuccess,
            warning: notifyWarning,
            error: notifyError,
            info: vi.fn(),
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

  // ------------------------------------------------------------------ thread

  it('abre o ticket e mostra a thread já existente', () => {
    service.adminGet.mockReturnValue(of({ ticket: TICKET, replies: [reply()] }));

    openTicket();

    expect(service.adminGet).toHaveBeenCalledWith('tkt-1');
    expect(text()).toContain('Regeneramos o contrato, pode tentar de novo.');
    expect(text()).toContain('Lorran Santos');
  });

  it('a resposta enviada aparece na thread', () => {
    openTicket();
    expect(text()).toContain('Nenhuma resposta ainda');

    const created: SupportTicketAdminDetail = {
      ticket: { ...TICKET, replyCount: 1, lastReplyAt: '2026-01-10T14:00:00' },
      replies: [reply()],
    };
    service.adminReply.mockReturnValue(of(created));

    typeReply('Regeneramos o contrato, pode tentar de novo.');
    submitReply();

    expect(service.adminReply).toHaveBeenCalledWith('tkt-1', {
      message: 'Regeneramos o contrato, pode tentar de novo.',
    });
    expect(text()).toContain('Regeneramos o contrato, pode tentar de novo.');
    expect((el().querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('rotula QUEUED como DESPACHO, nunca como entrega', () => {
    service.adminGet.mockReturnValue(of({ ticket: TICKET, replies: [reply()] }));

    openTicket();

    expect(text()).toContain('E-mail despachado');
    expect(text()).toContain('Não confirma que chegou à caixa de entrada do autor.');
    expect(text()).not.toContain('E-mail entregue');
  });

  /**
   * O contrato tem só dois estados de despacho. Não existe um "falhou": o DTO
   * é montado antes do commit e o e-mail sai depois dele, então a requisição
   * não teria como reportar um envio. Um chip vermelho que nunca aparece só
   * ensinaria o admin a esperar um aviso que jamais vem.
   */
  it('não tem estado de falha de e-mail — o despacho é QUEUED ou SKIPPED', () => {
    expect(Object.keys(SUPPORT_REPLY_EMAIL_STATUS_META).sort()).toEqual(['QUEUED', 'SKIPPED']);

    service.adminGet.mockReturnValue(
      of({ ticket: TICKET, replies: [reply(), reply({ id: 'rep-2', emailStatus: 'SKIPPED' })] }),
    );

    openTicket();

    expect(text()).not.toContain('Falha no despacho');
    expect(text()).not.toContain('não chegou a ser despachado');
  });

  it('avisa em SKIPPED que ninguém foi notificado', () => {
    service.adminReply.mockReturnValue(
      of({ ticket: TICKET, replies: [reply({ emailStatus: 'SKIPPED' })] }),
    );

    openTicket();
    typeReply('Não temos e-mail do autor, registrando aqui.');
    submitReply();

    expect(notifyWarning).toHaveBeenCalledTimes(1);
    expect(notifyWarning.mock.calls[0][0]).toContain('ninguém foi avisado');
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------ resposta

  it('o botão declara que a ação manda e-mail para o autor', () => {
    openTicket();

    const button = el().querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.textContent).toContain('Enviar resposta por e-mail ao autor');
    expect(text()).toContain('marina@aurora.com.br');
  });

  it('impede duplo envio enquanto a resposta está em voo', () => {
    const pending = new Subject<SupportTicketAdminDetail>();
    service.adminReply.mockReturnValue(pending.asObservable());

    openTicket();
    typeReply('Resposta em voo, não duplique.');
    submitReply();
    submitReply();

    expect(service.adminReply).toHaveBeenCalledTimes(1);
    const button = el().querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Enviando…');
  });

  it('não envia mensagem abaixo do mínimo do backend', () => {
    openTicket();
    typeReply('oi');
    submitReply();

    expect(service.adminReply).not.toHaveBeenCalled();
    expect(text()).toContain('pelo menos 5 caracteres');
  });

  it('mostra a falha da resposta inline, sem toast', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { message: 'message deve ter entre 5 e 4000 caracteres' },
    });
    service.adminReply.mockReturnValue(throwError(() => error));

    openTicket();
    typeReply('Resposta que o backend recusa.');
    submitReply();

    expect(text()).toContain('message deve ter entre 5 e 4000 caracteres');
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------ atribuição

  it('lista os PLATFORM_ADMIN como candidatos a responsável', () => {
    openTicket();

    const labels = Array.from(assigneeSelect().options).map((o) => o.textContent?.trim());
    expect(labels).toEqual([
      'Sem responsável',
      'Lorran Santos',
      // admin sem nome cai no e-mail
      'suporte@mycarshub.app.br',
    ]);
  });

  it('atribui um responsável e reflete o nome na linha', () => {
    service.adminAssign.mockReturnValue(
      of({
        ticket: { ...TICKET, assignedTo: 'adm-1', assignedToName: 'Lorran Santos' },
        replies: [],
      }),
    );

    openTicket();
    pickAssignee('adm-1');

    expect(service.adminAssign).toHaveBeenCalledWith('tkt-1', { assigneeId: 'adm-1' });
    expect(text()).toContain('Responsável: Lorran Santos');
    expect(notifySuccess).toHaveBeenCalledWith('Responsável definido: Lorran Santos.');
  });

  /**
   * Desatribuir é DELETE, nunca um PUT com o campo vazio: `assigneeId` é
   * obrigatório no PUT e um corpo sem ele responde 400 — o caminho antigo
   * pelo `null` deixaria a opção "Sem responsável" quebrada.
   */
  it('desatribui pelo DELETE, sem tocar no PUT', () => {
    service.adminGet.mockReturnValue(
      of({
        ticket: { ...TICKET, assignedTo: 'adm-1', assignedToName: 'Lorran Santos' },
        replies: [],
      }),
    );
    service.adminUnassign.mockReturnValue(of({ ticket: TICKET, replies: [] }));

    openTicket();
    pickAssignee('');

    expect(service.adminUnassign).toHaveBeenCalledWith('tkt-1');
    expect(service.adminAssign).not.toHaveBeenCalled();
    expect(text()).toContain('Responsável: Sem responsável');
    expect(notifySuccess).toHaveBeenCalledWith('Ticket devolvido à fila, sem responsável.');
  });

  /** Falha no DELETE devolve o `<select>` ao responsável que ainda é o real. */
  it('reverte o seletor quando o DELETE de desatribuição falha', () => {
    service.adminGet.mockReturnValue(
      of({
        ticket: { ...TICKET, assignedTo: 'adm-1', assignedToName: 'Lorran Santos' },
        replies: [],
      }),
    );
    const error = new HttpErrorResponse({
      status: 409,
      error: { message: 'Ticket resolvido não pode voltar para a fila.' },
    });
    service.adminUnassign.mockReturnValue(throwError(() => error));

    openTicket();
    pickAssignee('');

    expect(text()).toContain('Ticket resolvido não pode voltar para a fila.');
    expect(assigneeSelect().value).toBe('adm-1');
    expect(text()).toContain('Responsável: Lorran Santos');

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  /**
   * 400 do backend quando o UUID não é de um PLATFORM_ADMIN ativo: a mensagem
   * do servidor aparece verbatim e o `<select>` volta ao responsável real —
   * deixá-lo no valor recusado faria a tela mentir sobre o estado do ticket.
   */
  it('mostra a mensagem do backend em um responsável inválido e reverte o seletor', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { message: 'Responsável inválido: o usuário informado não é um PLATFORM_ADMIN ativo.' },
    });
    service.adminAssign.mockReturnValue(throwError(() => error));

    openTicket();
    pickAssignee('adm-2');

    expect(text()).toContain(
      'Responsável inválido: o usuário informado não é um PLATFORM_ADMIN ativo.',
    );
    expect(assigneeSelect().value).toBe('');

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
