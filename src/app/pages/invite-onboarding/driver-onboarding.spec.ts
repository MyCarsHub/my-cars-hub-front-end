import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inviteOnboardingGuard } from './invite-onboarding.guard';
import { ManagerOnboarding } from './manager-onboarding';
import { authInterceptor } from '../../services/auth.interceptor';
import { INVITE_ONBOARDING_TOKEN_KEY } from '../../services/invite-onboarding-token.store';
import { environment } from '../../../environments/environment';
import { InviteOnboardingContext } from '../../types/invite-flow.types';

const API = environment.apiUrl;
const byUrl = (url: string) => (r: { url: string }) => r.url === url;
const ONBOARDING_URL = `${API}/invite-onboarding`;
const DRIVER_URL = `${ONBOARDING_URL}/driver`;
const VIACEP = 'https://viacep.com.br/ws/01001000/json/';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

const context = (overrides: Partial<InviteOnboardingContext> = {}): InviteOnboardingContext => ({
  role: 'DRIVER',
  roleLabel: 'Motorista',
  companyName: 'Locadora Alfa',
  prefill: { name: 'João da Silva', phoneMasked: '(11) 9****-4321' },
  identityEditable: false,
  needsLicense: true,
  ...overrides,
});

describe('DriverOnboarding (/convite/cadastro, role DRIVER)', () => {
  let harness: RouterTestingHarness;
  let backend: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'convite/cadastro', canActivate: [inviteOnboardingGuard], component: ManagerOnboarding },
          { path: 'alugueis', children: [] },
          { path: 'login', children: [] },
        ]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => sessionStorage.clear());

  const dom = () => harness.fixture.nativeElement as HTMLElement;
  const text = () => dom().textContent?.replace(/\s+/g, ' ') ?? '';

  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  async function open(ctx: InviteOnboardingContext = context()): Promise<void> {
    sessionStorage.setItem(INVITE_ONBOARDING_TOKEN_KEY, 'onb-token');
    harness = await RouterTestingHarness.create();
    await router.navigateByUrl('/convite/cadastro');
    harness.detectChanges();
    backend.expectOne(byUrl(ONBOARDING_URL)).flush(ctx);
    await settle();
  }

  const heading = () =>
    Array.from(dom().querySelectorAll('h1')).find((h) => !h.closest('[hidden]'))?.textContent ?? '';

  function button(label: string): HTMLButtonElement {
    const found = Array.from(dom().querySelectorAll('button')).find((b) => b.textContent?.includes(label));
    if (!found) throw new Error(`button "${label}" not rendered; DOM: ${text()}`);
    return found as HTMLButtonElement;
  }

  async function click(label: string): Promise<void> {
    button(label).click();
    await settle();
  }

  const field = <T extends HTMLElement>(id: string) => dom().querySelector(`#${id}`) as T;

  async function type(id: string, value: string): Promise<void> {
    const el = field<HTMLInputElement | HTMLSelectElement>(id);
    el.value = value;
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await settle();
  }

  async function fillLicense(): Promise<void> {
    await type('drv-cnh', 'a1b2c3d4e5f');
    await type('drv-category', 'AB');
    await type('drv-expiry', '2099-12-31');
  }

  async function fillAddress(): Promise<void> {
    await type('drv-cep', '01001-000');
    await type('drv-street', 'Praça da Sé');
    await type('drv-number', '10');
    await type('drv-district', 'Sé');
    await type('drv-city', 'São Paulo');
    await type('drv-uf', 'SP');
  }

  async function toAddressStep(): Promise<void> {
    await click('Continuar');
    await fillLicense();
    await click('Continuar');
  }

  describe('steps', () => {
    it('shows 4 steps with the company chip, prefilled name, optional RG and the finish-later note', async () => {
      await open();
      expect(dom().querySelector('[data-testid="company-chip"]')?.textContent).toContain('Locadora Alfa · Motorista');
      expect(text()).toContain('Passo 1 de 4');
      expect(dom().querySelector('[role="progressbar"]')?.getAttribute('aria-valuemax')).toBe('4');
      expect(heading()).toContain('Seus dados');
      expect(field<HTMLInputElement>('drv-name').value).toBe('João da Silva');
      expect(field<HTMLInputElement>('drv-name').readOnly).toBe(true);
      expect(text()).toContain('RG (opcional)');
      expect(dom().querySelector('[data-testid="finish-later-note"]')?.textContent).toContain('Você pode terminar depois');
    });

    it('uses 16px fields and 48px targets, with the action bar sticky', async () => {
      await open();
      expect(field('drv-rg').className).toContain('text-base');
      expect(field('drv-rg').className).toContain('min-h-12');
      expect(button('Continuar').className).toContain('min-h-12');
      expect(dom().querySelector('footer')?.className).toContain('sticky');
    });

    it('does not leave the CNH step with an empty or malformed CNH', async () => {
      await open();
      await click('Continuar');
      await click('Continuar');
      expect(text()).toContain('Passo 2 de 4');
      expect(text()).toContain('Informe o número da CNH.');
      await type('drv-cnh', 'abc');
      await click('Continuar');
      expect(text()).toContain('A CNH deve ter 11 letras ou números.');
    });

    it('refuses an expired CNH expiry', async () => {
      await open();
      await click('Continuar');
      await fillLicense();
      await type('drv-expiry', '2001-01-01');
      await click('Continuar');
      expect(text()).toContain('Passo 2 de 4');
      expect(text()).toContain('Informe uma validade que não esteja vencida.');
    });

    it('does not submit an incomplete address', async () => {
      await open();
      await toAddressStep();
      await click('Concluir cadastro');
      backend.expectNone(byUrl(DRIVER_URL));
      expect(text()).toContain('Informe a rua.');
    });

    it('Voltar keeps what was typed', async () => {
      await open();
      await click('Continuar');
      await fillLicense();
      await click('Voltar');
      await click('Continuar');
      expect(field<HTMLInputElement>('drv-cnh').value).toBe('A1B2C3D4E5F');
    });
  });

  describe('CEP auto-fill (same CepService as the driver form)', () => {
    it('fills street, district, city and UF from the CEP on blur', async () => {
      await open();
      await toAddressStep();
      await type('drv-cep', '01001-000');
      field('drv-cep').dispatchEvent(new Event('blur'));
      backend.expectOne(VIACEP).flush({ logradouro: 'Praça da Sé', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP' });
      await settle();
      expect(field<HTMLInputElement>('drv-street').value).toBe('Praça da Sé');
      expect(field<HTMLInputElement>('drv-district').value).toBe('Sé');
      expect(field<HTMLInputElement>('drv-city').value).toBe('São Paulo');
      expect(field<HTMLSelectElement>('drv-uf').value).toBe('SP');
    });
  });

  describe('submit', () => {
    async function submitAll(rg = ''): Promise<void> {
      await open();
      if (rg) await type('drv-rg', rg);
      await toAddressStep();
      await fillAddress();
      await click('Concluir cadastro');
    }

    it('posts exactly the contract with the ONBOARDING token, stores the ACCESS token, clears the onboarding token and lands on /alugueis', async () => {
      sessionStorage.setItem('token', 'old-session');
      await submitAll('MG1234567');
      const req = backend.expectOne(byUrl(DRIVER_URL));
      expect(req.request.method).toBe('POST');
      expect(req.request.headers.get('Authorization')).toBe('Bearer onb-token');
      expect(req.request.body).toEqual({
        licenseNumber: 'A1B2C3D4E5F',
        licenseCategory: 'AB',
        licenseExpiry: '2099-12-31',
        address: {
          street: 'Praça da Sé',
          number: '10',
          complement: null,
          district: 'Sé',
          cep: '01001-000',
          city: 'São Paulo',
          uf: 'SP',
        },
        rg: 'MG1234567',
      });
      const access = jwt({ sub: 'u1', companyId: 'c1', role: 'DRIVER' });
      req.flush({ accessToken: access });
      await settle();

      expect(sessionStorage.getItem('token')).toBe(access);
      expect(sessionStorage.getItem(INVITE_ONBOARDING_TOKEN_KEY)).toBeNull();
      expect(heading()).toContain('Tudo pronto, João!');
      expect(text()).toContain('Passo 4 de 4');

      await click('Ver meus aluguéis');
      expect(router.url).toBe('/alugueis');
    });

    it('omits the RG when it was left empty', async () => {
      await submitAll();
      const req = backend.expectOne(byUrl(DRIVER_URL));
      expect('rg' in (req.request.body as object)).toBe(false);
      req.flush({ accessToken: jwt({ sub: 'u1' }) });
    });

    const cases: ReadonlyArray<[string, number, string, string]> = [
      ['ONBOARDING_LICENSE_INVALID', 400, 'A CNH deve ter 11 letras ou números.', 'Passo 2 de 4'],
      ['ONBOARDING_LICENSE_CATEGORY_INVALID', 400, 'Escolha a categoria da CNH.', 'Passo 2 de 4'],
      ['ONBOARDING_LICENSE_EXPIRY_INVALID', 400, 'Informe uma validade que não esteja vencida.', 'Passo 2 de 4'],
      ['ONBOARDING_ADDRESS_INVALID', 400, 'Confira o endereço: CEP, rua, bairro, cidade e UF.', 'Passo 3 de 4'],
      ['ONBOARDING_RG_INVALID', 400, 'Confira o RG (até 15 caracteres).', 'Passo 1 de 4'],
      ['DRIVER_LICENSE_TAKEN', 409, 'Esta CNH já está cadastrada em outro motorista desta empresa.', 'Passo 2 de 4'],
    ];

    it.each(cases)('maps %s to friendly copy on the step that owns the field', async (code, status, copy, step) => {
      await submitAll();
      backend.expectOne(byUrl(DRIVER_URL)).flush({ code, message: 'raw backend text' }, { status, statusText: 'x' });
      await settle();
      expect(text()).toContain(copy);
      expect(text()).toContain(step);
      expect(text()).not.toContain('raw backend text');
      expect(sessionStorage.getItem(INVITE_ONBOARDING_TOKEN_KEY)).toBe('onb-token');
    });

    it.each([
      ['ONBOARDING_ROLE_MISMATCH', 403, 'Este convite é para outro tipo de acesso', false],
      ['ONBOARDING_ALREADY_DONE', 409, 'Seu cadastro já foi concluído', false],
      ['ONBOARDING_TOKEN_REVOKED', 401, 'Este cadastro não pode mais ser concluído por aqui', true],
    ])('%s blocks the screen (token cleared only when revoked)', async (code, status, copy, clears) => {
      await submitAll();
      backend.expectOne(byUrl(DRIVER_URL)).flush({ code, message: 'x' }, { status, statusText: 'x' });
      await settle();
      expect(text()).toContain('Não foi possível continuar');
      expect(text()).toContain(copy);
      expect(sessionStorage.getItem(INVITE_ONBOARDING_TOKEN_KEY) === null).toBe(clears);
    });

    it('an unknown error keeps the data and shows the generic copy', async () => {
      await submitAll();
      backend.expectOne(byUrl(DRIVER_URL)).flush({ code: 'NEW_ONE', message: 'raw' }, { status: 500, statusText: 'x' });
      await settle();
      expect(text()).toContain('Não foi possível concluir agora');
      expect(text()).toContain('Passo 3 de 4');
    });
  });

  describe('needsLicense = false', () => {
    it('shows a short confirmation step only and posts an empty body', async () => {
      await open(context({ needsLicense: false }));
      expect(text()).toContain('Passo 1 de 2');
      expect(heading()).toContain('Confirme seu cadastro');
      expect(dom().querySelector('#drv-cnh')).toBeNull();

      await click('Confirmar e entrar');
      const req = backend.expectOne(byUrl(DRIVER_URL));
      expect(req.request.body).toEqual({});
      req.flush({ accessToken: jwt({ sub: 'u1' }) });
      await settle();
      expect(heading()).toContain('Tudo pronto');
      expect(sessionStorage.getItem(INVITE_ONBOARDING_TOKEN_KEY)).toBeNull();
    });

    it('opens the full steps when the backend still wants the CNH', async () => {
      await open(context({ needsLicense: false }));
      await click('Confirmar e entrar');
      backend
        .expectOne(byUrl(DRIVER_URL))
        .flush({ code: 'ONBOARDING_LICENSE_INVALID', message: 'x' }, { status: 400, statusText: 'x' });
      await settle();
      expect(text()).toContain('Passo 2 de 4');
      expect(text()).toContain('Precisamos confirmar sua CNH e seu endereço');
      expect(dom().querySelector('#drv-cnh')).not.toBeNull();
    });
  });
});
