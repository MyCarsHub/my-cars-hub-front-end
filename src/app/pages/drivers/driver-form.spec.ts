import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of, EMPTY, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DriverForm } from './driver-form';
import { DriverService } from '../../services/driver.service';
import { CepService } from '../../services/cep.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { DriverResponse } from '../../types/driver.types';

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
