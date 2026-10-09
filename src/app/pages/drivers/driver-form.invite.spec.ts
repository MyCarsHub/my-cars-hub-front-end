import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DriverForm } from './driver-form';
import { NotificationService } from '../../services/notification.service';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;
const byUrl = (url: string) => (r: { url: string }) => r.url === url;
const DRIVERS = `${API}/drivers`;
const VALID_CPF = '52998224725';

const driverResponse = (extra: Record<string, unknown> = {}) => ({
  id: 'drv-1',
  contact: { email: 'joao@example.com', phone: '11987654321' },
  registrationStatus: 'PENDING_ONBOARDING',
  ...extra,
});

describe('DriverForm - register and invite', () => {
  let harness: RouterTestingHarness;
  let backend: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'motoristas/novo', component: DriverForm },
          { path: 'motoristas/:id/editar', component: DriverForm },
          { path: 'motoristas/:id', children: [] },
          { path: 'motoristas', children: [] },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create();
    await router.navigateByUrl('/motoristas/novo');
    harness.detectChanges();
  });

  afterEach(() => sessionStorage.clear());

  const dom = () => harness.fixture.nativeElement as HTMLElement;
  const text = () => dom().textContent?.replace(/\s+/g, ' ') ?? '';
  const toasts = () => TestBed.inject(NotificationService).notifications();

  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  /** Input of an `app-primary-input` found by its label text. */
  function labelled(label: string): HTMLInputElement {
    const host = Array.from(dom().querySelectorAll('app-primary-input')).find((el) =>
      el.querySelector('label')?.textContent?.trim().startsWith(label),
    );
    if (!host) throw new Error(`no field labelled ${label}`);
    return host.querySelector('input') as HTMLInputElement;
  }

  async function type(el: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
    el.value = value;
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await settle();
  }
  const byId = <T extends HTMLElement>(id: string) => dom().querySelector(`#${id}`) as T;

  async function fillMinimum(email = 'joao@example.com'): Promise<void> {
    await type(labelled('Nome completo'), 'João da Silva');
    if (email) await type(labelled('E-mail'), email);
    await type(byId('motorista-phone'), '11987654321');
    await type(byId('motorista-doc-valor'), VALID_CPF);
  }

  async function fillAddress(): Promise<void> {
    await type(byId('motorista-cep'), '01001-000');
    await type(labelled('Rua'), 'Praça da Sé');
    await type(labelled('Bairro'), 'Sé');
    await type(labelled('Cidade'), 'São Paulo');
    await type(byId('motorista-uf'), 'SP');
  }

  async function fillLicense(): Promise<void> {
    await type(byId('motorista-cnh'), 'A1B2C3D4E5F');
    await type(byId('motorista-categoria'), 'B');
    await type(byId('motorista-vencimento'), '2099-12-31');
  }

  async function submit(): Promise<void> {
    (dom().querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await settle();
  }

  function postBody(): Record<string, unknown> {
    return backend.expectOne((r) => r.method === 'POST' && r.url === DRIVERS).request.body as Record<string, unknown>;
  }

  describe('form', () => {
    it('explains the invite: info banner and the e-mail helper', () => {
      expect(dom().querySelector('[data-testid="invite-info"]')?.textContent).toContain(
        'O motorista receberá um convite por e-mail e completa a CNH e o endereço no primeiro acesso. Você também pode preencher agora.',
      );
      expect(text()).toContain('O convite de acesso será enviado para este e-mail');
    });

    it('no longer offers the linked-user-id field', () => {
      expect(text()).not.toContain('ID do usuário');
      expect(dom().querySelector('#motorista-user-id')).toBeNull();
    });

    it('requires the contact e-mail: nothing is sent without it', async () => {
      await fillMinimum('');
      await submit();
      backend.expectNone((r) => r.method === 'POST');
      expect(text()).toContain('Informe um e-mail válido.');
    });

    it('registers with ONLY the minimum when CNH, address and RG are left empty (partial payload, no userId)', async () => {
      await fillMinimum();
      await submit();
      const body = postBody();
      expect(body).toEqual({
        name: 'João da Silva',
        contact: { email: 'joao@example.com', phone: '11987654321' },
        status: 'AVAILABLE',
        document: { type: 'CPF', value: VALID_CPF },
        thirdPartyContacts: [],
      });
      expect('userId' in body).toBe(false);
    });

    it('sends the complete payload (address + CNH + RG) when everything is filled, still without userId', async () => {
      await fillMinimum();
      await type(byId('motorista-rg'), '123456789');
      await fillAddress();
      await fillLicense();
      await submit();
      const body = postBody();
      expect(body['address']).toEqual({
        street: 'Praça da Sé',
        number: null,
        complement: null,
        district: 'Sé',
        cep: '01001-000',
        city: 'São Paulo',
        uf: 'SP',
      });
      expect(body['licenseNumber']).toBe('A1B2C3D4E5F');
      expect(body['licenseCategory']).toBe('B');
      expect(body['licenseExpiry']).toBe('2099-12-31');
      expect(body['rg']).toBe('123456789');
      expect('userId' in body).toBe(false);
    });

    it('keeps each block empty-or-complete: a lone CEP or a lone CNH number blocks the submit', async () => {
      await fillMinimum();
      await type(byId('motorista-cep'), '01001-000');
      await submit();
      backend.expectNone((r) => r.method === 'POST');
      expect(text()).toContain('Informe a rua.');

      await type(byId('motorista-cep'), '');
      await type(byId('motorista-cnh'), 'A1B2C3D4E5F');
      await submit();
      backend.expectNone((r) => r.method === 'POST');
      expect(text()).toContain('Informe a data de vencimento.');
      expect(text()).toContain('Selecione a categoria.');
    });
  });

  describe('invite outcome', () => {
    async function register(invite: Record<string, unknown> | undefined): Promise<void> {
      await fillMinimum();
      await submit();
      backend
        .expectOne((r) => r.method === 'POST' && r.url === DRIVERS)
        .flush(driverResponse(invite ? { invite } : {}));
      await settle();
    }

    it('PENDING: success toast with the e-mail and goes to the driver', async () => {
      await register({ status: 'PENDING', inviteId: 'inv-1', emailDelivery: 'QUEUED' });
      expect(toasts().map((t) => [t.kind, t.message])).toContainEqual([
        'success',
        'Motorista cadastrado. Convite enviado para joao@example.com.',
      ]);
      expect(router.url).toBe('/motoristas/drv-1');
    });

    it('FAILED without an invite id: warning with the reason, stays here, points to Membros (no resend)', async () => {
      await register({ status: 'FAILED', code: 'INVITE_DUPLICATE' });
      expect(router.url).toBe('/motoristas/novo');
      expect(dom().querySelector('[role="alert"]')?.textContent).toContain(
        'Motorista cadastrado, mas o convite não foi enviado (já existe um convite pendente para este e-mail).',
      );
      expect(dom().querySelector('[data-testid="invite-from-members"]')).not.toBeNull();
      expect(dom().querySelector('[data-testid="resend-invite"]')).toBeNull();
      expect(dom().querySelector('form')).toBeNull();
    });

    it.each([
      ['INVITE_DUPLICATE', 'já existe um convite pendente para este e-mail'],
      ['INVITE_ALREADY_MEMBER', 'esta pessoa já faz parte da empresa'],
      ['INVITE_PENDING_LIMIT_REACHED', 'o limite de convites pendentes da empresa foi atingido'],
      ['INVITE_SUPPORT_SESSION', 'convites não são enviados durante uma sessão de suporte'],
      ['INVITE_RATE_LIMITED', 'muitos convites em pouco tempo, aguarde um minuto'],
      ['SOMETHING_NEW', 'motivo não identificado'],
    ])('refused code %s reads as "%s"', async (code, reason) => {
      await register({ status: 'FAILED', code });
      expect(text()).toContain(`Motorista cadastrado, mas o convite não foi enviado (${reason}).`);
    });

    it('FAILED with an invite id offers "Reenviar convite" through the existing resend endpoint', async () => {
      await register({ status: 'FAILED', inviteId: 'inv-9', code: 'INVITE_NOT_CREATED' });
      (dom().querySelector('[data-testid="resend-invite"]') as HTMLButtonElement).click();
      await settle();
      const req = backend.expectOne(byUrl(`${API}/invites/resend/inv-9`));
      expect(req.request.method).toBe('POST');
      req.flush('', { status: 200, statusText: 'OK' });
      await settle();
      expect(toasts().map((t) => t.message)).toContain('Convite reenviado.');
      expect(router.url).toBe('/motoristas/drv-1');
    });

    it('a failed resend keeps the screen and says why', async () => {
      await register({ status: 'FAILED', inviteId: 'inv-9', code: 'INVITE_NOT_CREATED' });
      (dom().querySelector('[data-testid="resend-invite"]') as HTMLButtonElement).click();
      await settle();
      backend
        .expectOne(byUrl(`${API}/invites/resend/inv-9`))
        .flush({ message: 'Convite não pode ser reenviado.' }, { status: 400, statusText: 'Bad Request' });
      await settle();
      expect(router.url).toBe('/motoristas/novo');
      expect(text()).toContain('Convite não pode ser reenviado.');
    });

    it('NOT_SENT: neutral note, no warning', async () => {
      await register({ status: 'NOT_SENT', code: 'INVITE_ALREADY_MEMBER' });
      expect(toasts().map((t) => [t.kind, t.message])).toContainEqual([
        'info',
        'Motorista cadastrado. Nenhum convite foi enviado: ele já tem acesso a esta empresa.',
      ]);
      expect(router.url).toBe('/motoristas/drv-1');
    });

    it('a response without the invite part (older backend) keeps the plain toast', async () => {
      await register(undefined);
      expect(toasts().map((t) => t.message)).toContain('Motorista salvo.');
      expect(router.url).toBe('/motoristas/drv-1');
    });
  });

  describe('edit', () => {
    it('loads a PENDING_ONBOARDING driver (null address/CNH) and the PUT never carries userId', async () => {
      await router.navigateByUrl('/motoristas/drv-1/editar');
      harness.detectChanges();
      backend.expectOne(byUrl(`${DRIVERS}/drv-1`)).flush(
        driverResponse({
          name: 'João da Silva',
          rg: null,
          userId: 'u-1',
          document: { type: 'CPF', value: VALID_CPF },
          address: null,
          licenseNumber: null,
          licenseCategory: null,
          licenseExpiry: null,
          status: 'AVAILABLE',
        }),
      );
      await settle();
      expect(text()).not.toContain('ID do usuário');

      await type(byId('motorista-rg'), '123456789');
      await fillAddress();
      await fillLicense();
      await submit();
      const put = backend.expectOne((r) => r.method === 'PUT' && r.url === `${DRIVERS}/drv-1`);
      expect('userId' in (put.request.body as object)).toBe(false);
      expect((put.request.body as Record<string, unknown>)['licenseNumber']).toBe('A1B2C3D4E5F');
      put.flush(driverResponse({ registrationStatus: 'COMPLETE' }));
    });
  });
});
