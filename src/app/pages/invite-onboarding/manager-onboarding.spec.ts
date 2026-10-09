import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inviteOnboardingGuard } from './invite-onboarding.guard';
import { ManagerOnboarding } from './manager-onboarding';
import { authInterceptor } from '../../services/auth.interceptor';
import { INVITE_ONBOARDING_TOKEN_KEY } from '../../services/invite-onboarding-token.store';
import { environment } from '../../../environments/environment';
import { INVITE_TERMS_VERSION, InviteOnboardingContext } from '../../types/invite-flow.types';

const API = environment.apiUrl;

/** `ngsw-bypass=1` rides along on every API call, so match on the bare URL. */
const byUrl = (url: string) => (r: { url: string }) => r.url === url;
const ONBOARDING_URL = `${API}/invite-onboarding`;

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

const context = (overrides: Partial<InviteOnboardingContext> = {}): InviteOnboardingContext => ({
  role: 'MANAGER',
  roleLabel: 'Gerenciador',
  companyName: 'Locadora Alfa',
  prefill: { name: 'Patrícia Souza', phoneMasked: '(11) 98765-4321' },
  identityEditable: true,
  ...overrides,
});

describe('ManagerOnboarding (/convite/cadastro)', () => {
  let harness: RouterTestingHarness;
  let backend: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'convite/cadastro',
            canActivate: [inviteOnboardingGuard],
            component: ManagerOnboarding,
          },
          { path: 'dashboard', children: [] },
          { path: 'login', children: [] },
        ]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  const dom = () => harness.fixture.nativeElement as HTMLElement;
  const text = () => dom().textContent?.replace(/\s+/g, ' ') ?? '';

  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  function contextRequest(): TestRequest {
    return backend.expectOne(byUrl(ONBOARDING_URL));
  }

  /** Opens the page with an onboarding token (and optionally a normal session) in storage. */
  async function open(ctx: InviteOnboardingContext = context()): Promise<void> {
    sessionStorage.setItem(INVITE_ONBOARDING_TOKEN_KEY, 'onb-token');
    harness = await RouterTestingHarness.create();
    await router.navigateByUrl('/convite/cadastro');
    harness.detectChanges();
    contextRequest().flush(ctx);
    await settle();
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(dom().querySelectorAll('button')).find((b) => b.textContent?.includes(label));
    if (!found) throw new Error(`button "${label}" not rendered; DOM: ${text()}`);
    return found as HTMLButtonElement;
  }

  async function click(label: string): Promise<void> {
    button(label).click();
    await settle();
  }

  /** The visible h1 (steps 1 and 2 both live in the DOM; the inactive one is `hidden`). */
  const heading = () =>
    Array.from(dom().querySelectorAll('h1')).find((h) => !h.closest('[hidden]'))?.textContent ?? '';

  const input = (id: string) => dom().querySelector(`input#${id}`) as HTMLInputElement;

  async function toTermsStep(): Promise<void> {
    await click('Continuar');
  }

  function checkTerms(): void {
    const box = input('onb-terms');
    box.click();
    harness.detectChanges();
  }

  describe('guard', () => {
    it('sends a visitor without an onboarding token to the login', async () => {
      harness = await RouterTestingHarness.create();
      await router.navigateByUrl('/convite/cadastro');
      expect(router.url).toBe('/login');
      backend.expectNone(byUrl(ONBOARDING_URL));
    });

    it('a NORMAL session token is not an onboarding token: still sent away', async () => {
      sessionStorage.setItem('token', 'a-normal-session');
      harness = await RouterTestingHarness.create();
      await router.navigateByUrl('/convite/cadastro');
      expect(router.url).toBe('/login');
    });
  });

  describe('step 1 - Seus dados', () => {
    it('loads the context with the ONBOARDING token and shows the company chip, progress and prefill', async () => {
      sessionStorage.setItem('token', 'normal-session');
      sessionStorage.setItem(INVITE_ONBOARDING_TOKEN_KEY, 'onb-token');
      harness = await RouterTestingHarness.create();
      await router.navigateByUrl('/convite/cadastro');
      harness.detectChanges();
      const req = contextRequest();
      expect(req.request.headers.get('Authorization')).toBe('Bearer onb-token');
      req.flush(context());
      await settle();

      expect(dom().querySelector('[data-testid="company-chip"]')?.textContent).toContain('Locadora Alfa · Gerenciador');
      expect(text()).toContain('Passo 1 de 3');
      expect(heading()).toContain('Seus dados');
      expect(input('onb-name').value).toBe('Patrícia Souza');
      expect(input('onb-phone').value).toBe('(11) 98765-4321');
      expect(input('onb-name').disabled).toBe(false);
      expect(dom().querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1');
    });

    it('uses 16px fields with 48px targets', async () => {
      await open();
      expect(input('onb-name').className).toContain('text-base');
      expect(input('onb-name').className).toContain('min-h-12');
      expect(button('Continuar').className).toContain('min-h-12');
    });

    it('is read-only, with a note, when the identity is not editable', async () => {
      await open(context({ identityEditable: false }));

      expect(input('onb-name').disabled).toBe(true);
      expect(input('onb-phone').disabled).toBe(true);
      expect(text()).toContain('não podem ser alterados aqui');
      await toTermsStep();
      expect(text()).toContain('Passo 2 de 3');
    });

    it('leaves the phone empty for editing when the backend only gave a masked number', async () => {
      await open(context({ prefill: { name: 'Patrícia Souza', phoneMasked: '(11) 9****-4321' } }));
      expect(input('onb-phone').value).toBe('');
    });

    it('does not advance with an empty name or an invalid phone', async () => {
      await open();
      input('onb-name').value = '';
      input('onb-name').dispatchEvent(new Event('input', { bubbles: true }));
      input('onb-phone').value = '123';
      input('onb-phone').dispatchEvent(new Event('input', { bubbles: true }));
      await click('Continuar');

      expect(text()).toContain('Passo 1 de 3');
      expect(text()).toContain('Informe seu nome completo.');
      expect(text()).toContain('Confira o telefone com o DDD');
    });
  });

  describe('step 2 - Termos e privacidade', () => {
    beforeEach(async () => {
      await open();
      await toTermsStep();
    });

    it('shows the summary and links to the existing Termos and Privacidade pages', () => {
      expect(text()).toContain('Passo 2 de 3');
      expect(heading()).toContain('Termos e privacidade');
      expect(text()).toContain('Seu CPF serve para confirmar quem você é.');
      expect(dom().querySelector('a[href="/termos-de-uso"]')).not.toBeNull();
      expect(dom().querySelector('a[href="/politica-de-privacidade"]')).not.toBeNull();
    });

    it('requires the checkbox: nothing is sent while it is unchecked', async () => {
      await click('Aceitar e continuar');

      backend.expectNone(byUrl(`${ONBOARDING_URL}/manager`));
      expect(text()).toContain('Marque a caixa para aceitar e continuar.');
      expect(input('onb-terms').getAttribute('aria-invalid')).toBe('true');
    });

    it('Voltar returns to step 1 keeping what was typed', async () => {
      await click('Voltar');
      expect(text()).toContain('Passo 1 de 3');
      expect(input('onb-name').value).toBe('Patrícia Souza');
    });
  });

  describe('submit and step 3 - Tudo pronto', () => {
    async function submit(): Promise<TestRequest> {
      await toTermsStep();
      checkTerms();
      button('Aceitar e continuar').click();
      return backend.expectOne(byUrl(`${ONBOARDING_URL}/manager`));
    }

    it('sends name, digits-only phone and the terms version with the ONBOARDING token', async () => {
      sessionStorage.setItem('token', 'normal-session');
      await open();
      const req = await submit();

      expect(req.request.body).toEqual({
        name: 'Patrícia Souza',
        phone: '11987654321',
        acceptedTermsVersion: INVITE_TERMS_VERSION,
      });
      expect(req.request.headers.get('Authorization')).toBe('Bearer onb-token');
      req.flush({}, { status: 500, statusText: 'x' });
    });

    it('stores the ACCESS token through the normal login path, clears the onboarding token and shows the finish step', async () => {
      const accessToken = jwt({ companyId: 'co-9', role: 'MANAGER', exp: 4_000_000_000 });
      await open();
      const req = await submit();
      req.flush({ accessToken });
      await settle();

      expect(sessionStorage.getItem('token')).toBe(accessToken);
      expect(sessionStorage.getItem(INVITE_ONBOARDING_TOKEN_KEY)).toBeNull();
      expect(sessionStorage.getItem('selectedCompanyId')).toBe('co-9');
      expect(sessionStorage.getItem('selectedRole')).toBe('MANAGER');
      expect(sessionStorage.getItem('onboardingCompleted')).toBe('true');

      expect(text()).toContain('Passo 3 de 3');
      expect(heading()).toContain('Tudo pronto, Patrícia!');
      expect(text()).toContain('Você já faz parte de Locadora Alfa como Gerenciador.');
    });

    it('"Ir para o painel" lands where an OWNER/MANAGER lands (/dashboard)', async () => {
      await open();
      const req = await submit();
      req.flush({ accessToken: jwt({ companyId: 'co-9', exp: 4_000_000_000 }) });
      await settle();

      await click('Ir para o painel');
      await settle();
      expect(router.url).toBe('/dashboard');
    });

    it('replaces a session the tab already held (it belonged to somebody else)', async () => {
      sessionStorage.setItem('token', 'old');
      sessionStorage.setItem('email', 'someone@else.com');
      const accessToken = jwt({ companyId: 'co-9', exp: 4_000_000_000 });
      await open();
      const req = await submit();
      req.flush({ accessToken });
      await settle();

      expect(sessionStorage.getItem('token')).toBe(accessToken);
      expect(sessionStorage.getItem('email')).toBeNull();
    });
  });

  describe('error-code mapping', () => {
    async function failWith(code: string, status: number): Promise<void> {
      await open();
      await toTermsStep();
      checkTerms();
      button('Aceitar e continuar').click();
      backend
        .expectOne(byUrl(`${ONBOARDING_URL}/manager`))
        .flush({ code, message: 'raw backend text' }, { status, statusText: 'x' });
      await settle();
    }

    it('ONBOARDING_PHONE_INVALID returns to step 1 with the field error', async () => {
      await failWith('ONBOARDING_PHONE_INVALID', 400);
      expect(text()).toContain('Passo 1 de 3');
      expect(text()).toContain('Confira o telefone com o DDD');
    });

    it('ONBOARDING_NAME_INVALID returns to step 1 with the field error', async () => {
      await failWith('ONBOARDING_NAME_INVALID', 400);
      expect(text()).toContain('Passo 1 de 3');
      expect(text()).toContain('Confira seu nome completo.');
    });

    it('TERMS_VERSION_MISMATCH stays on step 2 with a banner', async () => {
      await failWith('TERMS_VERSION_MISMATCH', 400);
      expect(text()).toContain('Passo 2 de 3');
      expect(text()).toContain('Os termos foram atualizados');
    });

    it('ONBOARDING_TOKEN_REVOKED ends the flow and clears the dead token', async () => {
      await failWith('ONBOARDING_TOKEN_REVOKED', 401);
      expect(text()).toContain('Este cadastro não pode mais ser concluído por aqui');
      expect(sessionStorage.getItem(INVITE_ONBOARDING_TOKEN_KEY)).toBeNull();
      expect(dom().querySelector('a[href="/login"]')).not.toBeNull();
    });

    it('a 401 here does not wipe a normal session (the screen owns the error)', async () => {
      sessionStorage.setItem('token', 'normal-session');
      await failWith('ONBOARDING_TOKEN_REVOKED', 401);
      expect(sessionStorage.getItem('token')).toBe('normal-session');
    });

    it('ONBOARDING_ALREADY_DONE says the signup is already finished', async () => {
      await failWith('ONBOARDING_ALREADY_DONE', 409);
      expect(text()).toContain('Seu cadastro já foi concluído');
    });

    it('ONBOARDING_ROLE_MISMATCH shows the driver placeholder', async () => {
      await failWith('ONBOARDING_ROLE_MISMATCH', 403);
      expect(heading()).toContain('Cadastro do motorista em breve');
    });

    it('never shows the raw backend message', async () => {
      await failWith('SOMETHING_NEW', 500);
      expect(text()).not.toContain('raw backend text');
      expect(text()).toContain('Não foi possível concluir agora');
    });
  });

  describe('other roles and load failures', () => {
    it('a DRIVER context shows the "em breve" placeholder, not the manager wizard', async () => {
      await open(context({ role: 'DRIVER', roleLabel: 'Motorista' }));
      expect(heading()).toContain('Cadastro do motorista em breve');
      expect(dom().querySelector('[role="progressbar"]')).toBeNull();
    });

    it('a revoked token on load shows the blocked screen', async () => {
      sessionStorage.setItem(INVITE_ONBOARDING_TOKEN_KEY, 'onb-token');
      harness = await RouterTestingHarness.create();
      await router.navigateByUrl('/convite/cadastro');
      harness.detectChanges();
      contextRequest().flush(
        { code: 'ONBOARDING_TOKEN_REVOKED', message: 'x' },
        { status: 401, statusText: 'Unauthorized' },
      );
      await settle();

      expect(text()).toContain('Não foi possível continuar');
      expect(sessionStorage.getItem(INVITE_ONBOARDING_TOKEN_KEY)).toBeNull();
    });
  });
});
