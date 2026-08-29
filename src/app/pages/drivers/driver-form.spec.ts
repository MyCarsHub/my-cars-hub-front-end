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
import type { DriverDocument, DriverDocumentKind, DriverResponse } from '../../types/driver.types';

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
    openDocPicker: (kind: DriverDocumentKind) => void;
    onDocFileSelected: (e: Event) => void;
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

  function pick(kind: DriverDocumentKind, file: File): void {
    component().openDocPicker(kind);
    component().onDocFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
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

  it('ignora o mesmo arquivo escolhido duas vezes no mesmo tipo', () => {
    const cnh = new File(['a'], 'cnh-frente.jpg', { type: 'image/jpeg' });
    pick('CNH', cnh);
    pick('CNH', new File(['a'], 'cnh-frente.jpg', { type: 'image/jpeg' }));

    expect(component().pendingFiles()).toHaveLength(1);
    expect(component().error()).toContain('já está na lista');

    // Mesmo nome sob OUTRO tipo continua valendo — a identidade inclui o kind.
    pick('ADDRESS_PROOF', new File(['a'], 'cnh-frente.jpg', { type: 'image/jpeg' }));
    expect(component().pendingFiles()).toHaveLength(2);
  });

  it('na rota de edição o bloco de anexos não existe', () => {
    configure('drv-1');
    expect(component().canAttachDocuments).toBe(false);
    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeNull();
    fillValidForm();
    submit();
    expect(update).toHaveBeenCalledTimes(1);
    expect(uploadDocument).not.toHaveBeenCalled();
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
