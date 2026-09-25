import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteAccept } from './invite-accept';
import { PENDING_INVITE_TOKEN_KEY } from './invite-session';
import { ApiErrorService } from '../../services/api-error.service';
import { AuthService } from '../../services/auth.service';
import { InvitesService } from '../../services/invites.service';
import { LoginService } from '../../services/loginService';
import { NotificationService } from '../../services/notification.service';
import { SessionService } from '../../services/session.service';
import type { AcceptInviteResponse, ValidateInviteResponse } from '../../types/invite.types';

/**
 * O link do e-mail é `/invite/accept?token=…` e é aberto DESLOGADO. O que estes testes
 * protegem: a validação anônima acontece antes do login, o token bruto sobrevive à ida
 * ao Google via sessionStorage, e o aceite grava o token ACCESS já escopado na empresa —
 * sem `/auth/select-company` e sem `/auth/me` no meio.
 */
describe('InviteAccept — página pública de aceite', () => {
  const details: ValidateInviteResponse = {
    email: 'convidado@empresa.com.br',
    role: 'MANAGER',
    companyName: 'Locadora Alfa',
    userExists: false,
  };

  const acceptResponse: AcceptInviteResponse = {
    message: 'ok',
    token: 'access-token-da-empresa',
    companyId: 'co-9',
    companyName: 'Locadora Alfa',
    role: 'MANAGER',
  };

  interface Harness {
    continueWithGoogle: () => void;
    switchAccount: () => void;
    errorMessage: () => string | null;
  }

  let store: Record<string, string>;
  let validate: ReturnType<typeof vi.fn>;
  let accept: ReturnType<typeof vi.fn>;
  let applyFinishResponse: ReturnType<typeof vi.fn>;
  let logout: ReturnType<typeof vi.fn>;
  let loginWithGoogle: ReturnType<typeof vi.fn>;
  let reset: ReturnType<typeof vi.fn>;

  function error(status: number): HttpErrorResponse {
    return new HttpErrorResponse({ status, error: { message: 'falhou' } });
  }

  function render(token: string | null): {
    fixture: ComponentFixture<InviteAccept>;
    component: Harness;
    navigate: ReturnType<typeof vi.fn>;
  } {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [InviteAccept],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(token === null ? {} : { token }),
            },
          },
        },
        { provide: InvitesService, useValue: { validate, accept, reset } },
        { provide: AuthService, useValue: { applyFinishResponse, logout } },
        { provide: LoginService, useValue: { loginWithGoogle } },
        {
          provide: SessionService,
          useValue: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            removeItem: (key: string) => {
              delete store[key];
            },
            getToken: () => store['token'] ?? null,
          },
        },
        {
          provide: NotificationService,
          useValue: {
            success: vi.fn(),
            error: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });

    const navigate = vi.fn(() => Promise.resolve(true));
    const router = TestBed.inject(Router);
    router.navigate = navigate as unknown as Router['navigate'];

    const fixture = TestBed.createComponent(InviteAccept);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance as unknown as Harness, navigate };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    store = {};
    validate = vi.fn(() => of(details));
    accept = vi.fn(() => of(acceptResponse));
    applyFinishResponse = vi.fn();
    logout = vi.fn(() => {
      store = {};
    });
    loginWithGoogle = vi.fn();
    reset = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('valida o token anonimamente e mostra empresa, papel e e-mail antes do login', () => {
    const { fixture } = render('raw-token');

    expect(validate).toHaveBeenCalledWith('raw-token');
    expect(accept).not.toHaveBeenCalled();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Locadora Alfa');
    expect(text).toContain('Gerenciador');
    expect(text).toContain('convidado@empresa.com.br');
  });

  it('guarda o token bruto na sessão antes de entregar a aba ao Google', () => {
    const { component } = render('raw-token');

    component.continueWithGoogle();

    expect(store[PENDING_INVITE_TOKEN_KEY]).toBe('raw-token');
    expect(loginWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('com sessão já ativa aceita sozinho e entra direto na empresa', () => {
    // Volta do Google: `OauthSuccess` zera a sessão e NÃO chama `/auth/me` no fluxo de
    // convite, então não há `email` guardado — sem e-mail para comparar, aceitar é o
    // comportamento certo (o backend continua sendo a autoridade).
    store['token'] = 'temporally-token';

    const { navigate } = render('raw-token');

    expect(accept).toHaveBeenCalledWith('raw-token');
    // O token ACCESS da resposta é o que persiste — nada de select-company/auth-me.
    expect(applyFinishResponse).toHaveBeenCalledWith(acceptResponse);
    expect(navigate).toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
    expect(store[PENDING_INVITE_TOKEN_KEY]).toBeUndefined();
    expect(reset).toHaveBeenCalled();
  });

  /**
   * O caso real que quebrou produção: o dono abriu o link do convite na MESMA aba em que
   * já estava logado como proprietário. A conta convidada é outra. Disparar o aceite ali
   * gasta o convite contra a conta errada e volta 400 do backend — a divergência precisa
   * ser mostrada ANTES da chamada.
   */
  it('sessão de OUTRA conta não dispara o aceite: mostra a divergência e oferece trocar', () => {
    store['token'] = 'token-do-dono';
    store['email'] = 'dono@empresa.com.br';

    const { fixture, component } = render('raw-token');

    expect(accept).not.toHaveBeenCalled();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('dono@empresa.com.br');
    expect(text).toContain('convidado@empresa.com.br');

    component.switchAccount();

    expect(logout).toHaveBeenCalled();
    expect(store[PENDING_INVITE_TOKEN_KEY]).toBe('raw-token');
    expect(loginWithGoogle).toHaveBeenCalled();
  });

  it('mesma conta com caixa e espaços diferentes é a mesma conta — aceita', () => {
    store['token'] = 'token-do-convidado';
    store['email'] = '  CONVIDADO@Empresa.COM.BR ';

    const { navigate } = render('raw-token');

    expect(accept).toHaveBeenCalledWith('raw-token');
    expect(navigate).toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
  });

  it('410 na validação fala em convite expirado', () => {
    validate.mockReturnValue(throwError(() => error(410)));

    const { component } = render('raw-token');

    expect(component.errorMessage()).toContain('expirou');
  });

  it('409 no aceite diz que o convite já foi utilizado', () => {
    store['token'] = 'temporally-token';
    accept.mockReturnValue(throwError(() => error(409)));

    const { component } = render('raw-token');

    expect(component.errorMessage()).toContain('já foi utilizado');
  });

  it('403 no aceite aponta o e-mail errado e oferece trocar de conta', () => {
    store['token'] = 'de-outro-usuario';
    accept.mockReturnValue(throwError(() => error(403)));

    const { component } = render('raw-token');
    expect(component.errorMessage()).toContain('outro e-mail');

    component.switchAccount();

    expect(logout).toHaveBeenCalled();
    // Re-stashed AFTER the wipe — logout clears the whole sessionStorage.
    expect(store[PENDING_INVITE_TOKEN_KEY]).toBe('raw-token');
    expect(loginWithGoogle).toHaveBeenCalled();
  });

  it('429 na validação pede para aguardar', () => {
    validate.mockReturnValue(throwError(() => error(429)));

    const { component } = render('raw-token');

    expect(component.errorMessage()).toContain('Muitas tentativas');
  });

  it('sem token na URL nem chega a chamar a API', () => {
    const { component } = render(null);

    expect(validate).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('Link de convite inválido');
  });
  /**
   * FIX-0555 — a tela acusava o usuario de um erro que ele nao cometeu.
   *
   * O dono tentou aceitar um convite DUAS vezes em producao com o e-mail CERTO e leu que o
   * convite era de outro e-mail. A tela ainda oferecia "entrar com outra conta", o que o fez
   * repetir a tentativa e falhar igual. O botao aqui nao e detalhe: e o que transforma a
   * mensagem errada em trabalho perdido.
   */
  function switchAccountButton(fixture: ComponentFixture<InviteAccept>): HTMLElement | null {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => (b.textContent ?? '').includes('Entrar com outra conta')) as HTMLElement | null;
  }

  function errorWithCode(code: string): HttpErrorResponse {
    return new HttpErrorResponse({ status: 403, error: { code } });
  }

  it('403 por falta de cadastro de motorista: nomeia a causa e NAO oferece trocar de conta', () => {
    store['token'] = 'de-outro-usuario';
    accept.mockReturnValue(throwError(() => errorWithCode('DRIVER_IDENTITY_NOT_RESOLVED')));

    const { component, fixture } = render('raw-token');

    expect(component.errorMessage()).toContain('cadastro de motorista');
    expect(component.errorMessage()).toContain('gestor');
    expect(component.errorMessage()).not.toContain('outro e-mail');
    // O botao que empurrava o convidado para o erro que ele nao cometeu.
    expect(switchAccountButton(fixture)).toBeUndefined();
  });

  it('403 por divergencia de e-mail: copy de hoje E o botao de trocar de conta seguem', () => {
    store['token'] = 'de-outro-usuario';
    accept.mockReturnValue(throwError(() => errorWithCode('INVITE_EMAIL_MISMATCH')));

    const { component, fixture } = render('raw-token');

    expect(component.errorMessage()).toContain('outro e-mail');
    // Aqui trocar de conta E a acao certa, entao o botao tem de continuar existindo.
    expect(switchAccountButton(fixture)).toBeDefined();
  });
  /**
   * FEAT-0167 — a tela que fecha o ciclo. Aceites completados na historia deste sistema
   * ate aqui: ZERO. O convidado GERENTE confirma nome e telefone (pre-preenchidos) e DIGITA
   * o CPF, que o backend compara com o cofre.
   *
   * O CPF nao e pre-preenchido e isso e decisao de PII, nao esquecimento: a rota de
   * validacao e ANONIMA, quem tem o link le a resposta, e por isso o backend nao devolve o
   * CPF nem mascarado. Ha um teste abaixo fixando que o campo nasce VAZIO.
   */
  describe('FEAT-0167 — onboarding do convidado gerente', () => {
    const managerDetails: ValidateInviteResponse = {
      ...details,
      name: 'Fulano de Tal',
      phoneNumber: '11987654321',
      requiresManagerOnboarding: true,
    };

    /** CPF valido em digito verificador, para o form passar na validacao local. */
    const VALID_CPF = '529.982.247-25';

    function codeError(status: number, code: string): HttpErrorResponse {
      return new HttpErrorResponse({ status, error: { code } });
    }

    function field(fixture: ComponentFixture<InviteAccept>, id: string): HTMLInputElement {
      const el = (fixture.nativeElement as HTMLElement).querySelector(`#${id}`);
      if (!el) throw new Error(`campo ${id} nao esta na tela`);
      return el as HTMLInputElement;
    }

    function type(input: HTMLInputElement, value: string): void {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }

    function submit(fixture: ComponentFixture<InviteAccept>): void {
      const form = (fixture.nativeElement as HTMLElement).querySelector('form');
      if (!form) throw new Error('o formulario nao esta na tela');
      form.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
    }

    function openForm(): ComponentFixture<InviteAccept> {
      store['token'] = 'temporally-token';
      validate.mockReturnValue(of(managerDetails));
      const { fixture } = render('raw-token');
      fixture.detectChanges();
      return fixture;
    }

    it('gerente com onboarding NAO aceita sozinho: para no formulario', () => {
      const fixture = openForm();

      expect(accept).not.toHaveBeenCalled();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Confirme seus dados');
    });

    it('nome e telefone chegam pre-preenchidos, e o telefone vem MASCARADO', () => {
      const fixture = openForm();

      expect(field(fixture, 'invite-name').value).toBe('Fulano de Tal');
      expect(field(fixture, 'invite-phone').value).toBe('(11) 98765-4321');
    });

    /** A decisao de PII, fixada em teste para ninguem "consertar" depois. */
    it('o CPF nasce VAZIO — a rota anonima nao devolve CPF para pre-preencher', () => {
      const fixture = openForm();

      expect(field(fixture, 'invite-cpf').value).toBe('');
    });

    it('caminho feliz: confirma os dados e chega a MANAGER ativo', () => {
      const fixture = openForm();
      type(field(fixture, 'invite-cpf'), VALID_CPF);
      fixture.detectChanges();

      submit(fixture);

      // Digitos crus no corpo, mesmo que a tela mostre mascarado.
      expect(accept).toHaveBeenCalledWith('raw-token', {
        name: 'Fulano de Tal',
        cpf: '52998224725',
        phone: '11987654321',
      });
      expect(applyFinishResponse).toHaveBeenCalledWith(acceptResponse);
      expect(store[PENDING_INVITE_TOKEN_KEY]).toBeUndefined();
    });

    it('form invalido nao chama o servidor', () => {
      const fixture = openForm();
      // CPF vazio: o form barra antes de sair da tela.
      submit(fixture);

      expect(accept).not.toHaveBeenCalled();
    });

    /**
     * O erro cuja acao e CORRIGIR O CAMPO. Mandar quem errou um digito para a tela de erro
     * o obrigaria a recomecar o fluxo inteiro — e seria repetir o defeito do FIX-0555.
     */
    it('CPF divergente MANTEM o convidado no formulario, com o campo marcado', () => {
      const fixture = openForm();
      type(field(fixture, 'invite-cpf'), VALID_CPF);
      fixture.detectChanges();
      accept.mockReturnValue(throwError(() => codeError(400, 'INVITE_CPF_MISMATCH')));

      submit(fixture);

      const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
      // Continua no formulario: o campo ainda esta na tela.
      expect((fixture.nativeElement as HTMLElement).querySelector('#invite-cpf')).not.toBeNull();
      expect(text).toContain('não confere');
      expect(text).not.toContain('Não foi possível usar este convite');
    });

    it('e-mail divergente TIRA da tela: vai para o erro e oferece trocar de conta', () => {
      const fixture = openForm();
      type(field(fixture, 'invite-cpf'), VALID_CPF);
      fixture.detectChanges();
      accept.mockReturnValue(throwError(() => codeError(400, 'INVITE_EMAIL_MISMATCH')));

      submit(fixture);

      const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('outro e-mail');
      expect((fixture.nativeElement as HTMLElement).querySelector('#invite-cpf')).toBeNull();
    });

    /** Nao regredir o FIX-0555: aqui trocar de conta NAO e a acao, e o botao nao aparece. */
    it('motorista sem cadastro: mensagem do gestor e NENHUM botao de trocar conta', () => {
      const fixture = openForm();
      type(field(fixture, 'invite-cpf'), VALID_CPF);
      fixture.detectChanges();
      accept.mockReturnValue(throwError(() => codeError(403, 'DRIVER_IDENTITY_NOT_RESOLVED')));

      submit(fixture);

      const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('cadastro de motorista');
      expect(text).toContain('gestor');
      const switchBtn = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).find((b) => (b.textContent ?? '').includes('Entrar com outra conta'));
      expect(switchBtn).toBeUndefined();
    });

    /**
     * CONTRAPESO: o fluxo que JA existia. Sem `requiresManagerOnboarding` o aceite dispara
     * sozinho e SEM corpo. Se isto ficar vermelho, a metade que ja funcionava quebrou.
     */
    it('sem requiresManagerOnboarding o aceite segue direto e SEM corpo', () => {
      store['token'] = 'temporally-token';
      validate.mockReturnValue(of({ ...details, role: 'DRIVER' as const }));

      render('raw-token');

      expect(accept).toHaveBeenCalledWith('raw-token');
    });
  });
  /**
   * Onboarding do MOTORISTA — a ultima peca do fluxo.
   *
   * A mecanica e DIFERENTE da do gerente de proposito: o gerente decide por flag (derivado
   * de `role`, de graca), o motorista decide pelo CODIGO DE ERRO, porque a pergunta
   * equivalente exigiria ler a tabela de motoristas a partir de um endpoint PUBLICO.
   * Quem ja tem cadastro aceita em UM passo, sem ver formulario.
   */
  describe('onboarding do motorista', () => {
    const VALID_CPF = '529.982.247-25';

    const driverDetails: ValidateInviteResponse = { ...details, role: 'DRIVER' };

    /** O convite REAL do dono: nasceu so com e-mail, sem nome nem telefone. */
    const bareDetails: ValidateInviteResponse = {
      email: 'convidado@empresa.com.br',
      role: 'DRIVER',
      companyName: 'Locadora Alfa',
      userExists: false,
    };

    function codeError(status: number, code: string): HttpErrorResponse {
      return new HttpErrorResponse({ status, error: { code } });
    }

    function field(fixture: ComponentFixture<InviteAccept>, id: string): HTMLInputElement {
      const el = (fixture.nativeElement as HTMLElement).querySelector('#' + id);
      if (!el) throw new Error('campo ' + id + ' nao esta na tela');
      return el as HTMLInputElement;
    }

    function has(fixture: ComponentFixture<InviteAccept>, id: string): boolean {
      return (fixture.nativeElement as HTMLElement).querySelector('#' + id) !== null;
    }

    function type(input: HTMLInputElement, value: string): void {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }

    function submit(fixture: ComponentFixture<InviteAccept>): void {
      const form = (fixture.nativeElement as HTMLElement).querySelector('form');
      if (!form) throw new Error('o formulario nao esta na tela');
      form.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
    }

    /** Abre o form pelo caminho real: aceite sem corpo -> 400 com o codigo. */
    function openByError(
      response: ValidateInviteResponse = driverDetails,
    ): ComponentFixture<InviteAccept> {
      store['token'] = 'temporally-token';
      validate.mockReturnValue(of(response));
      accept.mockReturnValue(throwError(() => codeError(400, 'DRIVER_REGISTRATION_REQUIRED')));
      const { fixture } = render('raw-token');
      fixture.detectChanges();
      return fixture;
    }

    function fillAll(fixture: ComponentFixture<InviteAccept>): void {
      type(field(fixture, 'drv-name'), 'Fulano de Tal');
      type(field(fixture, 'drv-cpf'), VALID_CPF);
      type(field(fixture, 'drv-phone'), '(11) 98765-4321');
      type(field(fixture, 'drv-license'), 'ABC12345678');
      type(field(fixture, 'drv-expiry'), '2030-01-31');
      type(field(fixture, 'drv-cep'), '01310-100');
      type(field(fixture, 'drv-street'), 'Avenida Paulista');
      type(field(fixture, 'drv-district'), 'Bela Vista');
      type(field(fixture, 'drv-city'), 'Sao Paulo');
      type(field(fixture, 'drv-uf'), 'SP');
      fixture.detectChanges();
    }

    /** O CAMINHO DO DONO HOJE: quem ja tem cadastro nao ve formulario nenhum. */
    it('motorista JA cadastrado aceita em um passo, sem corpo e sem formulario', () => {
      store['token'] = 'temporally-token';
      validate.mockReturnValue(of(driverDetails));

      const { fixture } = render('raw-token');

      expect(accept).toHaveBeenCalledWith('raw-token');
      expect(has(fixture, 'drv-cpf')).toBe(false);
    });

    it('o 400 com DRIVER_REGISTRATION_REQUIRED ABRE o formulario', () => {
      const fixture = openByError();

      expect(has(fixture, 'drv-cpf')).toBe(true);
      expect(has(fixture, 'drv-license')).toBe(true);
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
        'Nao foi possivel usar este convite',
      );
    });

    /**
     * O CASO REAL DO DONO: o convite PENDING dele nasceu so com e-mail. Se a tela so
     * funcionasse pre-preenchida, e justamente este caminho que quebraria.
     */
    it('convite SEM nome e telefone abre o formulario em branco, e funciona', () => {
      const fixture = openByError(bareDetails);

      expect(field(fixture, 'drv-name').value).toBe('');
      expect(field(fixture, 'drv-phone').value).toBe('');

      accept.mockReturnValue(of(acceptResponse));
      fillAll(fixture);
      submit(fixture);

      expect(applyFinishResponse).toHaveBeenCalledWith(acceptResponse);
    });

    it('quando o convite TEM os dados, eles chegam pre-preenchidos e mascarados', () => {
      const fixture = openByError({
        ...driverDetails,
        name: 'Fulano de Tal',
        phoneNumber: '11987654321',
      });

      expect(field(fixture, 'drv-name').value).toBe('Fulano de Tal');
      expect(field(fixture, 'drv-phone').value).toBe('(11) 98765-4321');
    });

    /** O CPF nunca vem do servidor: rota anonima. Vale para as duas telas irmas. */
    it('o CPF nasce VAZIO mesmo quando o convite traz nome e telefone', () => {
      const fixture = openByError({
        ...driverDetails,
        name: 'Fulano de Tal',
        phoneNumber: '11987654321',
      });

      expect(field(fixture, 'drv-cpf').value).toBe('');
    });

    it('caminho feliz: reenvia COM corpo completo, com digitos crus', () => {
      const fixture = openByError();
      accept.mockReturnValue(of(acceptResponse));
      fillAll(fixture);

      submit(fixture);

      expect(accept).toHaveBeenLastCalledWith('raw-token', {
        name: 'Fulano de Tal',
        cpf: '52998224725',
        phone: '11987654321',
        licenseNumber: 'ABC12345678',
        licenseCategory: 'B',
        licenseExpiry: '2030-01-31',
        address: {
          street: 'Avenida Paulista',
          number: '',
          complement: '',
          district: 'Bela Vista',
          cep: '01310100',
          city: 'Sao Paulo',
          uf: 'SP',
        },
      });
    });

    it('form incompleto nao chama o servidor', () => {
      const fixture = openByError();
      accept.mockClear();

      submit(fixture);

      expect(accept).not.toHaveBeenCalled();
    });

    /**
     * A armadilha registrada: campo mascarado guarda TEXTO. Um validador que esperasse
     * numero leria o CPF como VAZIO, e o sintoma pareceria "obrigatorio ignorado".
     */
    it('o CPF MASCARADO e aceito — a validacao le TEXTO', () => {
      const fixture = openByError();
      accept.mockReturnValue(of(acceptResponse));
      fillAll(fixture);

      submit(fixture);

      expect(accept).toHaveBeenLastCalledWith(
        'raw-token',
        expect.objectContaining({ cpf: '52998224725' }),
      );
    });

    it('CNH fora do padrao de 11 caracteres barra o envio', () => {
      const fixture = openByError();
      fillAll(fixture);
      type(field(fixture, 'drv-license'), 'ABC123');
      fixture.detectChanges();
      accept.mockClear();

      submit(fixture);

      expect(accept).not.toHaveBeenCalled();
    });

    /** CNH ja usada: a mensagem e do SERVIDOR, que conhece o caso concreto. */
    it('409 mostra a mensagem DO SERVIDOR e mantem o convidado no formulario', () => {
      const fixture = openByError();
      fillAll(fixture);
      accept.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { message: 'CNH ja cadastrada para outro motorista.' },
            }),
        ),
      );

      submit(fixture);

      const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('CNH ja cadastrada para outro motorista.');
      expect(has(fixture, 'drv-license')).toBe(true);
    });

    /**
     * 402 e 409 saem do MESMO metodo do backend (`enforceDriverLimit`) por razoes
     * DIFERENTES, e por isso nao podem compartilhar frase:
     *   sem assinatura / sem plano -> AccessBlockedException -> 402
     *   no teto (current >= limit) -> HasConflictException(MSG_LIMIT_REACHED) -> 409
     *
     * Medido em origin/main d78c142, 2026-09-25. Ate esta data a tela dizia "a empresa
     * precisa liberar uma vaga" para o 402 — ou seja, mandava um motorista de empresa SEM
     * ASSINATURA pedir VAGA. A empresa olhava as vagas, achava tudo certo, e ninguem
     * resolvia. Mesma familia do defeito do convite: duas causas colapsadas numa frase, e a
     * frase escolhendo o diagnostico errado de quem le.
     */
    it('402 nomeia a ASSINATURA, nao a vaga', () => {
      const fixture = openByError();
      fillAll(fixture);
      accept.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 402 })));

      submit(fixture);

      const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('assinatura');
      // A causa errada que estava no lugar.
      expect(text).not.toContain('vaga');
      // A direcao nao muda: quem resolve segue sendo a empresa, e o motorista nao e culpado
      // nem mandado repetir.
      expect(text).toContain('empresa');
      expect(text.toLowerCase()).not.toContain('tente de novo');
      expect(has(fixture, 'drv-license')).toBe(true);
    });

    /**
     * CONTRAPESO do 402: o TETO chega como 409 e tem de exibir a mensagem DO SERVIDOR
     * (`MSG_LIMIT_REACHED`), nunca uma copy fixa da tela. Se caisse na copy de convite, o
     * teto apareceria como "convite ja utilizado" — outro erro da mesma familia.
     */
    it('409 de TETO mostra a mensagem do servidor, nao uma copy fixa da tela', () => {
      const fixture = openByError();
      fillAll(fixture);
      accept.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { message: 'Limite de motoristas do plano atingido.' },
            }),
        ),
      );

      submit(fixture);

      const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Limite de motoristas do plano atingido.');
      expect(text).not.toContain('já foi utilizado');
      expect(text).not.toContain('assinatura');
      expect(has(fixture, 'drv-license')).toBe(true);
    });

    /**
     * O 409 carrega DUAS causas (CNH repetida e teto), entao o fallback nao pode nomear
     * uma delas: sem mensagem do servidor, dizer "CNH ja cadastrada" para um teto seria
     * repetir exatamente o defeito que este no corrige.
     */
    it('409 sem mensagem do servidor cai num fallback que NAO chuta a causa', () => {
      const fixture = openByError();
      fillAll(fixture);
      accept.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));

      submit(fixture);

      const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('CNH já está cadastrada');
      expect(text).not.toContain('assinatura');
      expect(has(fixture, 'drv-license')).toBe(true);
    });

    /** CONTRAPESO: o gerente continua decidindo pelo FLAG, mecanica intocada. */
    it('o gerente segue abrindo pelo flag, sem depender de erro nenhum', () => {
      store['token'] = 'temporally-token';
      validate.mockReturnValue(of({ ...details, requiresManagerOnboarding: true }));

      const { fixture } = render('raw-token');
      fixture.detectChanges();

      expect(accept).not.toHaveBeenCalled();
      expect((fixture.nativeElement as HTMLElement).querySelector('#invite-cpf')).not.toBeNull();
    });
  });
});
