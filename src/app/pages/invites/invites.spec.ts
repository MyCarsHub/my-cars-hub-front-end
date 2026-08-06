import { HttpErrorResponse } from '@angular/common/http';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Invites } from './invites';
import { ApiErrorService } from '../../services/api-error.service';
import { InvitesService } from '../../services/invites.service';
import { NotificationService } from '../../services/notification.service';
import type { InviteResponse } from '../../types/invite.types';

/**
 * Cobre o que o usuário faz nesta tela — enviar, listar, reenviar, cancelar — e as quatro
 * falhas que precisam de texto próprio: 403 (sem permissão), 409 (conflito), 410
 * (expirado, separado do 404) e 429 (excesso de requisições).
 */
describe('Invites — envio e gestão de convites', () => {
  const pending: InviteResponse = {
    id: 'inv-1',
    email: 'novo@empresa.com.br',
    role: 'DRIVER',
    status: 'PENDING',
    expiresAt: '2026-08-06T12:00:00Z',
    createDate: '2026-08-05T12:00:00Z',
  };

  const accepted: InviteResponse = {
    ...pending,
    id: 'inv-2',
    email: 'antigo@empresa.com.br',
    status: 'ACCEPTED',
  };

  interface Harness {
    inviteForm: FormGroup;
    send: () => void;
    resend: (row: { id: string; email: string }) => void;
    askCancel: (row: { id: string; email: string }) => void;
    confirmCancel: () => void;
    createError: () => string | null;
    listError: () => string | null;
  }

  let invites: WritableSignal<InviteResponse[]>;
  let list: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let resend: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;

  function error(status: number, message = 'falhou'): HttpErrorResponse {
    return new HttpErrorResponse({ status, error: { message } });
  }

  function render(): { fixture: ComponentFixture<Invites>; component: Harness } {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Invites],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: InvitesService,
          useValue: {
            invites: invites.asReadonly(),
            loading: signal(false).asReadonly(),
            loaded: signal(true).asReadonly(),
            pendingCount: signal(1).asReadonly(),
            list,
            create,
            resend,
            cancel,
          },
        },
        {
          provide: NotificationService,
          useValue: {
            success: notifySuccess,
            error: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(Invites);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance as unknown as Harness };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    invites = signal<InviteResponse[]>([pending, accepted]);
    list = vi.fn(() => of([pending, accepted]));
    create = vi.fn(() => of(pending));
    resend = vi.fn(() => of(void 0));
    cancel = vi.fn(() => of(void 0));
    notifySuccess = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('envia o convite com o e-mail sem espaços e o papel escolhido', () => {
    const { component } = render();

    component.inviteForm.setValue({ email: '  novo@empresa.com.br  ', role: 'MANAGER' });
    component.send();

    expect(create).toHaveBeenCalledWith({ email: 'novo@empresa.com.br', role: 'MANAGER' });
    expect(notifySuccess).toHaveBeenCalledWith('Convite enviado para novo@empresa.com.br.');
    expect(component.inviteForm.getRawValue().email).toBe('');
  });

  it('não chama a API com e-mail inválido', () => {
    const { component } = render();

    component.inviteForm.setValue({ email: 'sem-arroba', role: 'DRIVER' });
    component.send();

    expect(create).not.toHaveBeenCalled();
  });

  it('lista os convites com status e ações apenas nos acionáveis', () => {
    const { fixture } = render();

    const text: string = fixture.nativeElement.textContent;
    expect(list).toHaveBeenCalled();
    expect(text).toContain('novo@empresa.com.br');
    expect(text).toContain('Aguardando');
    expect(text).toContain('Aceito');
    // Só o PENDING oferece reenviar/cancelar; o ACCEPTED seria 400 no backend.
    expect(fixture.nativeElement.querySelectorAll('button[aria-label^="Reenviar"]')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('button[aria-label^="Cancelar"]')).toHaveLength(1);
  });

  it('reenvia pelo id e recarrega a lista para pegar o novo prazo', () => {
    const { component } = render();
    list.mockClear();

    component.resend({ id: 'inv-1', email: 'novo@empresa.com.br' });

    expect(resend).toHaveBeenCalledWith('inv-1');
    expect(list).toHaveBeenCalledTimes(1);
    expect(notifySuccess).toHaveBeenCalledWith('Convite reenviado para novo@empresa.com.br.');
  });

  it('só cancela depois da confirmação', () => {
    const { component } = render();

    component.askCancel({ id: 'inv-1', email: 'novo@empresa.com.br' });
    expect(cancel).not.toHaveBeenCalled();

    component.confirmCancel();
    expect(cancel).toHaveBeenCalledWith('inv-1');
  });

  it('403 no envio explica que falta permissão', () => {
    const { component } = render();
    create.mockReturnValue(throwError(() => error(403)));

    component.inviteForm.setValue({ email: 'novo@empresa.com.br', role: 'DRIVER' });
    component.send();

    expect(component.createError()).toContain('não tem permissão');
  });

  it('429 no envio pede para aguardar', () => {
    const { component } = render();
    create.mockReturnValue(throwError(() => error(429)));

    component.inviteForm.setValue({ email: 'novo@empresa.com.br', role: 'DRIVER' });
    component.send();

    expect(component.createError()).toContain('Muitas tentativas');
  });

  it('410 no reenvio fala em expirado, não em inexistente', () => {
    const { component } = render();
    resend.mockReturnValue(throwError(() => error(410)));

    component.resend({ id: 'inv-1', email: 'novo@empresa.com.br' });

    expect(component.listError()).toContain('expirou');
    expect(component.listError()).not.toContain('não existe');
  });

  it('409 no cancelamento pede para atualizar a lista', () => {
    const { component } = render();
    cancel.mockReturnValue(throwError(() => error(409)));

    component.askCancel({ id: 'inv-1', email: 'novo@empresa.com.br' });
    component.confirmCancel();

    expect(component.listError()).toContain('mudou de status');
  });
});
