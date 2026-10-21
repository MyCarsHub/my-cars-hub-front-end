import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorService } from '../../services/api-error.service';
import { AuthService } from '../../services/auth.service';
import { CepService } from '../../services/cep.service';
import { DriverProfileService } from '../../services/driver-profile.service';
import { NotificationService } from '../../services/notification.service';
import { DriverProfileData } from '../../types/driver-ledger.types';
import { DriverProfile } from './driver-profile';

const profile = (over: Partial<DriverProfileData> = {}): DriverProfileData => ({
  driverId: 'd-1',
  name: 'Carlos Souza',
  status: 'WORKING',
  registrationStatus: 'COMPLETE',
  documentType: 'CPF',
  documentMasked: '***.456.789-**',
  email: 'carlos@example.com',
  phone: '11987654321',
  licenseCategory: 'B',
  licenseExpiry: '2029-05-01',
  address: {
    street: 'Rua das Flores',
    number: '120',
    complement: null,
    district: 'Centro',
    cep: '01001000',
    city: 'São Paulo',
    uf: 'SP',
  },
  companyId: 'c-1',
  companyName: 'Locadora Alfa',
  activeRental: null,
  ...over,
});

describe('DriverProfile', () => {
  let fixture: ComponentFixture<DriverProfile>;
  let get: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let logout: ReturnType<typeof vi.fn>;
  let lookup: ReturnType<typeof vi.fn>;
  let router: Router;
  let notifications: NotificationService;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const q = <T extends HTMLElement>(sel: string) => root().querySelector<T>(sel);
  const field = (id: string) => q<HTMLInputElement>(`#${id}`)!;

  function type(id: string, value: string, inputType = 'insertText'): void {
    const el = field(id);
    el.value = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: value }));
    fixture.detectChanges();
  }

  function save(): void {
    q<HTMLFormElement>('[data-edit-form]')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  function build(loader: () => Observable<DriverProfileData> = () => of(profile())): void {
    get = vi.fn(loader);
    update = vi.fn((payload) => of(profile({ phone: payload.phone })));
    logout = vi.fn();
    lookup = vi.fn(() => of(null));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: DriverProfileService, useValue: { get, update } },
        { provide: AuthService, useValue: { logout } },
        { provide: CepService, useValue: { lookup } },
      ],
    });
    router = TestBed.inject(Router);
    notifications = TestBed.inject(NotificationService);
    fixture = TestBed.createComponent(DriverProfile);
    fixture.detectChanges();
  }

  describe('leitura', () => {
    beforeEach(() => build());

    it('mostra quem é, com o CPF MASCARADO como o servidor mandou', () => {
      expect(q('[data-name]')!.textContent).toContain('Carlos Souza');
      expect(q('[data-document]')!.textContent?.trim()).toBe('***.456.789-**');
      expect(text()).toContain('carlos@example.com');
      expect(text()).toContain('Categoria B · válida até 01/05/2029');
    });

    it('nunca mostra um CPF inteiro, mesmo que o servidor o mandasse', () => {
      TestBed.resetTestingModule();
      build(() => of(profile({ documentMasked: '***.***.***-01' })));
      expect(text()).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    });

    it('nome, e-mail e CPF são só leitura: não há campo para eles', () => {
      expect(q('#driver-name')).toBeNull();
      expect(q('input[type="email"]')).toBeNull();
      expect(text()).toContain('cadastrados pela locadora');
    });

    it('mostra a locadora e o papel de motorista', () => {
      expect(q('[data-company]')!.textContent).toContain('Locadora Alfa');
      expect(text()).toContain('Motorista');
    });

    it('não tem plano, assinatura, cobrança nem tour', () => {
      const t = text().toLowerCase();
      for (const word of ['assinatura', 'plano', 'cobrança', 'billing', 'tour', 'empresas vinculadas']) {
        expect(t, `apareceu "${word}" no perfil do motorista`).not.toContain(word);
      }
    });

    // Decisão do dono: nada de card vazio. Sem aluguel, o cartão do aluguel não é desenhado.
    it('sem aluguel ativo, o cartão do aluguel não aparece', () => {
      expect(q('[data-active-rental]')).toBeNull();
      expect(text()).not.toContain('Aluguel ativo');
      expect(text()).not.toContain('Ver aluguel');
    });
  });

  describe('aluguel ativo', () => {
    it('mostra a placa e leva ao aluguel', () => {
      build(() =>
        of(
          profile({
            activeRental: {
              rentalId: 'r-5',
              vehicleId: 'v-1',
              plate: 'ABC1D23',
              brand: 'Fiat',
              model: 'Argo',
              startDate: '2026-09-01',
              endDate: null,
            },
          }),
        ),
      );

      const card = q('[data-active-rental]')!;
      expect(card.textContent).toContain('ABC1D23');
      expect(card.textContent).toContain('Fiat Argo');
      expect(card.textContent).toContain('Desde');
      expect(card.textContent).toContain('01/09/2026');
      expect(card.textContent).toContain('Ver aluguel');
      expect(card.querySelector('a')!.getAttribute('href')).toBe('/alugueis/r-5');
    });
  });

  describe('carga', () => {
    it('enquanto carrega mostra o skeleton da página, sem o formulário', () => {
      build(() => new Subject<DriverProfileData>());
      expect(q('[data-skeleton]')?.getAttribute('aria-busy')).toBe('true');
      expect(q('[data-edit-form]')).toBeNull();
    });

    it('se falhar, mostra o erro e tenta de novo pelo botão', () => {
      let calls = 0;
      build(() => {
        calls += 1;
        return calls === 1
          ? throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'Indisponível.' } }))
          : of(profile());
      });

      expect(q('[data-load-error]')!.textContent).toContain('Indisponível.');
      q<HTMLButtonElement>('[data-load-error] button')!.click();
      fixture.detectChanges();

      expect(q('[data-load-error]')).toBeNull();
      expect(q('[data-name]')!.textContent).toContain('Carlos Souza');
    });
  });

  describe('edição de telefone e endereço', () => {
    beforeEach(() => build());

    it('abre preenchido: telefone com máscara, CEP com hífen', () => {
      expect(field('driver-phone').value).toBe('(11) 98765-4321');
      expect(field('driver-cep').value).toBe('01001-000');
      expect(field('driver-street').value).toBe('Rua das Flores');
      expect(field('driver-uf').value).toBe('SP');
    });

    it('os campos têm tamanho de leitura de celular (16px) e alvo de 48px', () => {
      for (const id of ['driver-phone', 'driver-cep', 'driver-street', 'driver-city']) {
        expect(field(id).className, id).toContain('text-base');
        expect(field(id).className, id).toContain('min-h-12');
      }
      expect(field('driver-phone').getAttribute('inputmode')).toBe('tel');
      expect(q<HTMLButtonElement>('[data-edit-form] button[type="submit"]')!.className).toContain(
        'min-h-12',
      );
    });

    it('salva mandando o telefone só com dígitos e o endereço completo', () => {
      type('driver-phone', '11912345678');
      type('driver-street', 'Avenida Nova');
      save();

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith({
        phone: '11912345678',
        address: {
          street: 'Avenida Nova',
          number: '120',
          complement: null,
          district: 'Centro',
          cep: '01001-000',
          city: 'São Paulo',
          uf: 'SP',
        },
      });
      expect(notifications.notifications().map((n) => n.message)).toContain(
        'Seus dados foram atualizados.',
      );
    });

    it('só telefone e endereço viajam: nunca nome, e-mail, CPF ou CNH', () => {
      save();

      const payload = update.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(['address', 'phone']);
    });

    it('telefone curto é recusado antes de ir ao servidor', () => {
      type('driver-phone', '1198765');
      save();

      expect(update).not.toHaveBeenCalled();
      expect(text()).toContain('Telefone com DDD, 10 ou 11 números.');
    });

    it('telefone vazio é recusado', () => {
      type('driver-phone', '');
      save();

      expect(update).not.toHaveBeenCalled();
      expect(text()).toContain('Informe o seu telefone.');
    });

    it('endereço pela metade é recusado e aponta o que falta', () => {
      type('driver-city', '');
      save();

      expect(update).not.toHaveBeenCalled();
      expect(text()).toContain('Informe a cidade.');
    });

    it('o CEP preenche rua, bairro, cidade e UF ao sair do campo', () => {
      lookup.mockReturnValue(
        of({ street: 'Praça da Sé', district: 'Sé', city: 'São Paulo', uf: 'SP' }),
      );
      type('driver-cep', '01001000');
      field('driver-cep').dispatchEvent(new Event('blur'));
      fixture.detectChanges();

      expect(lookup).toHaveBeenCalledWith('01001000');
      expect(field('driver-street').value).toBe('Praça da Sé');
      expect(field('driver-district').value).toBe('Sé');
    });

    it('erro do servidor aparece no formulário e não apaga o que foi digitado', () => {
      update.mockReturnValue(
        throwError(
          () => new HttpErrorResponse({ status: 400, error: { message: 'Telefone inválido.' } }),
        ),
      );
      type('driver-phone', '11912345678');
      save();

      expect(text()).toContain('Telefone inválido.');
      expect(field('driver-phone').value).toBe('(11) 91234-5678');
    });
  });

  describe('cadastro sem endereço (onboarding pendente)', () => {
    beforeEach(() => build(() => of(profile({ address: null, registrationStatus: 'PENDING_ONBOARDING' }))));

    it('trocar só o telefone não obriga a inventar endereço, e o endereço não viaja', () => {
      type('driver-phone', '11912345678');
      save();

      expect(update).toHaveBeenCalledWith({ phone: '11912345678' });
    });

    it('começar o endereço obriga a completá-lo', () => {
      type('driver-street', 'Rua Nova');
      save();

      expect(update).not.toHaveBeenCalled();
      expect(text()).toContain('Informe o CEP.');
      expect(text()).toContain('Informe o bairro.');
    });
  });

  describe('Sair e suporte', () => {
    beforeEach(() => build());

    it('Sair encerra a sessão e vai para o login sem deixar a tela no histórico', () => {
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      q<HTMLButtonElement>('[data-logout]')!.click();

      expect(logout).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/login', { replaceUrl: true });
    });

    // Protótipo do dono: Sair mora no cartão "Sua conta", ao lado de Ajuda — não mais no
    // pé da página. Continua com alvo de 44px e com a cor de ação destrutiva.
    it('Sair fica no cartão Sua conta, com alvo de 44px e cor destrutiva', () => {
      const button = q<HTMLButtonElement>('[data-logout]')!;
      expect(button.closest('section')?.textContent).toContain('Sua conta');
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('text-rose-700');
    });

    it('leva ao suporte', () => {
      expect(q<HTMLAnchorElement>('[data-support-link]')!.getAttribute('href')).toBe('/suporte');
    });
  });
});
