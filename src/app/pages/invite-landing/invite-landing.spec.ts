import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteLanding } from './invite-landing';
import { inviteOnboardingGuard } from '../invite-onboarding/invite-onboarding.guard';
import { INVITE_RESUME_STATE_KEY, PENDING_INVITE_TOKEN_KEY } from '../invites/invite-session';
import { authInterceptor } from '../../services/auth.interceptor';
import { INVITE_ONBOARDING_TOKEN_KEY } from '../../services/invite-onboarding-token.store';
import { LoginService } from '../../services/loginService';
import { environment } from '../../../environments/environment';
import { InviteValidateResponse } from '../../types/invite-flow.types';

const API = environment.apiUrl;

/** `ngsw-bypass=1` rides along on every API call, so match on the bare URL. */
const byUrl = (url: string) => (r: { url: string }) => r.url === url;
const VALID_CPF = '529.982.247-25';
const VALID_CPF_DIGITS = '52998224725';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

const pending = (overrides: Partial<InviteValidateResponse> = {}): InviteValidateResponse => ({
  state: 'PENDING',
  companyName: 'Locadora Alfa',
  roleLabel: 'Gerenciador',
  inviteeFirstName: 'Patrícia',
  accountKind: 'NEW',
  ...overrides,
});

/**
 * Real router, real interceptor, real session storage and the real component tree: only the
 * network (HttpTestingController) and the Google redirect (`window.location`) are faked.
 */
describe('InviteLanding (/convite)', () => {
  let harness: RouterTestingHarness;
  let backend: HttpTestingController;
  let router: Router;
  let loginWithGoogle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    loginWithGoogle = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'invite/accept', redirectTo: 'convite', pathMatch: 'full' },
          { path: 'convite', component: InviteLanding },
          { path: 'convite/cadastro', canActivate: [inviteOnboardingGuard], children: [] },
          { path: 'dashboard', children: [] },
          { path: 'login', children: [] },
          { path: '', children: [] },
        ]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: LoginService, useValue: { loginWithGoogle } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  async function open(url: string, state?: Record<string, unknown>): Promise<void> {
    harness = await RouterTestingHarness.create();
    await router.navigateByUrl(url, state ? { state } : undefined);
    harness.detectChanges();
  }

  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  const dom = () => harness.fixture.nativeElement as HTMLElement;
  const text = () => dom().textContent?.replace(/\s+/g, ' ') ?? '';

  function validateRequest(): TestRequest {
    return backend.expectOne(byUrl(`${API}/invites/validate`));
  }

  async function openWithValidate(
    response: InviteValidateResponse,
    url = '/convite?token=tok-123',
    state?: Record<string, unknown>,
  ): Promise<void> {
    await open(url, state);
    validateRequest().flush(response);
    await settle();
  }

  function typeCpf(value: string): HTMLInputElement {
    const input = dom().querySelector('input#invite-cpf') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    harness.detectChanges();
    return input;
  }

  function submitForm(): void {
    (dom().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    harness.detectChanges();
  }

  function acceptRequest(): TestRequest {
    return backend.expectOne(byUrl(`${API}/invites/accept`));
  }

  describe('token handling', () => {
    it('validates with the token from the query and removes it from the address bar at once', async () => {
      await openWithValidate(pending());
      await settle();

      expect(router.url).toBe('/convite');
      expect(TestBed.inject(Location).path(true)).toBe('/convite');
      expect(sessionStorage.getItem(PENDING_INVITE_TOKEN_KEY)).toBe('tok-123');
    });

    it('POSTs the token in the body (never in the URL) to /invites/validate', async () => {
      await open('/convite?token=tok-123');
      const req = validateRequest();
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ token: 'tok-123' });
      expect(req.request.url).not.toContain('tok-123');
      req.flush(pending());
    });

    it('reads the token from a #token= fragment too, and removes the fragment', async () => {
      await open('/convite#token=frag-456');
      const req = validateRequest();
      expect(req.request.body).toEqual({ token: 'frag-456' });
      req.flush(pending());
      await settle();

      expect(router.url).toBe('/convite');
      expect(TestBed.inject(Location).path(true)).toBe('/convite');
    });

    it('keeps the old e-mail link /invite/accept?token= working through the new page', async () => {
      await open('/invite/accept?token=old-link');
      const req = validateRequest();
      expect(req.request.body).toEqual({ token: 'old-link' });
      req.flush(pending());
      await settle();

      expect(router.url).toBe('/convite');
      expect(text()).toContain('Você foi convidado para');
    });

    it('shows its own screen when the link carries no token and nothing was stashed', async () => {
      await open('/convite');
      backend.expectNone(byUrl(`${API}/invites/validate`));
      expect(text()).toContain('Link de convite incompleto');
    });

    it('falls back to the stashed token (the Google round trip returns without one in the URL)', async () => {
      sessionStorage.setItem(PENDING_INVITE_TOKEN_KEY, 'stashed');
      await open('/convite');
      expect(validateRequest().request.body).toEqual({ token: 'stashed' });
    });
  });

  describe('validate states', () => {
    it('PENDING + NEW renders company, role, CPF field, primary action and the LGPD line', async () => {
      await openWithValidate(pending());

      expect(text()).toContain('Você foi convidado para Locadora Alfa');
      expect(text()).toContain('Gerenciador');
      expect(text()).toContain('Confirme seu CPF');
      expect(text()).toContain('Usamos o CPF para garantir que o convite é seu.');
      expect(text()).toContain('Aceitar convite');
      expect(text()).toContain('Ao aceitar, você concorda com os Termos de uso');
      expect(dom().querySelector('a[href="/termos-de-uso"]')).not.toBeNull();
      expect(dom().querySelector('a[href="/politica-de-privacidade"]')).not.toBeNull();
    });

    it('shows "Convidado por" only when the backend provides it', async () => {
      await openWithValidate(pending());
      expect(text()).not.toContain('Convidado por');
    });

    it('shows "Convidado por" when it is available', async () => {
      await openWithValidate(pending({ inviterName: 'Carla Mendes' }));
      expect(text()).toMatch(/Convidado por\s*Carla Mendes/);
    });

    it('uses a 16px CPF input with a 48px target (mobile first)', async () => {
      await openWithValidate(pending());
      const input = dom().querySelector('input#invite-cpf') as HTMLInputElement;
      expect(input.className).toContain('text-base');
      expect(input.className).toContain('min-h-12');
      expect(input.getAttribute('inputmode')).toBe('numeric');
    });

    const terminal: ReadonlyArray<[InviteValidateResponse['state'], string]> = [
      ['EXPIRED', 'Este convite expirou'],
      ['REVOKED', 'Este convite foi cancelado'],
      ['USED', 'Este convite já foi usado'],
    ];

    it.each(terminal)('%s renders its own screen and no CPF form', async (state, heading) => {
      await openWithValidate({ ...pending(), state, accountKind: undefined });
      expect(dom().querySelector('h1')?.textContent).toContain(heading);
      expect(dom().querySelector('input#invite-cpf')).toBeNull();
    });

    it('USED offers the way back in (login)', async () => {
      await openWithValidate({ ...pending(), state: 'USED', accountKind: undefined });
      expect(dom().querySelector('a[href="/login"]')?.textContent).toContain('Entrar no MyCarsHub');
    });

    it('an unknown token (404 INVITE_NOT_FOUND) renders the not-found screen', async () => {
      await open('/convite?token=nope');
      validateRequest().flush(
        { code: 'INVITE_NOT_FOUND', message: 'x' },
        { status: 404, statusText: 'Not Found' },
      );
      await settle();
      expect(dom().querySelector('h1')?.textContent).toContain('Convite não encontrado');
    });

    it('a dead connection offers a retry that validates again', async () => {
      await open('/convite?token=tok-123');
      validateRequest().error(new ProgressEvent('error'));
      await settle();
      expect(text()).toContain('Não deu para verificar o convite');

      (Array.from(dom().querySelectorAll('button')).find((b) => b.textContent?.includes('Tentar de novo')) as HTMLButtonElement).click();
      validateRequest().flush(pending());
      await settle();
      expect(text()).toContain('Você foi convidado para');
    });
  });

  describe('CPF field', () => {
    beforeEach(async () => {
      await openWithValidate(pending());
    });

    it('masks the CPF as it is typed', () => {
      const input = typeCpf('52998224725');
      expect(input.value).toBe(VALID_CPF);
    });

    it('does not call the backend with a short CPF and says what is missing', () => {
      typeCpf('529.982');
      submitForm();
      backend.expectNone(byUrl(`${API}/invites/accept`));
      expect(text()).toContain('Faltou algum número do CPF');
    });

    it('does not call the backend with a CPF whose check digits are wrong', () => {
      typeCpf('111.111.111-11');
      submitForm();
      backend.expectNone(byUrl(`${API}/invites/accept`));
      expect(text()).toContain('Esse CPF não confere');
    });

    it('does not call the backend with an empty field', () => {
      submitForm();
      backend.expectNone(byUrl(`${API}/invites/accept`));
      expect(text()).toContain('Informe seu CPF.');
    });

    it('POSTs token and unmasked CPF, with no Authorization header', () => {
      sessionStorage.setItem('token', 'some-normal-session');
      typeCpf(VALID_CPF);
      submitForm();
      const req = acceptRequest();
      expect(req.request.body).toEqual({ token: 'tok-123', cpf: VALID_CPF_DIGITS });
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({}, { status: 500, statusText: 'x' });
    });

    it.each([
      [3, 'Este CPF não confere com o convite. Restam 3 tentativas.'],
      [1, 'Este CPF não confere com o convite. Resta 1 tentativa.'],
    ])('a wrong CPF with attemptsLeft=%i shows "%s" and keeps the form', async (attemptsLeft, expected) => {
      typeCpf(VALID_CPF);
      submitForm();
      acceptRequest().flush(
        { code: 'INVITE_CPF_MISMATCH', message: 'x', attemptsLeft },
        { status: 400, statusText: 'Bad Request' },
      );
      await settle();

      expect(text()).toContain(expected);
      expect(dom().querySelector('input#invite-cpf')).not.toBeNull();
    });

    it('attemptsLeft=0 locks the form', async () => {
      typeCpf(VALID_CPF);
      submitForm();
      acceptRequest().flush(
        { code: 'INVITE_CPF_MISMATCH', message: 'x', attemptsLeft: 0 },
        { status: 400, statusText: 'Bad Request' },
      );
      await settle();
      expect(text()).toContain('Muitas tentativas. Tente de novo em 30 minutos.');
    });

    it('423 INVITE_LOCKED shows the locked state: warning, disabled action, no more requests', async () => {
      typeCpf(VALID_CPF);
      submitForm();
      acceptRequest().flush(
        { code: 'INVITE_LOCKED', message: 'x' },
        { status: 423, statusText: 'Locked' },
      );
      await settle();

      expect(text()).toContain('Muitas tentativas. Tente de novo em 30 minutos.');
      const button = dom().querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.textContent).toContain('Tente de novo em 30 minutos');

      submitForm();
      backend.expectNone(byUrl(`${API}/invites/accept`));
    });

    it('409 INVITE_REQUIRES_SIGN_IN switches to the existing-account screen', async () => {
      typeCpf(VALID_CPF);
      submitForm();
      acceptRequest().flush(
        { code: 'INVITE_REQUIRES_SIGN_IN', message: 'x' },
        { status: 409, statusText: 'Conflict' },
      );
      await settle();

      expect(dom().querySelector('h1')?.textContent).toContain('Você já tem conta. Entre para adicionar a Locadora Alfa');
      expect(text()).toContain('Entrar com Google');
      expect(dom().querySelector('input#invite-cpf')).toBeNull();
    });

    const switchScreen: ReadonlyArray<[string, number, string]> = [
      ['INVITE_EXPIRED', 410, 'Este convite expirou'],
      ['INVITE_REVOKED', 410, 'Este convite foi cancelado'],
      ['INVITE_ALREADY_USED', 409, 'Este convite já foi usado'],
      ['INVITE_NOT_FOUND', 404, 'Convite não encontrado'],
    ];

    it.each(switchScreen)('%s on accept replaces the form with the matching screen', async (code, status, heading) => {
      typeCpf(VALID_CPF);
      submitForm();
      acceptRequest().flush({ code, message: 'x' }, { status, statusText: 'x' });
      await settle();
      expect(dom().querySelector('h1')?.textContent).toContain(heading);
    });

    const problems: ReadonlyArray<[string, number, string]> = [
      ['INVITE_ACCOUNT_DISABLED', 403, 'Esta conta está desativada'],
      ['INVITE_CPF_NOT_ON_FILE', 409, 'Não encontramos um CPF cadastrado para este convite'],
      ['INVITE_IDENTITY_CONFLICT', 409, 'entram em conflito com outro cadastro'],
      ['INVITE_ALREADY_MEMBER', 409, 'Você já faz parte de Locadora Alfa'],
      ['INVITE_DRIVER_NOT_REGISTERED', 409, 'ainda não tem cadastro de motorista em Locadora Alfa'],
    ];

    it.each(problems)('%s shows its own friendly copy', async (code, status, expected) => {
      typeCpf(VALID_CPF);
      submitForm();
      acceptRequest().flush({ code, message: 'raw backend text' }, { status, statusText: 'x' });
      await settle();
      expect(text()).toContain(expected);
      expect(text()).not.toContain('raw backend text');
    });
  });

  describe('accepting a NEW-account invite', () => {
    async function acceptWith(next: 'MANAGER_ONBOARDING' | 'DRIVER_ONBOARDING'): Promise<void> {
      sessionStorage.setItem('token', 'normal-session-of-someone-else');
      await openWithValidate(pending());
      typeCpf(VALID_CPF);
      submitForm();
      acceptRequest().flush({
        onboardingToken: 'onb-token',
        role: next === 'MANAGER_ONBOARDING' ? 'MANAGER' : 'DRIVER',
        roleLabel: 'Gerenciador',
        companyName: 'Locadora Alfa',
        next,
      });
      await settle();
    }

    it('stores the onboarding token in its OWN slot and leaves the normal session untouched', async () => {
      await acceptWith('MANAGER_ONBOARDING');

      expect(sessionStorage.getItem(INVITE_ONBOARDING_TOKEN_KEY)).toBe('onb-token');
      expect(sessionStorage.getItem('token')).toBe('normal-session-of-someone-else');
      expect(sessionStorage.getItem('selectedCompanyId')).toBeNull();
    });

    it('navigates to the manager onboarding and drops the stashed invite token', async () => {
      await acceptWith('MANAGER_ONBOARDING');

      expect(router.url).toBe('/convite/cadastro');
      expect(sessionStorage.getItem(PENDING_INVITE_TOKEN_KEY)).toBeNull();
    });

    it('DRIVER_ONBOARDING shows the "em breve" placeholder instead of navigating', async () => {
      await acceptWith('DRIVER_ONBOARDING');

      expect(router.url).toBe('/convite');
      expect(dom().querySelector('h1')?.textContent).toContain('Cadastro do motorista em breve');
    });
  });

  describe('existing account', () => {
    it('PENDING + EXISTING renders the Google screen, and the button hands the tab to Google with the token stashed', async () => {
      await openWithValidate(pending({ accountKind: 'EXISTING' }));

      expect(dom().querySelector('h1')?.textContent).toContain('Você já tem conta. Entre para adicionar a Locadora Alfa');
      const google = Array.from(dom().querySelectorAll('button')).find((b) => b.textContent?.includes('Entrar com Google')) as HTMLButtonElement;
      expect(google.querySelector('img')).not.toBeNull();

      sessionStorage.removeItem(PENDING_INVITE_TOKEN_KEY);
      google.click();
      expect(sessionStorage.getItem(PENDING_INVITE_TOKEN_KEY)).toBe('tok-123');
      expect(loginWithGoogle).toHaveBeenCalledTimes(1);
    });

    it('after the Google login the page calls accept-as-member with the stored token and the Google session, then switches into the company', async () => {
      const googleSession = jwt({ sub: 'u1', exp: 4_000_000_000 });
      const companyToken = jwt({ companyId: 'co-9', role: 'MANAGER', exp: 4_000_000_000 });
      sessionStorage.setItem('token', googleSession);
      sessionStorage.setItem(PENDING_INVITE_TOKEN_KEY, 'tok-123');

      await open('/convite', { [INVITE_RESUME_STATE_KEY]: true });
      validateRequest().flush(pending({ accountKind: 'EXISTING' }));
      await settle();

      const req = backend.expectOne(byUrl(`${API}/invites/accept-as-member`));
      expect(req.request.body).toEqual({ token: 'tok-123' });
      expect(req.request.headers.get('Authorization')).toBe(`Bearer ${googleSession}`);
      req.flush({
        accessToken: companyToken,
        role: 'MANAGER',
        roleLabel: 'Gerenciador',
        companyName: 'Locadora Alfa',
        next: 'COMPANY_HOME',
      });
      await settle();

      expect(sessionStorage.getItem('token')).toBe(companyToken);
      expect(sessionStorage.getItem('selectedCompanyId')).toBe('co-9');
      expect(sessionStorage.getItem('selectedCompanyName')).toBe('Locadora Alfa');
      expect(sessionStorage.getItem('selectedRole')).toBe('MANAGER');
      expect(sessionStorage.getItem('onboardingCompleted')).toBe('true');
      expect(sessionStorage.getItem(PENDING_INVITE_TOKEN_KEY)).toBeNull();
      expect(router.url).toBe('/dashboard');
    });

    it('without the resume flag a logged-in tab does NOT auto-accept (someone may just be browsing)', async () => {
      sessionStorage.setItem('token', jwt({ sub: 'u1', exp: 4_000_000_000 }));
      await openWithValidate(pending({ accountKind: 'EXISTING' }));

      backend.expectNone(byUrl(`${API}/invites/accept-as-member`));
      expect(text()).toContain('Entrar com Google');
    });

    it('INVITE_EMAIL_MISMATCH offers to switch the Google account', async () => {
      sessionStorage.setItem('token', jwt({ sub: 'u1', exp: 4_000_000_000 }));
      sessionStorage.setItem(PENDING_INVITE_TOKEN_KEY, 'tok-123');
      await open('/convite', { [INVITE_RESUME_STATE_KEY]: true });
      validateRequest().flush(pending({ accountKind: 'EXISTING' }));
      await settle();

      backend.expectOne(byUrl(`${API}/invites/accept-as-member`)).flush(
        { code: 'INVITE_EMAIL_MISMATCH', message: 'x' },
        { status: 403, statusText: 'Forbidden' },
      );
      await settle();

      expect(text()).toContain('Este convite foi enviado para outro e-mail');
      expect(text()).toContain('Entrar com outra conta Google');
      // The Google session was NOT replaced by a failed attempt.
      expect(sessionStorage.getItem('token')).not.toBeNull();
    });
  });
});
