import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { vi } from 'vitest';
import { LoginService } from '../../services/loginService';
import { SessionService } from '../../services/session.service';
import { routes } from '../../app.routes';
import { Auth } from './auth';

/**
 * FIX-0298 / FIX-0288 — a porta de entrada do produto.
 *
 * O que estes testes protegem, em ordem de custo se quebrar:
 *
 * 1. O Google NAO pode regredir. E o login de producao, e agora divide a tela com um
 *    form de e-mail — entao ele e verificado nos DOIS modos, nao so no de entrar.
 * 2. A promessa do trial tem de estar ANTES do primeiro campo. Um teste de presenca
 *    passaria com o texto no rodape; por isso a assercao e de ORDEM no DOM.
 * 3. A alternancia tem de trocar o form de verdade (campos e endpoint), nao so o rotulo.
 */
describe('Auth (tela unica de autenticacao)', () => {
  const loginWithGoogle = vi.fn();
  const login = vi.fn();
  const signup = vi.fn();
  const isOnboardingCompleted = vi.fn(() => true);

  let fixture: ComponentFixture<Auth>;
  let navigate: ReturnType<typeof vi.spyOn>;

  async function render(queryParams: Record<string, string> = {}): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [Auth],
      providers: [
        provideRouter([]),
        { provide: LoginService, useValue: { loginWithGoogle, login, signup } },
        { provide: SessionService, useValue: { isOnboardingCompleted } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
        },
      ],
    }).compileComponents();

    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(Auth);
    fixture.detectChanges();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent ?? '';
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(host().querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').toLowerCase().includes(label.toLowerCase()),
    );
    if (!found) throw new Error(`botao ausente: ${label}`);
    return found as HTMLButtonElement;
  }

  function input(id: string): HTMLInputElement | null {
    return host().querySelector<HTMLInputElement>(`#${id}`);
  }

  function setValue(id: string, value: string): void {
    const field = input(id);
    if (!field) throw new Error(`campo ausente: ${id}`);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function check(id: string): void {
    const field = input(id);
    if (!field) throw new Error(`checkbox ausente: ${id}`);
    field.checked = true;
    field.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    isOnboardingCompleted.mockReturnValue(true);
    TestBed.resetTestingModule();
  });

  describe('alternancia criar conta / entrar', () => {
    it('sem query param abre em "Entrar" — e para ca que o guard manda sessao expirada', async () => {
      await render();

      expect(button('Entrar').getAttribute('aria-pressed')).toBe('true');
      expect(button('Criar conta').getAttribute('aria-pressed')).toBe('false');
      expect(input('auth-name')).toBeNull();
      expect(input('auth-terms')).toBeNull();
      expect(input('auth-email')).not.toBeNull();
      expect(input('auth-password')).not.toBeNull();
    });

    it('`?mode=signup` abre em "Criar conta" com nome e termos', async () => {
      await render({ mode: 'signup' });

      expect(button('Criar conta').getAttribute('aria-pressed')).toBe('true');
      expect(input('auth-name')).not.toBeNull();
      expect(input('auth-terms')).not.toBeNull();
    });

    it('clicar em "Criar conta" troca o form na mesma tela, sem navegar', async () => {
      await render();

      button('Criar conta').click();
      fixture.detectChanges();

      expect(input('auth-name')).not.toBeNull();
      expect(input('auth-terms')).not.toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('voltar para "Entrar" some com nome e termos e nao os deixa vetando o form', async () => {
      await render({ mode: 'signup' });

      button('Entrar').click();
      fixture.detectChanges();
      setValue('auth-email', 'ana@frota.com');
      setValue('auth-password', 'senha-forte-1');

      expect(input('auth-name')).toBeNull();
      expect(input('auth-terms')).toBeNull();

      login.mockReturnValue(of({}));
      button('Entrar').click();

      expect(login).toHaveBeenCalledWith('ana@frota.com', 'senha-forte-1');
    });
  });

  describe('promessa do trial (EPIC-GROWTH)', () => {
    /** Presenca nao basta: no rodape a promessa chega depois da decisao. */
    function assertPromiseComesBeforeTheForm(): void {
      const promise = host().querySelector('.auth-trial');
      const firstField = host().querySelector('input');
      expect(promise).not.toBeNull();
      expect(firstField).not.toBeNull();
      expect(
        promise!.compareDocumentPosition(firstField!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    it('diz 14 dias, gratis e sem cartao no modo entrar', async () => {
      await render();

      expect(text()).toContain('14 dias grátis');
      expect(text()).toContain('Sem cartão');
      assertPromiseComesBeforeTheForm();
    });

    it('diz 14 dias, gratis e sem cartao no modo criar conta', async () => {
      await render({ mode: 'signup' });

      expect(text()).toContain('14 dias grátis');
      expect(text()).toContain('Sem cartão');
      assertPromiseComesBeforeTheForm();
    });
  });

  describe('Google — nao pode regredir', () => {
    it('continua disponivel no modo entrar, dispara uma vez e mostra carregando', async () => {
      await render();
      const google = button('Continuar com o Google');

      google.click();
      fixture.detectChanges();
      google.click();

      expect(loginWithGoogle).toHaveBeenCalledTimes(1);
      expect(google.disabled).toBe(true);
      expect(google.textContent).toContain('Redirecionando');
    });

    it('continua disponivel no modo criar conta', async () => {
      await render({ mode: 'signup' });

      button('Criar conta com o Google').click();

      expect(loginWithGoogle).toHaveBeenCalledTimes(1);
    });
  });

  describe('entrar com e-mail', () => {
    it('manda email e senha e vai para o dashboard quando o onboarding terminou', async () => {
      await render();
      login.mockReturnValue(of({}));

      setValue('auth-email', 'ana@frota.com');
      setValue('auth-password', 'senha-forte-1');
      button('Entrar').click();

      expect(login).toHaveBeenCalledWith('ana@frota.com', 'senha-forte-1');
      expect(navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('vai para o onboarding quando ele ainda nao terminou', async () => {
      await render();
      isOnboardingCompleted.mockReturnValue(false);
      login.mockReturnValue(of({}));

      setValue('auth-email', 'ana@frota.com');
      setValue('auth-password', 'senha-forte-1');
      button('Entrar').click();

      expect(navigate).toHaveBeenCalledWith(['/onboarding']);
    });

    it('senha errada aparece na tela — o interceptor ignora 401 aqui de proposito', async () => {
      await render();
      login.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 401, error: {} })),
      );

      setValue('auth-email', 'ana@frota.com');
      setValue('auth-password', 'errada12');
      button('Entrar').click();
      fixture.detectChanges();

      expect(text()).toContain('E-mail ou senha incorretos.');
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('criar conta com e-mail', () => {
    async function fillSignup(): Promise<void> {
      await render({ mode: 'signup' });
      setValue('auth-name', 'Ana Frota');
      setValue('auth-email', 'ana@frota.com');
      setValue('auth-password', 'senha-forte-1');
      check('auth-terms');
    }

    it('nao envia sem os termos aceitos', async () => {
      await render({ mode: 'signup' });
      setValue('auth-name', 'Ana Frota');
      setValue('auth-email', 'ana@frota.com');
      setValue('auth-password', 'senha-forte-1');

      button('Criar conta grátis').click();

      expect(signup).not.toHaveBeenCalled();
    });

    it('envia nome, e-mail e senha', async () => {
      await fillSignup();
      signup.mockReturnValue(of(undefined));

      button('Criar conta grátis').click();

      expect(signup).toHaveBeenCalledWith('Ana Frota', 'ana@frota.com', 'senha-forte-1');
    });

    /**
     * A copy de sucesso antiga era "Conta criada. Faca login para continuar." numa OUTRA
     * rota. Agora a tela e a mesma: ela vira para entrar, guarda o e-mail e diz o que vem
     * a seguir — os 14 dias.
     */
    it('no sucesso vira para "Entrar", mantem o e-mail e fala do trial, sem navegar', async () => {
      await fillSignup();
      signup.mockReturnValue(of(undefined));

      button('Criar conta grátis').click();
      fixture.detectChanges();

      expect(button('Entrar').getAttribute('aria-pressed')).toBe('true');
      expect(input('auth-email')?.value).toBe('ana@frota.com');
      expect(input('auth-name')).toBeNull();
      expect(text()).toContain('Conta criada. Entre para começar seus 14 dias grátis.');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('e-mail duplicado (409) cai inline no campo de e-mail', async () => {
      await fillSignup();
      signup.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { fieldErrors: { email: 'E-mail já cadastrado.' } },
            }),
        ),
      );

      button('Criar conta grátis').click();
      fixture.detectChanges();

      expect(text()).toContain('E-mail já cadastrado.');
      expect(button('Criar conta').getAttribute('aria-pressed')).toBe('true');
    });
  });

  /** Herdado de FIX-0289: os dois documentos do consentimento tinham `href="#"`. */
  describe('links de consentimento (FIX-0289)', () => {
    function anchor(label: string): HTMLAnchorElement {
      const found = Array.from(host().querySelectorAll('a')).find(
        (a) => (a.textContent ?? '').trim().toLowerCase() === label.toLowerCase(),
      );
      if (!found) throw new Error(`ancora ausente: ${label}`);
      return found as HTMLAnchorElement;
    }

    it('leva aos documentos de verdade, em aba nova, nos dois modos', async () => {
      const cases: Record<string, string>[] = [{}, { mode: 'signup' }];
      for (const params of cases) {
        TestBed.resetTestingModule();
        await render(params);

        expect(anchor('Termos de Uso').getAttribute('href')).toBe('/termos-de-uso');
        expect(anchor('Política de Privacidade').getAttribute('href')).toBe(
          '/politica-de-privacidade',
        );
        for (const label of ['Termos de Uso', 'Política de Privacidade']) {
          expect(anchor(label).getAttribute('target')).toBe('_blank');
          expect(anchor(label).getAttribute('rel')).toContain('noopener');
        }
      }
    });

    it('nenhuma ancora da tela continua apontando para `#`', async () => {
      await render({ mode: 'signup' });

      const dead = host().querySelectorAll('a[href="#"]');
      expect(Array.from(dead, (a) => a.textContent?.trim())).toEqual([]);
    });
  });

  /**
   * A rota antiga nao pode morrer: link salvo e e-mail antigo apontam para `/signup`.
   * O redirect e medido no `routes` de verdade, sem subir a shell inteira.
   */
  describe('rota antiga /signup', () => {
    it('redireciona para a tela unica ja no modo criar conta', async () => {
      await render();
      const signupRoute = routes.find((route) => route.path === 'signup');
      expect(signupRoute).toBeDefined();
      expect(typeof signupRoute!.redirectTo).toBe('function');

      const target = TestBed.runInInjectionContext(() =>
        (signupRoute!.redirectTo as (...args: never[]) => unknown)(),
      );

      expect(TestBed.inject(Router).serializeUrl(target as never)).toBe('/login?mode=signup');
    });

    it('/login continua carregando a tela de autenticacao', async () => {
      await render();
      const loginRoute = routes.find((route) => route.path === 'login');

      expect(loginRoute?.loadComponent).toBeDefined();
      await expect(loginRoute!.loadComponent!()).resolves.toBe(Auth);
    });
  });
});
