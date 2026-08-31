import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DriverDetail } from './driver-detail';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverService } from '../../services/driver.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { RentalService } from '../rentals/rental.service';
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
