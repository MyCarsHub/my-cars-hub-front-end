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
import { INVITE_TTL_DAYS } from '../../types/invite.types';
import type { InviteResponse } from '../../types/invite.types';

/**
 * Cobre o que o usuário faz nesta tela — enviar, listar, reenviar, cancelar — e as quatro
 * falhas que precisam de texto próprio: 403 (sem permissão), 409 (conflito), 410
 * (expirado, separado do 404) e 429 (excesso de requisições).
 */
/*
 * A LISTAGEM SAIU DESTA TELA (FEAT-0267), e com ela os seis casos que a cobriam: status por
 * linha, acoes so nos acionaveis, empilhamento form-em-cima-lista-embaixo, reenvio, cancelar
 * com confirmacao, e as frases de 410 e 409 das duas acoes.
 *
 * Nao foram APAGADOS: a mesma cobertura vive em `members.spec.ts`, onde a lista passou a
 * existir junto com os membros. Esta tela ficou com um proposito so — o formulario — e o que
 * sobrou aqui cobre exatamente isso.
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

  /**
   * Este teste afirmava `{email, role: 'MANAGER'}` — ou seja, fixava em verde exatamente o
   * payload que o backend recusa com `ERROR_MANAGER_DATA_REQUIRED`. O assunto dele (o trim
   * do e-mail) continua o mesmo; o que mudou foi a afirmação sobre o corpo enviado.
   */
  it('envia o convite com o e-mail sem espaços e o papel escolhido', () => {
    const { component } = render();

    component.inviteForm.patchValue({
      email: '  novo@empresa.com.br  ',
      role: 'MANAGER',
      name: 'Fulano de Tal',
      cpf: '529.982.247-25',
      phone: '(11) 98765-4321',
    });
    component.send();

    expect(create).toHaveBeenCalledWith({
      email: 'novo@empresa.com.br',
      role: 'MANAGER',
      name: 'Fulano de Tal',
      cpf: '52998224725',
      phone: '11987654321',
    });
    expect(notifySuccess).toHaveBeenCalledWith('Convite enviado para novo@empresa.com.br.');
    expect(component.inviteForm.getRawValue().email).toBe('');
  });

  it('não chama a API com e-mail inválido', () => {
    const { component } = render();

    component.inviteForm.patchValue({ email: 'sem-arroba', role: 'DRIVER' });
    component.send();

    expect(create).not.toHaveBeenCalled();
  });

  it('403 no envio explica que falta permissão', () => {
    const { component } = render();
    create.mockReturnValue(throwError(() => error(403)));

    component.inviteForm.patchValue({ email: 'novo@empresa.com.br', role: 'DRIVER' });
    component.send();

    expect(component.createError()).toContain('não tem permissão');
  });

  it('429 no envio pede para aguardar', () => {
    const { component } = render();
    create.mockReturnValue(throwError(() => error(429)));

    component.inviteForm.patchValue({ email: 'novo@empresa.com.br', role: 'DRIVER' });
    component.send();

    expect(component.createError()).toContain('Muitas tentativas');
  });
  /**
   * O convite de GERENTE nao era um campo faltando: era uma porta fechada.
   *
   * O backend exige name/cpf/phone para MANAGER; o formulario mandava so {email, role}; e o
   * select SEMPRE ofereceu "Gerenciador". Logo, escolher esse cargo dava 400 em 100% das
   * tentativas. Os testes abaixo cobrem a porta que abriu e, principalmente, o contrapeso:
   * o motorista tem de continuar enviando EXATAMENTE o que enviava.
   */
  describe('dados do gerenciador, condicionais ao cargo', () => {
    const VALID_CPF = '529.982.247-25';

    function fillManager(component: { inviteForm: FormGroup }): void {
      component.inviteForm.patchValue({
        email: 'gerente@empresa.com.br',
        role: 'MANAGER',
        name: 'Fulano de Tal',
        cpf: VALID_CPF,
        phone: '(11) 98765-4321',
      });
    }

    it('MOTORISTA envia so email e role, com os campos novos vazios', () => {
      const { component } = render();

      component.inviteForm.patchValue({ email: 'motorista@empresa.com.br', role: 'DRIVER' });
      component.send();

      expect(create).toHaveBeenCalledWith({
        email: 'motorista@empresa.com.br',
        role: 'DRIVER',
      });
    });

    it('MOTORISTA e valido mesmo com nome, CPF e telefone em branco', () => {
      const { component } = render();

      component.inviteForm.patchValue({ email: 'motorista@empresa.com.br', role: 'DRIVER' });

      expect(component.inviteForm.valid).toBe(true);
    });

    /** O caso do dono: o que hoje produz 400 em toda tentativa. */
    it('GERENTE com os dados completos chega a chamar a API', () => {
      const { component } = render();

      fillManager(component);
      component.send();

      expect(create).toHaveBeenCalledWith({
        email: 'gerente@empresa.com.br',
        role: 'MANAGER',
        name: 'Fulano de Tal',
        cpf: '52998224725',
        phone: '11987654321',
      });
    });

    it('GERENTE sem os dados NAO chama a API — a tela barra antes do 400', () => {
      const { component } = render();

      component.inviteForm.patchValue({ email: 'gerente@empresa.com.br', role: 'MANAGER' });
      component.send();

      expect(create).not.toHaveBeenCalled();
    });

    /** Sentido 1: trocar para Gerenciador ACENDE a exigencia sem o usuario tocar nos campos. */
    it('Motorista -> Gerenciador acende a obrigatoriedade sozinho', () => {
      const { component } = render();

      component.inviteForm.patchValue({ email: 'alguem@empresa.com.br', role: 'DRIVER' });
      expect(component.inviteForm.valid).toBe(true);

      component.inviteForm.controls['role'].setValue('MANAGER');

      expect(component.inviteForm.valid).toBe(false);
      expect(component.inviteForm.get('cpf')?.hasError('required')).toBe(true);
    });

    /** Sentido 2: e voltar APAGA a exigencia, sem deixar erro preso na tela. */
    it('Gerenciador -> Motorista apaga a obrigatoriedade E os erros', () => {
      const { component } = render();

      component.inviteForm.patchValue({ email: 'alguem@empresa.com.br', role: 'MANAGER' });
      component.inviteForm.markAllAsTouched();
      expect(component.inviteForm.valid).toBe(false);

      component.inviteForm.controls['role'].setValue('DRIVER');

      expect(component.inviteForm.valid).toBe(true);
      expect(component.inviteForm.get('cpf')?.errors).toBeNull();
      expect(component.inviteForm.get('name')?.errors).toBeNull();
      expect(component.inviteForm.get('phone')?.errors).toBeNull();
    });

    /**
     * A armadilha registrada neste projeto: campo mascarado guarda TEXTO. Um validador que
     * esperasse numero leria o campo como VAZIO e o sintoma seria "obrigatorio ignorado",
     * nao "formato invalido". Aqui o CPF mascarado tem de ser aceito.
     */
    it('o CPF MASCARADO e aceito — a validacao le TEXTO, nao numero', () => {
      const { component } = render();

      fillManager(component);

      expect(component.inviteForm.get('cpf')?.errors).toBeNull();
      expect(component.inviteForm.valid).toBe(true);
    });

    it('CPF com digito verificador errado e recusado', () => {
      const { component } = render();

      fillManager(component);
      component.inviteForm.get('cpf')?.setValue('111.111.111-11');

      expect(component.inviteForm.get('cpf')?.hasError('cpfInvalid')).toBe(true);
    });

    it('depois de enviar um convite de GERENTE o form volta para Motorista, sem exigencia', () => {
      const { component } = render();

      fillManager(component);
      component.send();

      expect(component.inviteForm.getRawValue().role).toBe('DRIVER');
      expect(component.inviteForm.valid).toBe(false); // e-mail vazio
      expect(component.inviteForm.get('cpf')?.errors).toBeNull();
    });
  });

  /**
   * A copy do formulário PROMETE uma janela de validade, e essa janela é do backend
   * (`InvitesService.INVITE_TTL_DAYS`). Nenhuma resposta a expõe, então o frontend a
   * espelha em `INVITE_TTL_DAYS` — e este teste falha se alguém voltar a digitar um número
   * ou uma unidade direto na frase, que é como a tela passou a prometer 24 horas enquanto
   * o convite durava 7 dias.
   *
   * LIMITE DESTE TESTE: ele prova que a frase e o espelho não divergem. Ele NÃO prova que
   * o espelho acompanha o backend — isso é de `InvitesServiceTest`, que afirma a janela no
   * aceite.
   */
  it('a validade prometida no formulário é a do TTL espelhado, e em dias', () => {
    const { fixture } = render();

    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    const promised = /vale por\s+(\d+)\s+(horas?|dias?)/.exec(text);

    expect(promised).not.toBeNull();
    expect(Number(promised?.[1])).toBe(INVITE_TTL_DAYS);
    expect(promised?.[2]).toMatch(/^dias?$/);
  });
});
