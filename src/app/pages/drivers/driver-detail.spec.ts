import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';

import { DriverDetail } from './driver-detail';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverService } from '../../services/driver.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { RentalService } from '../rentals/rental.service';
import { InvitesService } from '../../services/invites.service';
import type { DriverResponse, ThirdPartyContact } from '../../types/driver.types';

/**
 * FEAT-0067 — card "Contatos de terceiros" no detalhe do motorista.
 *
 * O contrato do backend diz que `thirdPartyContacts` é SEMPRE uma lista, na
 * ordem enviada no cadastro. A view exibe nessa ordem, mostra um empty-state
 * consistente com os cards vizinhos quando vazia, e NÃO estoura se um backend
 * antigo omitir a chave (mesma postura fail-closed do `isAppDriver`).
 */
describe('DriverDetail — contatos de terceiros (FEAT-0067)', () => {
  const DRIVER_ID = 'drv-1';

  const baseDriver: DriverResponse = {
    id: DRIVER_ID,
    createdDate: '2026-01-10T12:00:00',
    modifyDate: null,
    companyId: 'co-1',
    userId: null,
    name: 'João da Silva',
    rg: '123456789',
    document: { type: 'CPF', value: '52998224725' },
    address: {
      street: 'Rua A',
      number: '10',
      complement: null,
      district: 'Centro',
      cep: '01001000',
      city: 'São Paulo',
      uf: 'SP',
    },
    contact: { email: 'joao@empresa.com', phone: '11987654321' },
    licenseNumber: 'ABC12345678',
    licenseCategory: 'B',
    licenseExpiry: '2030-01-01',
    status: 'AVAILABLE',
    isAppDriver: false,
    thirdPartyContacts: [],
  };

  let fixture: ComponentFixture<DriverDetail>;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function contactRows(): HTMLElement[] {
    return Array.from(host().querySelectorAll<HTMLElement>('[data-third-party-contacts] > li'));
  }

  async function setup(driver: DriverResponse): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => DRIVER_ID } } } },
        {
          provide: DriverService,
          useValue: {
            getOne: vi.fn().mockReturnValue(of(driver)),
            // O card de documentos (filho do detalhe) carrega a lista no init.
            listDocuments: vi.fn().mockReturnValue(of([])),
            uploadDocument: vi.fn(),
            deleteDocument: vi.fn(),
            documentSignedUrl: vi.fn(),
          },
        },
        {
          provide: RentalService,
          useValue: { list: vi.fn().mockReturnValue(of({ content: [] })) },
        },
        { provide: ExternalNavigationService, useValue: { openPendingTab: vi.fn() } },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
        },
        {
          provide: ApiErrorService,
          useValue: { claim: vi.fn(), messageFor: vi.fn(() => 'erro') },
        },
      ],
    });

    fixture = TestBed.createComponent(DriverDetail);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('lista os contatos NA ORDEM do array, com telefone formatado', async () => {
    const contacts: ThirdPartyContact[] = [
      { fullName: 'Maria da Silva', phone: '11987654321' },
      { fullName: 'José Souza', phone: '1132654321' },
      { fullName: 'Ana Pereira', phone: '21999887766' },
    ];
    await setup({ ...baseDriver, thirdPartyContacts: contacts });

    const rows = contactRows();
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Maria da Silva');
    expect(rows[0].textContent).toContain('(11) 98765-4321');
    expect(rows[1].textContent).toContain('José Souza');
    expect(rows[1].textContent).toContain('(11) 3265-4321');
    expect(rows[2].textContent).toContain('Ana Pereira');
    expect(rows[2].textContent).toContain('(21) 99988-7766');
    expect(host().textContent).toContain('Contatos de terceiros');
  });

  it('mostra o empty-state quando o motorista não tem contatos', async () => {
    await setup(baseDriver);

    expect(contactRows()).toHaveLength(0);
    expect(host().textContent).toContain('Nenhum contato de terceiro cadastrado.');
  });

  /**
   * Backend antigo, chave AUSENTE do JSON: a view degrada para o empty-state
   * sem estourar — o mesmo `TypeError` de leitura opcional que já derrubou uma
   * view neste repo não pode voltar por aqui.
   */
  it('não estoura quando a chave thirdPartyContacts está ausente do JSON', async () => {
    const semChave = { ...baseDriver } as Record<string, unknown>;
    delete semChave['thirdPartyContacts'];
    await setup(semChave as unknown as DriverResponse);

    expect(contactRows()).toHaveLength(0);
    expect(host().textContent).toContain('Nenhum contato de terceiro cadastrado.');
    // A página continua de pé com os cards vizinhos.
    expect(host().textContent).toContain('João da Silva');
  });
});

/**
 * Convite de motorista NASCE DO CADASTRO.
 *
 * O defeito que isto mata, medido em produção: um convite de DRIVER só é aceito
 * se já existir cadastro de motorista naquela empresa com aquele e-mail de
 * CONTATO — o aceite vincula por `contacts.email`. Convidando a partir de um
 * motorista que já existe, a ordem está garantida por construção e o aceite não
 * tem como falhar por falta de cadastro.
 *
 * O que estes testes travam, em ordem de custo se quebrar:
 *
 * 1. O e-mail enviado é o do CONTATO, não outro. Um convite com e-mail diferente
 *    recria exatamente o estado impossível.
 * 2. Sem e-mail no contato, a tela EXPLICA em vez de esconder o botão — botão
 *    que some é indistinguível de tela quebrada.
 * 3. O conflito traz a mensagem do SERVIDOR. As duas causas do 409 na criação
 *    foram medidas no backend e têm textos próprios; o 409 genérico de convites
 *    fala de outra coisa.
 */
describe('DriverDetail — convidar a partir do cadastro', () => {
  const DRIVER_ID = 'drv-1';

  const baseDriver: DriverResponse = {
    id: DRIVER_ID,
    createdDate: '2026-01-10T12:00:00',
    modifyDate: null,
    companyId: 'co-1',
    userId: null,
    name: 'João da Silva',
    rg: null,
    document: { type: 'CPF', value: '52998224725' },
    address: {
      street: 'Rua A', number: '10', complement: null, district: 'Centro',
      cep: '01001000', city: 'São Paulo', uf: 'SP',
    },
    contact: { email: 'joao@empresa.com', phone: '11987654321' },
    licenseNumber: 'ABC12345678',
    licenseCategory: 'B',
    licenseExpiry: '2030-01-01',
    status: 'AVAILABLE',
    isAppDriver: false,
    thirdPartyContacts: [],
  };

  let fixture: ComponentFixture<DriverDetail>;
  let create: ReturnType<typeof vi.fn>;
  let success: ReturnType<typeof vi.fn>;
  let messageFor: ReturnType<typeof vi.fn>;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function buttons(label: string): HTMLButtonElement[] {
    return Array.from(host().querySelectorAll('button')).filter((b) =>
      (b.textContent ?? '').toLowerCase().includes(label.toLowerCase()),
    );
  }

  async function setup(driver: DriverResponse): Promise<void> {
    create = vi.fn().mockReturnValue(of({ id: 'inv-1' }));
    success = vi.fn();
    messageFor = vi.fn(() => 'mensagem do servidor');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => DRIVER_ID } } } },
        {
          provide: DriverService,
          useValue: {
            getOne: vi.fn().mockReturnValue(of(driver)),
            listDocuments: vi.fn().mockReturnValue(of([])),
            uploadDocument: vi.fn(), deleteDocument: vi.fn(), documentSignedUrl: vi.fn(),
          },
        },
        { provide: RentalService, useValue: { list: vi.fn().mockReturnValue(of({ content: [] })) } },
        { provide: ExternalNavigationService, useValue: { openPendingTab: vi.fn() } },
        { provide: InvitesService, useValue: { create } },
        {
          provide: NotificationService,
          useValue: { success, info: vi.fn(), error: vi.fn(), warning: vi.fn() },
        },
        { provide: ApiErrorService, useValue: { claim: vi.fn(), messageFor } },
      ],
    });

    fixture = TestBed.createComponent(DriverDetail);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('manda o e-mail do CONTATO e o papel DRIVER — nunca outro e-mail', async () => {
    await setup(baseDriver);

    buttons('Convidar')[0].click();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual({
      email: 'joao@empresa.com',
      role: 'DRIVER',
      name: 'João da Silva',
    });
  });

  it('a ação está alcançável no CELULAR e no desktop', async () => {
    await setup(baseDriver);

    // O bloco mobile é `lg:hidden` e o desktop é `hidden lg:flex`: os dois
    // existem no DOM, e é por isso que a contagem é 2.
    expect(buttons('Convidar').length).toBe(2);
  });

  it('avisa para quem foi, com o e-mail, depois de criar', async () => {
    await setup(baseDriver);

    buttons('Convidar')[0].click();

    expect(success).toHaveBeenCalledWith('Convite enviado para joao@empresa.com.');
  });

  it('sem e-mail no contato NÃO oferece o botão, e diz por quê', async () => {
    await setup({ ...baseDriver, contact: { email: '', phone: '11987654321' } });

    expect(buttons('Convidar')).toHaveLength(0);
    expect(host().textContent).toContain('não tem e-mail cadastrado');
    expect(create).not.toHaveBeenCalled();
  });

  it('e-mail só com espaços conta como ausente', async () => {
    await setup({ ...baseDriver, contact: { email: '   ', phone: '11987654321' } });

    expect(buttons('Convidar')).toHaveLength(0);
    expect(host().textContent).toContain('não tem e-mail cadastrado');
  });

  it('quem já tem conta não é convidado de novo, e a tela explica', async () => {
    await setup({ ...baseDriver, userId: 'usr-1' });

    expect(buttons('Convidar')).toHaveLength(0);
    expect(host().textContent).toContain('já tem acesso');
  });

  it('o conflito mostra a mensagem do SERVIDOR, não uma inventada', async () => {
    await setup(baseDriver);
    create.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: {} })),
    );

    buttons('Convidar')[0].click();
    fixture.detectChanges();

    expect(messageFor).toHaveBeenCalled();
    expect(host().textContent).toContain('mensagem do servidor');
    expect(success).not.toHaveBeenCalled();
  });

  it('dois cliques não viram dois convites', async () => {
    await setup(baseDriver);
    create.mockReturnValue(NEVER);

    const button = buttons('Convidar')[0];
    button.click();
    fixture.detectChanges();
    button.click();

    expect(create).toHaveBeenCalledTimes(1);
  });
});
