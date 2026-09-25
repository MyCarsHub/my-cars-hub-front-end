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

  /**
   * Layout pedido pelo dono do produto: formulário EM CIMA, listagem EMBAIXO,
   * empilhados. Antes eram duas colunas (`grid lg:grid-cols-3`), o que em 375px
   * escondia a lista atrás de um formulário inteiro. O teste ancora a ordem e a
   * ausência de colunas para que uma edição futura não volte atrás em silêncio.
   */
  it('empilha formulário em cima e listagem embaixo, sem colunas lado a lado', () => {
    const { fixture } = render();
    const host = fixture.nativeElement as HTMLElement;

    const cards = Array.from(host.querySelectorAll('app-page-card'));
    expect(cards.map((c) => c.querySelector('h2')?.textContent?.trim())).toEqual([
      'Convidar pessoa',
      'Convites enviados',
    ]);
    // O formulário precisa estar DENTRO do primeiro cartão, não do segundo.
    expect(cards[0].querySelector('form')).not.toBeNull();
    expect(cards[1].querySelector('form')).toBeNull();

    // Nenhum ancestral dos cartões distribui o conteúdo em colunas.
    const columnised = Array.from(host.querySelectorAll('[class*="grid-cols"]')).filter((el) =>
      el.querySelector('app-page-card'),
    );
    expect(columnised).toEqual([]);
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
});
