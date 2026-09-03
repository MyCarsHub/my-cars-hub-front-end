import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of, EMPTY, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Router } from '@angular/router';

import { DriverForm } from './driver-form';
import { DriverService } from '../../services/driver.service';
import { CepService } from '../../services/cep.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import type {
  CreateDriverRequest,
  DriverDocument,
  DriverDocumentKind,
  DriverResponse,
} from '../../types/driver.types';

/**
 * Covers the RG mask behavior:
 *  - typing 9 digits produces "XX.XXX.XXX-X" in the display signal;
 *  - the form control holds ONLY digits;
 *  - loading an existing driver with digits-only RG re-formats for display.
 */
describe('DriverForm — RG mask', () => {
  function configure(driver: DriverResponse | null): {
    createSpy: ReturnType<typeof vi.fn>;
    updateSpy: ReturnType<typeof vi.fn>;
  } {
    const createSpy = vi.fn().mockReturnValue(EMPTY);
    const updateSpy = vi.fn().mockReturnValue(EMPTY);
    const getOne = vi.fn().mockReturnValue(driver ? of(driver) : EMPTY);

    const activatedRoute = {
      snapshot: { paramMap: { get: (key: string) => (key === 'id' && driver ? driver.id : null) } },
    };

    TestBed.configureTestingModule({
      imports: [DriverForm],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: activatedRoute },
        { provide: DriverService, useValue: { getOne, create: createSpy, update: updateSpy } },
        { provide: CepService, useValue: { lookup: vi.fn().mockReturnValue(of(null)) } },
      ],
    });

    return { createSpy, updateSpy };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('formats display as XX.XXX.XXX-X while form control keeps only digits', () => {
    configure(null);
    const fixture = TestBed.createComponent(DriverForm);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      onRgInput: (e: Event) => void;
      rgDisplay: () => string;
      form: { get: (path: string) => { value: string } | null };
    };

    const input = document.createElement('input');
    input.value = '123456789';
    const evt = { target: input } as unknown as Event;
    component.onRgInput(evt);

    expect(component.rgDisplay()).toBe('12.345.678-9');
    expect(component.form.get('rg')?.value).toBe('123456789');
  });

  it('strips non-digits from pasted input and truncates at 10', () => {
    configure(null);
    const fixture = TestBed.createComponent(DriverForm);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      onRgInput: (e: Event) => void;
      rgDisplay: () => string;
      form: { get: (path: string) => { value: string } | null };
    };

    const input = document.createElement('input');
    input.value = '12.345.678-9AB99';
    component.onRgInput({ target: input } as unknown as Event);

    expect(component.form.get('rg')?.value).toBe('1234567899');
    expect(component.rgDisplay()).toBe('12.345.678-99');
  });

  it('formats display when loading an existing driver whose rg is digits-only', () => {
    const driver: DriverResponse = {
      id: 'drv-1',
      createdDate: '2025-01-01T00:00:00Z',
      modifyDate: null,
      companyId: 'co-1',
      userId: null,
      name: 'Fulano',
      rg: '123456789',
      document: { type: 'CPF', value: '52998224725' },
      address: {
        street: 'Rua A', number: '10', complement: null,
        district: 'Centro', cep: '01001000', city: 'SP', uf: 'SP',
      },
      contact: { email: 'a@b.com', phone: '11987654321' },
      licenseNumber: 'ABC12345678',
      licenseCategory: 'B',
      licenseExpiry: '2030-01-01',
      status: 'AVAILABLE',
      isAppDriver: false,
      thirdPartyContacts: [],
    };
    configure(driver);

    const fixture = TestBed.createComponent(DriverForm);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      rgDisplay: () => string;
      form: { get: (path: string) => { value: string } | null };
    };

    expect(component.rgDisplay()).toBe('12.345.678-9');
    expect(component.form.get('rg')?.value).toBe('123456789');
  });
});

/**
 * FEAT-0054 — anexos no CADASTRO do motorista, como elo filho do submit
 * (espelho de `vehicle-form.saveChildren()`):
 *  - os arquivos escolhidos sobem UM POR CHAMADA depois do POST /drivers;
 *  - falha de um anexo NÃO navega, avisa que o motorista JÁ foi salvo e
 *    promove `editingId` — o segundo submit faz PUT do MESMO motorista,
 *    nunca um segundo POST, e reenvia SÓ o que não subiu;
 *  - o bloco é decidido pela ROTA: some na edição, sobrevive à promoção.
 */
describe('DriverForm — anexos no cadastro (FEAT-0054)', () => {
  const savedDriver = { id: 'drv-9' } as DriverResponse;
  const uploadedDoc = { id: 'doc-1' } as DriverDocument;

  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let uploadDocument: ReturnType<typeof vi.fn>;
  let success: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<DriverForm>>;

  interface Access {
    submit: () => void;
    error: () => string | null;
    saving: () => boolean;
    canAttachDocuments: boolean;
    isEdit: () => boolean;
    pendingFiles: () => ReadonlyArray<{ file: File; sent: boolean }>;
    form: {
      patchValue: (v: unknown) => void;
      get: (path: string) => { disabled: boolean } | null;
    };
  }

  function component(): Access {
    return fixture.componentInstance as unknown as Access;
  }

  function configure(routeId: string | null = null): void {
    TestBed.resetTestingModule();
    create = vi.fn().mockReturnValue(of(savedDriver));
    update = vi.fn().mockReturnValue(of(savedDriver));
    uploadDocument = vi.fn().mockReturnValue(of(uploadedDoc));
    success = vi.fn();

    TestBed.configureTestingModule({
      imports: [DriverForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => routeId } } } },
        {
          provide: DriverService,
          useValue: { getOne: vi.fn().mockReturnValue(EMPTY), create, update, uploadDocument },
        },
        { provide: CepService, useValue: { lookup: vi.fn().mockReturnValue(of(null)) } },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success },
        },
      ],
    });

    navigate = vi.fn().mockResolvedValue(true);
    TestBed.inject(Router).navigate = navigate as unknown as Router['navigate'];

    fixture = TestBed.createComponent(DriverForm);
    fixture.detectChanges();
  }

  function fillValidForm(): void {
    component().form.patchValue({
      name: 'João da Silva',
      rg: '123456789',
      document: { type: 'CPF', value: '52998224725' },
      contact: { email: 'joao@empresa.com', phone: '11987654321' },
      address: { cep: '01001-000', street: 'Rua A', district: 'Centro', city: 'São Paulo', uf: 'SP' },
      licenseNumber: 'ABC12345678',
      licenseCategory: 'B',
      licenseExpiry: '2030-01-01',
      status: 'AVAILABLE',
    });
  }

  /**
   * O gesto completo do usuário no bloco COMPARTILHADO (FIX-0231): toca no
   * slot do tipo e escolhe o arquivo — duas interações de DOM de verdade. O
   * antigo atalho por método do form deixou de existir com a extração; o
   * caminho DOM prova o fio inteiro form → bloco → form.
   */
  function pick(kind: DriverDocumentKind, file: File): void {
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const slot = host.querySelector<HTMLButtonElement>(`[data-doc-slot="${kind}"] > button`);
    if (!slot) throw new Error(`slot ${kind} não está na tela`);
    slot.click();
    fixture.detectChanges();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('o seletor de arquivos não está na tela');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function submit(): void {
    component().submit();
    fixture.detectChanges();
  }

  beforeEach(() => {
    configure();
  });

  it('envia cada anexo pendente depois do POST e navega para o detalhe', () => {
    const cnh = new File(['a'], 'cnh-frente.jpg', { type: 'image/jpeg' });
    const proof = new File(['b'], 'conta-luz.pdf', { type: 'application/pdf' });
    pick('CNH', cnh);
    pick('ADDRESS_PROOF', proof);
    fillValidForm();

    submit();

    expect(create).toHaveBeenCalledTimes(1);
    expect(uploadDocument).toHaveBeenCalledTimes(2);
    expect(uploadDocument).toHaveBeenNthCalledWith(1, 'drv-9', 'CNH', cnh);
    expect(uploadDocument).toHaveBeenNthCalledWith(2, 'drv-9', 'ADDRESS_PROOF', proof);
    // Um único toast cobrindo motorista + anexos — nunca dois seguidos.
    expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('Motorista salvo e documentos enviados.');
    expect(navigate).toHaveBeenCalledWith(['/motoristas', 'drv-9']);
  });

  it('sem anexos, o fluxo antigo fica intacto: POST e navegação, nenhum upload', () => {
    fillValidForm();
    submit();

    expect(create).toHaveBeenCalledTimes(1);
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/motoristas', 'drv-9']);
  });

  it('falha de um anexo: motorista salvo é anunciado, sem navegar; o retry faz PUT (nunca 2º POST) e sobe só o que faltou', () => {
    const cnh = new File(['a'], 'cnh-frente.jpg', { type: 'image/jpeg' });
    const proof = new File(['b'], 'conta-luz.pdf', { type: 'application/pdf' });
    pick('CNH', cnh);
    pick('ADDRESS_PROOF', proof);
    fillValidForm();

    uploadDocument
      .mockReturnValueOnce(of(uploadedDoc))
      .mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'Falha no upload.' } })),
      );
    submit();

    // O POST passou e o segundo upload falhou: nada de navegação, banner com o aviso.
    expect(create).toHaveBeenCalledTimes(1);
    expect(uploadDocument).toHaveBeenCalledTimes(2);
    expect(navigate).not.toHaveBeenCalled();
    expect(component().saving()).toBe(false);
    expect(component().error()).toContain('O motorista foi salvo');
    // `editingId` promovido: o form virou edição do MESMO motorista.
    expect(component().isEdit()).toBe(true);
    // A promoção também trava o CPF/CNPJ: o retry faz PUT, que NÃO carrega
    // `document` — editável, uma alteração do usuário seria descartada em silêncio.
    expect(component().form.get('document')?.disabled).toBe(true);
    // O bloco de anexos não pode sumir com a promoção — é ele que carrega o retry.
    expect(component().canAttachDocuments).toBe(true);
    expect(fixture.nativeElement.querySelector('input[type="file"]')).not.toBeNull();

    uploadDocument.mockClear();
    uploadDocument.mockReturnValue(of(uploadedDoc));
    submit();

    // Segundo submit: PUT do mesmo motorista, nunca um segundo POST…
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBe('drv-9');
    // …e o reenvio sobe APENAS o anexo que tinha faltado.
    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect(uploadDocument).toHaveBeenCalledWith('drv-9', 'ADDRESS_PROOF', proof);
    expect(navigate).toHaveBeenCalledWith(['/motoristas', 'drv-9']);
  });

  it('recusa arquivo de tipo não permitido e acima de 20MB antes de qualquer envio', () => {
    pick('CNH', new File(['x'], 'virus.exe', { type: 'application/x-msdownload' }));
    expect(component().pendingFiles()).toHaveLength(0);
    expect(component().error()).toContain('Formato não suportado');

    const big = new File(['x'], 'cnh.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 });
    pick('CNH', big);
    expect(component().pendingFiles()).toHaveLength(0);
    expect(component().error()).toContain('limite é 20MB');
  });

  /**
   * FIX-0226 — UM arquivo por tipo: escolher de novo SUBSTITUI o pendente,
   * nunca acrescenta uma segunda linha. A CNH é um arquivo só (frente e verso
   * juntos), então "escolhi o errado" se resolve com um gesto, sem remover.
   */
  it('substitui o pendente ao escolher outro arquivo do mesmo tipo — nunca acrescenta', () => {
    const primeira = new File(['a'], 'cnh-tentativa.jpg', { type: 'image/jpeg' });
    const segunda = new File(['b'], 'cnh-final.jpg', { type: 'image/jpeg' });
    pick('CNH', primeira);
    pick('CNH', segunda);

    expect(component().pendingFiles()).toHaveLength(1);
    expect(component().pendingFiles()[0].file).toBe(segunda);
    expect(component().error()).toBeNull();

    // Outro tipo tem o próprio slot: a regra é POR TIPO, não global.
    pick('ADDRESS_PROOF', new File(['c'], 'conta-luz.pdf', { type: 'application/pdf' }));
    expect(component().pendingFiles()).toHaveLength(2);
  });

  /**
   * Depois da falha parcial o arquivo que JÁ subiu pertence ao motorista: o
   * slot dele tranca (nada de substituir — viraria um segundo anexo do mesmo
   * tipo no servidor). O que ainda não subiu continua substituível.
   */
  it('não substitui um arquivo já enviado; o pendente que faltou continua substituível', () => {
    const cnh = new File(['a'], 'cnh-frente.jpg', { type: 'image/jpeg' });
    const proof = new File(['b'], 'conta-luz.pdf', { type: 'application/pdf' });
    pick('CNH', cnh);
    pick('ADDRESS_PROOF', proof);
    fillValidForm();

    uploadDocument
      .mockReturnValueOnce(of(uploadedDoc))
      .mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'Falha.' } })),
      );
    submit();

    // CNH subiu (`sent`); tentar trocar não muda nada.
    pick('CNH', new File(['z'], 'cnh-outra.jpg', { type: 'image/jpeg' }));
    expect(component().pendingFiles()).toHaveLength(2);
    expect(component().pendingFiles()[0].sent).toBe(true);
    expect(component().pendingFiles()[0].file).toBe(cnh);

    // O comprovante que faltou não subiu: substituir continua valendo.
    const nova = new File(['n'], 'conta-agua.pdf', { type: 'application/pdf' });
    pick('ADDRESS_PROOF', nova);
    expect(component().pendingFiles()).toHaveLength(2);
    expect(component().pendingFiles()[1].file).toBe(nova);
  });

  it('na rota de edição o bloco de anexos não existe', () => {
    configure('drv-1');
    expect(component().canAttachDocuments).toBe(false);
    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Documentos (opcional)');
    fillValidForm();
    submit();
    expect(update).toHaveBeenCalledTimes(1);
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  // ------------------- título, posição e textos do bloco (FIX-0226/0228)

  /** Texto renderizado com o whitespace do template normalizado. */
  function pageText(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  /** FIX-0228: "Documentos (opcional)" (como no vehicle-form) e ANTES do Status. */
  it('no cadastro o card chama "Documentos (opcional)" e vem antes do Status', () => {
    const text = pageText();
    const docs = text.indexOf('Documentos (opcional)');
    const status = text.indexOf('Status');
    expect(docs).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(-1);
    expect(docs).toBeLessThan(status);
  });

  /** FIX-0226: descrição com o texto EXATO da regra de um arquivo por tipo. */
  it('descreve o bloco com o texto exato', () => {
    expect(pageText()).toContain(
      'Toque em um tipo para anexar os documentos do motorista. ' +
        'São aceitos PDF, JPG ou PNG até 20MB cada.',
    );
  });

  it('a dica da CNH diz exatamente "Frente e verso."', () => {
    expect(pageText()).toContain('Frente e verso.');
    expect(pageText()).not.toContain('dois arquivos');
  });

  /** O slot preenchido troca a afordância: "Anexar" vira "Substituir". */
  it('mostra "Substituir" no slot que já tem arquivo pendente', () => {
    expect(pageText()).not.toContain('Substituir');

    pick('CNH', new File(['a'], 'cnh.jpg', { type: 'image/jpeg' }));
    fixture.detectChanges();

    expect(pageText()).toContain('Substituir');
    // Os slots ainda vazios continuam com "Anexar".
    expect(pageText()).toContain('Anexar');
  });
});

/**
 * FEAT-0067 — contatos de terceiros no CADASTRO, DENTRO do POST /drivers
 * (nunca uma chamada separada):
 *  - até 3 blocos {nome, telefone}; o botão "+ Adicionar contato" desabilita no 3º;
 *  - cada bloco é individualmente removível; a ordem dos blocos É a ordem do payload;
 *  - telefone com a MESMA validação do telefone principal (10-11 dígitos, só números);
 *  - bloco meio-preenchido invalida o submit como qualquer outro campo;
 *  - a seção não existe na rota de edição (o PUT não carrega contatos).
 *
 * Interações pelo DOM real: cliques nos botões e `input` nos campos.
 */
describe('DriverForm — contatos de terceiros (FEAT-0067)', () => {
  const savedDriver = { id: 'drv-9' } as DriverResponse;

  /**
   * Motorista COMPLETO para a rota de edição. `getOne → EMPTY` deixaria
   * `loading()` preso em `true` e a tela no "Carregando…" — e aí o teste da
   * edição passaria VAZIO (a seção "não aparece" porque NADA aparece). Com um
   * driver de verdade o form renderiza e a ausência da seção prova o guard.
   * Tem um contato salvo DE PROPÓSITO: nem assim a seção pode aparecer.
   */
  const editDriver: DriverResponse = {
    id: 'drv-1',
    createdDate: '2025-01-01T00:00:00Z',
    modifyDate: null,
    companyId: 'co-1',
    userId: null,
    name: 'Fulano',
    rg: '123456789',
    document: { type: 'CPF', value: '52998224725' },
    address: {
      street: 'Rua A', number: '10', complement: null,
      district: 'Centro', cep: '01001000', city: 'SP', uf: 'SP',
    },
    contact: { email: 'a@b.com', phone: '11987654321' },
    licenseNumber: 'ABC12345678',
    licenseCategory: 'B',
    licenseExpiry: '2030-01-01',
    status: 'AVAILABLE',
    isAppDriver: false,
    thirdPartyContacts: [{ fullName: 'Maria da Silva', phone: '11987654321' }],
  };

  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<DriverForm>>;

  function configure(routeId: string | null = null): void {
    TestBed.resetTestingModule();
    create = vi.fn().mockReturnValue(of(savedDriver));
    update = vi.fn().mockReturnValue(of(savedDriver));

    TestBed.configureTestingModule({
      imports: [DriverForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => routeId } } } },
        {
          provide: DriverService,
          useValue: {
            // Na rota de edição o getOne EMITE — ver o comentário de `editDriver`.
            getOne: vi.fn().mockReturnValue(routeId ? of(editDriver) : EMPTY),
            create,
            update,
            uploadDocument: vi.fn().mockReturnValue(EMPTY),
          },
        },
        { provide: CepService, useValue: { lookup: vi.fn().mockReturnValue(of(null)) } },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    });

    navigate = vi.fn().mockResolvedValue(true);
    TestBed.inject(Router).navigate = navigate as unknown as Router['navigate'];

    fixture = TestBed.createComponent(DriverForm);
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function addButton(): HTMLButtonElement {
    const btn = Array.from(el().querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Adicionar contato'),
    );
    if (!btn) throw new Error('o botão "+ Adicionar contato" não está na tela');
    return btn;
  }

  function blocks(): HTMLElement[] {
    return Array.from(el().querySelectorAll<HTMLElement>('[data-contact-block]'));
  }

  function nameInput(i: number): HTMLInputElement {
    const input = el().querySelector<HTMLInputElement>(`#motorista-contato-terceiro-nome-${i}`);
    if (!input) throw new Error(`campo de nome do contato ${i} não está na tela`);
    return input;
  }

  function phoneInput(i: number): HTMLInputElement {
    const input = el().querySelector<HTMLInputElement>(
      `#motorista-contato-terceiro-telefone-${i}`,
    );
    if (!input) throw new Error(`campo de telefone do contato ${i} não está na tela`);
    return input;
  }

  function typeInto(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function addContact(): void {
    addButton().click();
    fixture.detectChanges();
  }

  function fillValidForm(): void {
    (
      fixture.componentInstance as unknown as { form: { patchValue: (v: unknown) => void } }
    ).form.patchValue({
      name: 'João da Silva',
      rg: '123456789',
      document: { type: 'CPF', value: '52998224725' },
      contact: { email: 'joao@empresa.com', phone: '11987654321' },
      address: { cep: '01001-000', street: 'Rua A', district: 'Centro', city: 'São Paulo', uf: 'SP' },
      licenseNumber: 'ABC12345678',
      licenseCategory: 'B',
      licenseExpiry: '2030-01-01',
      status: 'AVAILABLE',
    });
  }

  function submit(): void {
    (fixture.componentInstance as unknown as { submit: () => void }).submit();
    fixture.detectChanges();
  }

  beforeEach(() => {
    configure();
  });

  it('adiciona até 3 blocos e desabilita o botão no teto', () => {
    expect(blocks()).toHaveLength(0);

    addContact();
    addContact();
    expect(blocks()).toHaveLength(2);
    expect(addButton().disabled).toBe(false);

    addContact();
    expect(blocks()).toHaveLength(3);
    expect(addButton().disabled).toBe(true);
    expect(el().textContent).toContain('Limite de 3 contatos atingido');

    // O clique no botão desabilitado não passa do teto (guarda dupla no método).
    addButton().click();
    fixture.detectChanges();
    expect(blocks()).toHaveLength(3);
  });

  it('remove um bloco específico, preservando os demais, e reabilita o botão', () => {
    addContact();
    addContact();
    addContact();
    typeInto(nameInput(0), 'Primeiro Contato');
    typeInto(nameInput(1), 'Segundo Contato');
    typeInto(nameInput(2), 'Terceiro Contato');
    expect(addButton().disabled).toBe(true);

    blocks()[1]
      .querySelector<HTMLButtonElement>('button[aria-label="Remover contato 2"]')
      ?.click();
    fixture.detectChanges();

    expect(blocks()).toHaveLength(2);
    expect(nameInput(0).value).toBe('Primeiro Contato');
    expect(nameInput(1).value).toBe('Terceiro Contato');
    expect(addButton().disabled).toBe(false);
  });

  it('envia thirdPartyContacts DENTRO do POST, na ordem dos blocos e sem máscara', () => {
    fillValidForm();
    addContact();
    addContact();
    typeInto(nameInput(0), '  Maria da Silva  ');
    typeInto(phoneInput(0), '(11) 98765-4321');
    typeInto(nameInput(1), 'José Souza');
    typeInto(phoneInput(1), '1132654321');

    submit();

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0] as CreateDriverRequest;
    expect(payload.thirdPartyContacts).toEqual([
      { fullName: 'Maria da Silva', phone: '11987654321' },
      { fullName: 'José Souza', phone: '1132654321' },
    ]);
    expect(navigate).toHaveBeenCalledWith(['/motoristas', 'drv-9']);
  });

  it('sem contatos, o POST leva a lista vazia (nunca null)', () => {
    fillValidForm();
    submit();

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0] as CreateDriverRequest;
    expect(payload.thirdPartyContacts).toEqual([]);
  });

  it('bloco meio-preenchido invalida o submit como qualquer outro campo', () => {
    fillValidForm();
    addContact();
    typeInto(nameInput(0), 'Maria da Silva'); // telefone fica vazio

    submit();

    expect(create).not.toHaveBeenCalled();
    expect(el().textContent).toContain('Verifique os campos destacados');
  });

  it('o telefone do contato guarda só dígitos e mostra a mesma máscara do principal', () => {
    addContact();
    typeInto(phoneInput(0), '(11) 9x876-5a43z21');

    expect(phoneInput(0).value).toBe('(11) 98765-4321');
  });

  it('na rota de edição a seção não existe, mesmo com contato salvo no motorista', () => {
    configure('drv-1');

    // O form de edição RENDERIZOU de verdade — sem isso a asserção de ausência
    // passaria vazia com a tela presa no "Carregando…".
    expect(el().textContent).not.toContain('Carregando…');
    expect(el().textContent).toContain('Carteira de habilitação');
    expect(el().textContent).toContain('Editar motorista');

    // E a seção de contatos não aparece, embora `editDriver` tenha um contato.
    expect(el().textContent).not.toContain('Contatos de terceiros');
    expect(el().querySelector('[data-contact-block]')).toBeNull();
  });
});

/**
 * Feedback standard (phase 3): a backend `fieldErrors.licenseNumber` (CNH already
 * registered) must render INLINE under the CNH field, must NOT be repeated in the
 * form banner, and must NEVER produce a toast.
 */
describe('DriverForm — erros de campo vindos do backend', () => {
  let create: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<DriverForm>>;

  function licenseError(): HTMLElement | null {
    return fixture.nativeElement.querySelector('#motorista-cnh-error');
  }

  function documentError(): HTMLElement | null {
    return fixture.nativeElement.querySelector('#motorista-doc-valor-error');
  }

  function formOf(): { get: (path: string) => { errors: Record<string, unknown> | null } | null } {
    return (
      fixture.componentInstance as unknown as {
        form: { get: (path: string) => { errors: Record<string, unknown> | null } | null };
      }
    ).form;
  }

  function fillValidForm(): void {
    const form = (
      fixture.componentInstance as unknown as { form: { patchValue: (v: unknown) => void } }
    ).form;
    form.patchValue({
      name: 'João da Silva',
      rg: '123456789',
      document: { type: 'CPF', value: '52998224725' },
      contact: { email: 'joao@empresa.com', phone: '11987654321' },
      address: {
        cep: '01001-000',
        street: 'Rua A',
        district: 'Centro',
        city: 'São Paulo',
        uf: 'SP',
      },
      licenseNumber: 'ABC12345678',
      licenseCategory: 'B',
      licenseExpiry: '2030-01-01',
      status: 'AVAILABLE',
    });
  }

  function submit(): void {
    (fixture.componentInstance as unknown as { submit: () => void }).submit();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    create = vi.fn();
    notifyError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [DriverForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
        { provide: DriverService, useValue: { getOne: vi.fn(), create, update: vi.fn() } },
        { provide: CepService, useValue: { lookup: vi.fn().mockReturnValue(of(null)) } },
        {
          provide: NotificationService,
          useValue: { error: notifyError, warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DriverForm);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra a CNH duplicada embaixo do campo, sem banner e sem toast', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: {
        message: 'CNH já cadastrada para esta empresa.',
        fieldErrors: { licenseNumber: 'CNH já cadastrada para esta empresa.' },
      },
    });
    create.mockReturnValue(throwError(() => error));

    fillValidForm();
    submit();

    const inline = licenseError();
    expect(inline).not.toBeNull();
    expect(inline?.textContent?.trim()).toBe('CNH já cadastrada para esta empresa.');
    expect(inline?.getAttribute('role')).toBe('alert');

    const input = fixture.nativeElement.querySelector('#motorista-cnh') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('motorista-cnh-error');

    // não duplicado no banner do formulário
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();

    // e nunca toast — a rede de segurança do interceptor fica quieta
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('mostra erro de negócio sem campo no banner do formulário', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { message: 'Limite de motoristas do plano atingido.' },
    });
    create.mockReturnValue(throwError(() => error));

    fillValidForm();
    submit();

    expect(fixture.nativeElement.innerHTML).toContain('Limite de motoristas do plano atingido.');
    expect(licenseError()).toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
  });

  /**
   * Regressão: 409 de CPF duplicado. O documento mora em `document: { type, value }`,
   * então a única chave que casa com um control renderizado é o caminho COMPLETO
   * `document.value` — mesmo precedente de `address.zipCode` (api-error.spec.ts:24-31)
   * e `licenseNumber` (acima). Com ela, o erro aparece embaixo do campo do CPF.
   */
  it('mostra o CPF duplicado embaixo do campo quando a chave é document.value', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: {
        message: 'CPF já cadastrado para esta empresa.',
        fieldErrors: { 'document.value': 'CPF já cadastrado para esta empresa.' },
      },
    });
    create.mockReturnValue(throwError(() => error));

    fillValidForm();
    submit();

    const inline = documentError();
    expect(inline).not.toBeNull();
    expect(inline?.textContent?.trim()).toBe('CPF já cadastrado para esta empresa.');
    expect(inline?.getAttribute('role')).toBe('alert');

    const input = fixture.nativeElement.querySelector('#motorista-doc-valor') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('motorista-doc-valor-error');

    // shape 2 do contrato: já mostrado inline, não repete no banner
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();

    // e nunca toast — a rede de segurança do interceptor fica quieta
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  /**
   * DOCUMENTA O MODO DE FALHA — não é o comportamento desejado, é o registro de por que
   * a chave precisa ser o caminho completo (`document.value`).
   *
   * Com a chave curta `document`, `root.get('document')` resolve para o FormGroup
   * `document` (api-error.ts:113). O `applyFieldErrors` considera isso um match, seta o
   * `serverError` NO GRUPO — que nenhum `<app-form-field>` binda — e deixa `unmatched`
   * vazio, o que faz o `formLevelMessage` devolver `null` (api-error.ts:181). Resultado:
   * o usuário não vê NADA, nem inline nem banner. Se alguém reverter a chave no backend
   * para `document`, este teste continua verde mas conta a história; o teste acima
   * (`document.value`) é o que quebra.
   */
  it('não liga o erro a nenhum campo visível quando a chave é o grupo `document` (formato antigo)', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: {
        message: 'CPF já cadastrado para esta empresa.',
        fieldErrors: { document: 'CPF já cadastrado para esta empresa.' },
      },
    });
    create.mockReturnValue(throwError(() => error));

    fillValidForm();
    submit();

    // nada embaixo do campo do CPF…
    expect(documentError()).toBeNull();
    const input = fixture.nativeElement.querySelector('#motorista-doc-valor') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBeNull();

    // …e nada no banner: `unmatched` ficou vazio porque o get() casou com o FormGroup
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
    expect(fixture.nativeElement.innerHTML).not.toContain('CPF já cadastrado para esta empresa.');

    // a prova do engolimento: o serverError foi parar no grupo, que ninguém renderiza
    expect(formOf().get('document')?.errors?.['serverError']).toEqual({
      message: 'CPF já cadastrado para esta empresa.',
    });
    expect(formOf().get('document.value')?.errors?.['serverError']).toBeUndefined();

    // e o toast também não salva: a tela reivindicou o erro via handleForm()
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
