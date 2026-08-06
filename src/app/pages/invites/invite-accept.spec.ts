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
    expect(text).toContain('Gerente');
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
});
