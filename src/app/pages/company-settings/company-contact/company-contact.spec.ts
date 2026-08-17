import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanyContact } from './company-contact';
import { CepService, type CepLookupResult } from '../../../services/cep.service';
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

  /** O que o ViaCEP devolve para 01310-100. Nunca traz número nem complemento. */
  const VIACEP_PAULISTA: CepLookupResult = {
    street: 'Avenida Paulista',
    district: 'Bela Vista',
    city: 'São Paulo',
    uf: 'SP',
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
  let lookupSpy: ReturnType<typeof vi.fn>;

  function snapshotOf(contact: CompanyContactBlock): CompanyContactSnapshot {
    return { name: 'Locadora Central', contact };
  }

  function configure(loadReturn: unknown = of(snapshotOf(FILLED))): void {
    successSpy = vi.fn();
    loadSpy = vi.fn(() => loadReturn);
    saveSpy = vi.fn((_name: string, contact: CompanyContactPayload) =>
      of(snapshotOf({ ...contact } as unknown as CompanyContactBlock)),
    );
    // `CepService` engole erro de rede e devolve `null` — o mesmo `null` de CEP inexistente.
    lookupSpy = vi.fn(() => of<CepLookupResult | null>(VIACEP_PAULISTA));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CompanyContact],
      providers: [
        provideRouter([]),
        { provide: CompanyContactService, useValue: { load: loadSpy, save: saveSpy } },
        { provide: CepService, useValue: { lookup: lookupSpy } },
        {
          provide: NotificationService,
          useValue: { success: successSpy, error: vi.fn(), push: vi.fn() },
        },
      ],
    });
  }

  /** Dispara a máscara + a busca como o `(input)` do template faz. */
  function typeCep(fixture: ComponentFixture<CompanyContact>, masked: string): void {
    const input = host(fixture).querySelector<HTMLInputElement>('#empresa-cep');
    if (!input) throw new Error('campo de CEP não renderizado');
    input.value = masked;
    input.selectionStart = masked.length;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
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
      form: {
        controls: {
          contact: {
            patchValue: (value: Partial<CompanyContactPayload>) => void;
            getRawValue: () => CompanyContactPayload;
            controls: Record<keyof CompanyContactPayload, { valid: boolean }>;
          };
        };
      };
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

  it('limpar o BLOCO INTEIRO manda "" nas onze chaves — é assim que se apaga o contato', () => {
    const fixture = render();

    // A regra tudo-ou-nada trocou o cenário: apagar UM campo agora é recusado, então
    // o caminho de limpeza é esvaziar o bloco todo de uma vez.
    contactGroup(fixture).form.controls.contact.patchValue(
      Object.fromEntries(ALL_KEYS.map((key) => [key, ''])),
    );
    contactGroup(fixture).save();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const [, payload] = saveSpy.mock.calls[0] as [string, CompanyContactPayload];

    // Cada campo viaja como string vazia — é assim que o backend grava NULL. Nenhuma
    // chave pode sumir do payload, senão o backend deixaria a coluna intacta.
    expect(Object.keys(payload).sort()).toEqual([...ALL_KEYS].sort());
    for (const key of ALL_KEYS) {
      expect(payload[key]).toBe('');
    }
  });

  it('apagar UM campo é recusado: o bloco meio preenchido não sai daqui', () => {
    const fixture = render();

    contactGroup(fixture).form.controls.contact.patchValue({ addressNumber: '' });
    contactGroup(fixture).save();

    expect(saveSpy).not.toHaveBeenCalled();
    fixture.detectChanges();

    // A cópia explica a regra inteira; "Campo obrigatório." seria mentira num
    // formulário que aceita ficar todo vazio.
    expect(host(fixture).textContent).toContain(
      'Preencha todos os campos ou deixe o bloco inteiro em branco.',
    );
  });

  it('o complemento continua opcional mesmo com o resto preenchido', () => {
    const fixture = render();

    contactGroup(fixture).form.controls.contact.patchValue({ addressComplement: '' });
    contactGroup(fixture).save();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const [, payload] = saveSpy.mock.calls[0] as [string, CompanyContactPayload];
    expect(payload.addressComplement).toBe('');
    // Nenhum dos outros dez pode ter virado "" de carona.
    for (const key of ALL_KEYS) {
      if (key === 'addressComplement') continue;
      expect(payload[key]).toBe(FILLED[key]);
    }
  });

  it('empresa em branco salva sem reclamar de nada — o bloco vazio é válido', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();

    contactGroup(fixture).save();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    // Nenhuma mensagem de erro de campo (o banner informativo é `role="status"`).
    expect(host(fixture).querySelectorAll('p[role="alert"]').length).toBe(0);
    // Nada de `*` enquanto o bloco todo em branco ainda é uma opção legítima.
    expect(host(fixture).querySelectorAll('[aria-required="true"]').length).toBe(0);
  });

  it('um único campo preenchido acende os `*` e trava o envio', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();

    contactGroup(fixture).form.controls.contact.patchValue({ phone: '(11) 98765-4321' });
    fixture.detectChanges();

    // Dez dos onze campos ficam obrigatórios; o complemento fica de fora.
    expect(host(fixture).querySelectorAll('[aria-required="true"]').length).toBe(
      ALL_KEYS.length - 1,
    );

    contactGroup(fixture).save();
    expect(saveSpy).not.toHaveBeenCalled();
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

  it('CEP completo busca o endereço e preenche logradouro, bairro, cidade e UF', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();

    typeCep(fixture, '01310-100');

    expect(lookupSpy).toHaveBeenCalledTimes(1);
    expect(lookupSpy).toHaveBeenCalledWith('01310100');

    const value = contactGroup(fixture).form.controls.contact.getRawValue();
    expect(value.addressStreet).toBe('Avenida Paulista');
    expect(value.addressDistrict).toBe('Bela Vista');
    expect(value.addressCity).toBe('São Paulo');
    expect(value.addressUf).toBe('SP');
    // O ViaCEP não traz estes dois — preencher seria inventar dado.
    expect(value.addressNumber).toBe('');
    expect(value.addressComplement).toBe('');
  });

  it('CEP incompleto não consulta nada, e o mesmo CEP não é consultado duas vezes', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();

    typeCep(fixture, '0131010');
    expect(lookupSpy).not.toHaveBeenCalled();

    typeCep(fixture, '01310-100');
    expect(lookupSpy).toHaveBeenCalledTimes(1);

    // Um `input` a mais no mesmo valor (clique, teclado virtual) não repete a chamada.
    typeCep(fixture, '01310-100');
    expect(lookupSpy).toHaveBeenCalledTimes(1);
  });

  it('CEP sem resposta mostra aviso visível — e NÃO impede salvar', () => {
    const fixture = render();
    lookupSpy.mockReturnValue(of(null));

    typeCep(fixture, '99999-999');

    const warning = host(fixture).querySelector('[data-cep-lookup-error]');
    expect(warning?.textContent).toContain('CEP não encontrado ou serviço indisponível');
    // O aviso é visual; quem anuncia é a região de status (ver os testes de WCAG 4.1.3).
    expect(host(fixture).querySelector('[data-cep-status]')?.textContent).toContain(
      'CEP não encontrado ou serviço indisponível',
    );

    // O aviso não invalida o campo: CEP novo que o ViaCEP ainda não conhece é salvável.
    expect(contactGroup(fixture).form.controls.contact.controls.addressCep.valid).toBe(true);
    contactGroup(fixture).save();
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('o aviso de CEP entra no `aria-describedby` do campo, junto com o erro de formato', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();
    lookupSpy.mockReturnValue(of(null));

    typeCep(fixture, '99999-999');

    const input = host(fixture).querySelector<HTMLInputElement>('#empresa-cep');
    const warning = host(fixture).querySelector('[data-cep-lookup-error]');
    const described = input?.getAttribute('aria-describedby') ?? '';

    // Sem isto o `role="alert"` anuncia uma vez e o texto some para o leitor de tela.
    expect(warning?.id).toBeTruthy();
    expect(described.split(' ')).toContain(warning?.id);
  });

  it('CEP que falhou pode ser tentado de novo sem editar um dígito sequer', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();
    lookupSpy.mockReturnValue(of(null));

    typeCep(fixture, '99999-999');
    expect(lookupSpy).toHaveBeenCalledTimes(1);

    // A falha NÃO marca o CEP como já consultado — senão o botão seria decorativo.
    const retry = host(fixture).querySelector<HTMLButtonElement>('[data-cep-retry]');
    expect(retry).not.toBeNull();
    lookupSpy.mockReturnValue(of(VIACEP_PAULISTA));
    retry?.focus();
    retry?.click();
    fixture.detectChanges();

    expect(lookupSpy).toHaveBeenCalledTimes(2);
    expect(lookupSpy).toHaveBeenLastCalledWith('99999999');
    expect(contactGroup(fixture).form.controls.contact.getRawValue().addressStreet).toBe(
      'Avenida Paulista',
    );
    // Deu certo: o aviso e o botão saem da tela — e o foco não pode cair no `<body>`
    // junto com o botão que sumiu, senão o Tab recomeça do topo do documento.
    expect(host(fixture).querySelector('[data-cep-retry]')).toBeNull();
    expect(document.activeElement).toBe(host(fixture).querySelector('#empresa-cep'));
  });

  it('quem clicou no retry e seguiu em frente não é puxado de volta', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();
    lookupSpy.mockReturnValue(of(null));

    typeCep(fixture, '99999-999');
    lookupSpy.mockReturnValue(of(VIACEP_PAULISTA));
    // Foco já saiu do botão (consulta lenta, usuário foi preencher à mão): devolver
    // o foco ao CEP aqui seria a mesma mudança de contexto que a tela deixou de fazer.
    const numero = host(fixture).querySelector<HTMLInputElement>('#empresa-numero');
    numero?.focus();
    host(fixture).querySelector<HTMLButtonElement>('[data-cep-retry]')?.click();
    fixture.detectChanges();

    expect(lookupSpy).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(numero);
  });

  it('nova tentativa que falha de novo mantém o botão — e o foco nele', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();
    lookupSpy.mockReturnValue(of(null));

    typeCep(fixture, '99999-999');
    const retry = host(fixture).querySelector<HTMLButtonElement>('[data-cep-retry]');
    retry?.focus();
    retry?.click();
    fixture.detectChanges();

    expect(lookupSpy).toHaveBeenCalledTimes(2);
    expect(host(fixture).querySelector('[data-cep-retry]')).toBe(retry);
    expect(document.activeElement).toBe(retry);
  });

  it('digitar o CEP não rouba o foco; sair do campo é que leva ao Número', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();

    const cep = host(fixture).querySelector<HTMLInputElement>('#empresa-cep');
    const numero = host(fixture).querySelector<HTMLInputElement>('#empresa-numero');
    cep?.focus();

    typeCep(fixture, '01310-100');

    // WCAG 3.2.2: mudança de contexto por tecla, com o teclado virtual aberto, não.
    expect(document.activeElement).toBe(cep);

    cep?.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(document.activeElement).toBe(numero);
  });

  it('sair do CEP não mexe no foco quando o Número já está preenchido', () => {
    const fixture = render();

    const cep = host(fixture).querySelector<HTMLInputElement>('#empresa-cep');
    cep?.focus();
    typeCep(fixture, '01310-100');
    cep?.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    // FILLED já tem número: quem voltou ao CEP para corrigir fica onde está.
    expect(document.activeElement).toBe(cep);
  });

  it('sair do CEP para um destino escolhido pelo usuário não desvia o toque', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();

    const cep = host(fixture).querySelector<HTMLInputElement>('#empresa-cep');
    const complemento = host(fixture).querySelector<HTMLInputElement>('#empresa-complemento');
    const numero = host(fixture).querySelector<HTMLInputElement>('#empresa-numero');
    cep?.focus();

    typeCep(fixture, '01310-100');

    // No celular o `blur` do CEP chega ANTES de o alvo do toque receber o foco. Um
    // `blur` COM destino é o usuário dizendo para onde quer ir: tocar em "Complemento",
    // em "Bairro" ou no botão Salvar não pode terminar no campo "Número".
    cep?.dispatchEvent(new FocusEvent('blur', { relatedTarget: complemento }));
    fixture.detectChanges();

    expect(document.activeElement).not.toBe(numero);
  });

  it('a consulta de CEP fala com o leitor de tela: início e endereço resolvido', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const pending = new Subject<CepLookupResult | null>();
    lookupSpy.mockReturnValue(pending.asObservable());
    const fixture = render();

    const status = host(fixture).querySelector('[data-cep-status]');
    // WCAG 4.1.3: mensagem de status precisa de região viva, e ela fica sempre montada.
    expect(status?.getAttribute('aria-live')).toBe('polite');

    typeCep(fixture, '01310-100');
    expect(status?.textContent).toContain('Buscando endereço');

    pending.next(VIACEP_PAULISTA);
    fixture.detectChanges();

    // Quatro campos mudam de valor sem o foco sair do lugar: sem anúncio, a mudança é
    // silenciosa para quem não vê a tela.
    expect(status?.textContent).toContain('Avenida Paulista');
    expect(status?.textContent).toContain('Falta o número');
  });

  it('a SEGUNDA falha do mesmo CEP volta a ser anunciada', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();
    lookupSpy.mockReturnValue(of(null));

    typeCep(fixture, '99999-999');
    const status = host(fixture).querySelector('[data-cep-status]');
    expect(status?.textContent).toContain('CEP não encontrado');

    const pending = new Subject<CepLookupResult | null>();
    lookupSpy.mockReturnValue(pending.asObservable());
    host(fixture).querySelector<HTMLButtonElement>('[data-cep-retry]')?.click();
    fixture.detectChanges();

    // A região passa por "Buscando endereço…" entre as duas tentativas — é essa mudança
    // de texto que faz a segunda falha ser lida. O `role="alert"` de antes ficava
    // montado com o mesmo texto e a segunda falha saía muda.
    expect(status?.textContent).toContain('Buscando endereço');

    pending.next(null);
    fixture.detectChanges();

    expect(status?.textContent).toContain('CEP não encontrado');
  });

  it('durante a nova tentativa o botão fica ocupado, sem mensagens contraditórias', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();
    lookupSpy.mockReturnValue(of(null));

    typeCep(fixture, '99999-999');

    const pending = new Subject<CepLookupResult | null>();
    lookupSpy.mockReturnValue(pending.asObservable());
    const retry = host(fixture).querySelector<HTMLButtonElement>('[data-cep-retry]');
    retry?.focus();
    retry?.click();
    fixture.detectChanges();

    expect(retry?.getAttribute('aria-disabled')).toBe('true');
    expect(retry?.textContent).toContain('Buscando endereço');
    // O hint não pode dizer "Buscando endereço…" enquanto o aviso de falha ainda está
    // na tela: eram duas mensagens contraditórias ao mesmo tempo.
    expect(host(fixture).querySelector('#empresa-cep-hint')).toBeNull();
    // `aria-disabled`, e não `disabled`: desabilitar o botão recém-clicado faria o
    // navegador largar o foco no `<body>`.
    expect(document.activeElement).toBe(retry);

    // E o clique repetido enquanto ocupa não dispara uma segunda consulta.
    retry?.click();
    expect(lookupSpy).toHaveBeenCalledTimes(2);
  });

  it('retry cancelado antes da resposta não deixa a flag "veio do botão" ligada', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();
    lookupSpy.mockReturnValue(of(null));

    typeCep(fixture, '99999-999');

    const pending = new Subject<CepLookupResult | null>();
    lookupSpy.mockReturnValue(pending.asObservable());
    host(fixture).querySelector<HTMLButtonElement>('[data-cep-retry]')?.click();
    fixture.detectChanges();

    // Apagar um dígito antes de a resposta chegar cancela a consulta: ela termina em
    // `cancelled` e nunca vira sucesso nem falha.
    typeCep(fixture, '99999-99');

    // A asserção é sobre o INVARIANTE, não sobre um sintoma: hoje o estrago fica
    // contido pela guarda de foco lá na frente (sem aviso na tela não há botão para
    // ter o foco), então a flag presa em `true` é uma armadilha silenciosa esperando a
    // primeira mudança que remova essa contenção.
    const internals = fixture.componentInstance as unknown as { cepRetryFromButton: boolean };
    expect(internals.cepRetryFromButton).toBe(false);
  });

  it('envio recusado por bloco incompleto sempre termina em alguma mensagem visível', () => {
    const fixture = render();

    contactGroup(fixture).form.controls.contact.patchValue({ addressNumber: '' });
    contactGroup(fixture).save();
    fixture.detectChanges();

    // O erro do GRUPO tem superfície própria — se um dia nenhum filho acender o
    // `required`, salvar não pode virar um no-op mudo.
    expect(host(fixture).querySelector('[data-block-error]')).not.toBeNull();
  });

  it('antes de tentar salvar, o bloco incompleto não vira banner', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();

    contactGroup(fixture).form.controls.contact.patchValue({ phone: '(11) 98765-4321' });
    fixture.detectChanges();

    expect(host(fixture).querySelector('[data-block-error]')).toBeNull();
  });

  it('erro da consulta de CEP não mata a assinatura: o CEP seguinte ainda busca', () => {
    configure(of(snapshotOf(EMPTY_COMPANY_CONTACT)));
    const fixture = render();
    // `CepService` hoje engole tudo, mas o contrato é dele — se ele deixar passar,
    // a fila não pode morrer pelo resto da vida do componente.
    lookupSpy.mockReturnValue(throwError(() => new Error('rede caiu')));

    typeCep(fixture, '99999-999');

    expect(host(fixture).querySelector('[data-cep-lookup-error]')).not.toBeNull();
    // Nada de "Buscando endereço…" congelado na tela.
    expect(host(fixture).textContent).not.toContain('Buscando endereço');

    lookupSpy.mockReturnValue(of(VIACEP_PAULISTA));
    typeCep(fixture, '0131010');
    typeCep(fixture, '01310-100');

    expect(contactGroup(fixture).form.controls.contact.getRawValue().addressStreet).toBe(
      'Avenida Paulista',
    );
  });

  it('falha no GET não rende formulário — editar às cegas apagaria o que está gravado', () => {
    configure(throwError(() => new HttpErrorResponse({ status: 404, error: {} })));
    const fixture = render();

    expect(host(fixture).querySelector('form')).toBeNull();
    expect(host(fixture).textContent).toContain('Tentar de novo');
  });
});
