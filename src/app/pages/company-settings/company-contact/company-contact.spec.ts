import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanyContact } from './company-contact';
import { CompanyContactService } from '../../../services/company-contact.service';
import { NotificationService } from '../../../services/notification.service';
import type {
  CompanyContactPayload,
  CompanyContactSnapshot,
  CompanyContact as CompanyContactBlock,
} from '../../../types/company-contact.types';
import { EMPTY_COMPANY_CONTACT } from '../../../types/company-contact.types';

/**
 * Cobre Configurações → Dados de contato da empresa.
 *
 * O que estes testes protegem, em ordem de risco:
 *  - o `PUT` substitui o bloco INTEIRO, então salvar precisa mandar as onze
 *    chaves sempre — mandar meia dúzia apagaria a outra metade no banco;
 *  - limpar um campo tem que continuar limpo depois de recarregar, e só um `''`
 *    explícito consegue isso;
 *  - o formulário não pode existir enquanto o GET está em voo, senão a resposta
 *    sobrescreve o que o usuário digitou (corrida que a tela vizinha tem);
 *  - empresa que nunca preencheu carrega sem quebrar;
 *  - erro de validação não vira requisição.
 */
describe('CompanyContact (Configurações → Dados de contato)', () => {
  const FILLED: CompanyContactBlock = {
    phone: '(11) 98765-4321',
    email: 'contato@locadora.com.br',
    addressStreet: 'Rua das Flores',
    addressNumber: '123',
    addressComplement: 'Sala 4',
    addressDistrict: 'Centro',
    addressCep: '01001-000',
    addressCity: 'São Paulo',
    addressUf: 'SP',
    representativeName: 'Maria Souza',
    representativeRole: 'Sócia-administradora',
  };

  /** As onze chaves do bloco — a lista contra a qual "completo" é medido. */
  const ALL_KEYS: ReadonlyArray<keyof CompanyContactPayload> = [
    'phone',
    'email',
    'addressStreet',
    'addressNumber',
    'addressComplement',
    'addressDistrict',
    'addressCep',
    'addressCity',
    'addressUf',
    'representativeName',
    'representativeRole',
  ];

  let loadSpy: ReturnType<typeof vi.fn>;
  let saveSpy: ReturnType<typeof vi.fn>;
  let successSpy: ReturnType<typeof vi.fn>;

  function snapshotOf(contact: CompanyContactBlock): CompanyContactSnapshot {
    return { name: 'Locadora Central', contact };
  }

  function configure(loadReturn: unknown = of(snapshotOf(FILLED))): void {
    successSpy = vi.fn();
    loadSpy = vi.fn(() => loadReturn);
    saveSpy = vi.fn((_name: string, contact: CompanyContactPayload) =>
      of(snapshotOf({ ...contact } as unknown as CompanyContactBlock)),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CompanyContact],
      providers: [
        provideRouter([]),
        { provide: CompanyContactService, useValue: { load: loadSpy, save: saveSpy } },
        {
          provide: NotificationService,
          useValue: { success: successSpy, error: vi.fn(), push: vi.fn() },
        },
      ],
    });
  }

  function render(): ComponentFixture<CompanyContact> {
    const fixture = TestBed.createComponent(CompanyContact);
    fixture.detectChanges();
    return fixture;
  }

  /** `fixture.nativeElement` é `any`; tipar aqui mantém o resto do spec estrito. */
  function host(fixture: ComponentFixture<CompanyContact>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** Acesso ao grupo `contact` sem alargar a superfície pública do componente. */
  function contactGroup(fixture: ComponentFixture<CompanyContact>) {
    const component = fixture.componentInstance as unknown as {
      form: { controls: { contact: { patchValue: (v: Record<string, string>) => void } } };
      save: () => void;
    };
    return component;
  }

  beforeEach(() => configure());

  it('carrega uma empresa sem nenhum dado de contato sem quebrar e sem inventar valor', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();

    const inputs = Array.from(
      host(fixture).querySelectorAll<HTMLInputElement>('input'),
    );
    expect(inputs.length).toBe(ALL_KEYS.length);
    for (const input of inputs) {
      expect(input.value).toBe('');
    }
    // A tela avisa que o contrato sairá com lacunas.
    expect(host(fixture).textContent).toContain('ainda não tem dados de contato');
  });

  it('salva o bloco COMPLETO — as onze chaves, mesmo as que o usuário não tocou', () => {
    const fixture = render();

    contactGroup(fixture).save();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const [name, payload] = saveSpy.mock.calls[0] as [string, CompanyContactPayload];

    // `name` é @NotBlank no PUT: sem devolvê-lo, salvar contato renomearia a empresa.
    expect(name).toBe('Locadora Central');
    expect(Object.keys(payload).sort()).toEqual([...ALL_KEYS].sort());
    for (const key of ALL_KEYS) {
      expect(payload[key]).toBe(FILLED[key]);
    }
  });

  it('limpar um campo manda "" nele e PRESERVA todos os outros já preenchidos', () => {
    const fixture = render();

    // O usuário apaga só o complemento.
    contactGroup(fixture).form.controls.contact.patchValue({ addressComplement: '' });
    contactGroup(fixture).save();

    const [, payload] = saveSpy.mock.calls[0] as [string, CompanyContactPayload];

    // O campo limpo viaja como string vazia — é assim que o backend grava NULL.
    expect(payload.addressComplement).toBe('');

    // E este é o cenário que o PUT tudo-ou-nada torna perigoso: nenhum dos outros
    // dez campos pode ter virado "" de carona, senão salvar apagaria dado do banco.
    for (const key of ALL_KEYS) {
      if (key === 'addressComplement') continue;
      expect(payload[key]).toBe(FILLED[key]);
    }
  });

  it('não deixa o GET em voo sobrescrever digitação: o formulário só nasce com a resposta', () => {
    const pending = new Subject<CompanyContactSnapshot>();
    configure(pending.asObservable());
    const fixture = render();

    // Enquanto carrega não existe input nenhum — logo não há o que sobrescrever.
    expect(host(fixture).querySelectorAll('input').length).toBe(0);
    expect(host(fixture).querySelector('form')).toBeNull();

    pending.next(snapshotOf(FILLED));
    pending.complete();
    fixture.detectChanges();

    expect(host(fixture).querySelectorAll('input').length).toBe(ALL_KEYS.length);
  });

  it('UF com uma letra só é recusada no cliente e nenhuma requisição sai', () => {
    const fixture = render();

    contactGroup(fixture).form.controls.contact.patchValue({ addressUf: 'S' });
    contactGroup(fixture).save();

    expect(saveSpy).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(host(fixture).textContent).toContain('exatamente 2 letras');
  });

  it('manda a UF em maiúsculas', () => {
    const fixture = render();

    contactGroup(fixture).form.controls.contact.patchValue({ addressUf: 'rj' });
    contactGroup(fixture).save();

    const [, payload] = saveSpy.mock.calls[0] as [string, CompanyContactPayload];
    expect(payload.addressUf).toBe('RJ');
  });

  it('o 400 do servidor cai inline no campo, pelo extrator compartilhado', () => {
    const fixture = render();
    saveSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              message: 'Erro de validação',
              fieldErrors: { 'contact.email': 'Informe um e-mail válido.' },
            },
          }),
      ),
    );

    contactGroup(fixture).save();
    fixture.detectChanges();

    expect(host(fixture).textContent).toContain('Informe um e-mail válido.');
  });

  it('falha no GET não rende formulário — editar às cegas apagaria o que está gravado', () => {
    configure(throwError(() => new HttpErrorResponse({ status: 404, error: {} })));
    const fixture = render();

    expect(host(fixture).querySelector('form')).toBeNull();
    expect(host(fixture).textContent).toContain('Tentar de novo');
  });
});
