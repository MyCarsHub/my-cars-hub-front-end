import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CompanySettings } from './company-settings';
import { CompanyService } from '../../services/company.service';
import { SessionService } from '../../services/session.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import { InvitesService } from '../../services/invites.service';
import { SERVER_ERROR_KEY } from '../../services/validation-messages';
import type { CompanyFullResponse } from '../../types/company-full-response.type';
import type { UpdateCompanyRequest } from '../../types/company-settings.types';

/**
 * `PUT /v1/companies/me`: name and document are both freely editable. The document may
 * move in any direction (CPF → CNPJ, CNPJ → CPF, CNPJ → another CNPJ) — there is no
 * locked state. CNPJ is alphanumeric since July 2026.
 *
 * The response masks `documentValue`, so the form must never round-trip it: an untouched
 * field sends `null`, which the backend reads as "keep the current document".
 */
describe('CompanySettings — edição dos dados da empresa', () => {
  /** CPFs / CNPJs válidos pelo mod 11 — os mesmos vetores usados no backend. */
  const CPF = '012.345.678-90';
  const CNPJ = '12.345.678/0001-95';
  const OTHER_CNPJ = '98.765.432/0001-98';
  const ALPHANUMERIC_CNPJ = '12.abc.345/01de-35';

  // Saída real de `PiiMask.maskDocument`: 11 posições → `***.***.**X-<2 últimos>`;
  // 14 posições → `**.***.***/****-<2 últimos>`.
  const COMPANY_CPF: CompanyFullResponse = {
    id: 'co-1',
    createdDate: '01/01/2025',
    modifyDate: '01/01/2025',
    name: 'Locadora Alfa',
    documentId: 'doc-1',
    documentType: 'CPF',
    documentValue: '***.***.**X-90',
    ownerUserId: 'user-1',
    status: 'ACTIVE',
  };

  const COMPANY_CNPJ: CompanyFullResponse = {
    ...COMPANY_CPF,
    documentId: 'doc-2',
    documentType: 'CNPJ',
    documentValue: '**.***.***/****-95',
  };

  let getInfoCompany: ReturnType<typeof vi.fn>;
  let updateCompany: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let session: Record<string, string>;

  /** The component surface the specs drive. Members are `protected` on purpose. */
  interface Harness {
    companyForm: FormGroup;
    save: () => void;
    saveError: () => string | null;
  }

  function configure(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CompanySettings],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: CompanyService,
          useValue: { getInfoCompany, updateCompany },
        },
        {
          provide: SessionService,
          useValue: {
            getItem: (key: string) => session[key] ?? null,
            setItem: (key: string, value: string) => {
              session[key] = value;
            },
          },
        },
        {
          // Only the pending-invite stat comes from here; the invite screens have their
          // own specs. Signals are inlined so the card renders a deterministic count.
          provide: InvitesService,
          useValue: {
            list: () => of([]),
            pendingCount: signal(0).asReadonly(),
            loaded: signal(true).asReadonly(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            success: notifySuccess,
            error: notifyError,
            warning: vi.fn(),
            info: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
  }

  function render(): { fixture: ComponentFixture<CompanySettings>; component: Harness } {
    configure();
    const fixture = TestBed.createComponent(CompanySettings);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance as unknown as Harness };
  }

  function documentInputOf(fixture: ComponentFixture<CompanySettings>): HTMLInputElement {
    const input = fixture.nativeElement.querySelector('#company-document');
    if (!(input instanceof HTMLInputElement)) throw new Error('campo de documento ausente');
    return input;
  }

  function payloadOf(call: number): UpdateCompanyRequest {
    return updateCompany.mock.calls[call][0] as UpdateCompanyRequest;
  }

  function fieldErrorOf(component: Harness, control: string): string | null {
    const errors = component.companyForm.get(control)?.errors ?? null;
    const serverError = errors?.[SERVER_ERROR_KEY] as { message?: string } | undefined;
    return serverError?.message ?? null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    session = {
      selectedCompanyId: 'co-1',
      selectedCompanyName: 'Locadora Alfa',
      userCompanies: JSON.stringify([
        { companyId: 'co-1', companyName: 'Locadora Alfa', role: 'OWNER' },
        { companyId: 'co-2', companyName: 'Outra Locadora', role: 'MANAGER' },
      ]),
    };
    getInfoCompany = vi.fn().mockReturnValue(of(COMPANY_CPF));
    updateCompany = vi.fn().mockReturnValue(of(COMPANY_CPF));
    notifySuccess = vi.fn();
    notifyError = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('não exibe nenhum aviso de documento travado', () => {
    const { fixture } = render();
    expect(fixture.nativeElement.textContent).not.toContain('não pode ser alterado');
    expect(fixture.nativeElement.textContent).not.toContain('fale com o suporte');
  });

  it('salva o nome e envia documentValue nulo quando nada foi digitado', () => {
    const updated: CompanyFullResponse = { ...COMPANY_CPF, name: 'Locadora Beta' };
    updateCompany.mockReturnValue(of(updated));

    const { fixture, component } = render();
    component.companyForm.get('name')?.setValue('locadora beta');
    component.save();
    fixture.detectChanges();

    expect(payloadOf(0)).toEqual({ name: 'locadora beta', documentValue: null });
    expect(notifySuccess).toHaveBeenCalledWith('Dados da empresa atualizados.');
    // O backend é dono da capitalização — a tela apenas renderiza o que voltou.
    expect(component.companyForm.get('name')?.value).toBe('Locadora Beta');
  });

  it('envia apenas os caracteres do documento quando o usuário digita um CNPJ mascarado', () => {
    updateCompany.mockReturnValue(of(COMPANY_CNPJ));

    const { component } = render();
    component.companyForm.get('documentValue')?.setValue(CNPJ);
    component.save();

    expect(payloadOf(0)).toEqual({ name: 'Locadora Alfa', documentValue: '12345678000195' });
  });

  it('aceita CNPJ alfanumérico e envia as letras em maiúsculo', () => {
    updateCompany.mockReturnValue(of(COMPANY_CNPJ));

    const { component } = render();
    component.companyForm.get('documentValue')?.setValue(ALPHANUMERIC_CNPJ);
    component.save();

    expect(component.companyForm.get('documentValue')?.errors).toBeNull();
    expect(payloadOf(0)).toEqual({ name: 'Locadora Alfa', documentValue: '12ABC34501DE35' });
  });

  it('nunca devolve o documento mascarado ao backend após um save', () => {
    updateCompany.mockReturnValue(of(COMPANY_CNPJ));

    const { fixture, component } = render();
    component.companyForm.get('documentValue')?.setValue(CNPJ);
    component.save();
    fixture.detectChanges();

    expect(component.companyForm.get('documentValue')?.value).toBe('');
    // Campo continua editável — nenhum estado travado após ganhar CNPJ.
    expect(documentInputOf(fixture).disabled).toBe(false);
  });

  it('bloqueia o formato inválido no cliente, sem chamar a API', () => {
    const { component } = render();
    component.companyForm.get('documentValue')?.setValue('123');
    component.save();

    expect(updateCompany).not.toHaveBeenCalled();
    expect(component.companyForm.get('documentValue')?.errors?.['documentShape']).toBe(true);
  });

  it('bloqueia dígitos verificadores errados no cliente, sem gastar um round-trip', () => {
    const { component } = render();
    // Forma correta (14 posições), mod 11 errado.
    component.companyForm.get('documentValue')?.setValue('12.345.678/0001-96');
    component.save();

    expect(updateCompany).not.toHaveBeenCalled();
    expect(component.companyForm.get('documentValue')?.errors?.['documentInvalid']).toBe(true);
    expect(component.companyForm.get('documentValue')?.errors?.['documentShape']).toBeUndefined();
  });

  it('bloqueia CPF com dígito verificador errado', () => {
    const { component } = render();
    component.companyForm.get('documentValue')?.setValue('012.345.678-91');
    component.save();

    expect(updateCompany).not.toHaveBeenCalled();
    expect(component.companyForm.get('documentValue')?.errors?.['documentInvalid']).toBe(true);
  });

  it('exige o nome da empresa antes de chamar a API', () => {
    const { component } = render();
    component.companyForm.get('name')?.setValue('');
    component.save();

    expect(updateCompany).not.toHaveBeenCalled();
    expect(component.companyForm.get('name')?.errors?.['required']).toBeTruthy();
  });

  it('mascara enquanto digita e mantém o cursor na posição editada', () => {
    const { fixture, component } = render();
    const input = documentInputOf(fixture);

    input.value = '12345678000195';
    input.setSelectionRange(4, 4);
    input.dispatchEvent(new Event('input'));

    expect(component.companyForm.get('documentValue')?.value).toBe(CNPJ);
    expect(input.selectionStart).toBe(5);
  });

  it('apaga o separador e o caractere anterior num único backspace', () => {
    const { fixture, component } = render();
    const input = documentInputOf(fixture);

    input.value = '12345678000195';
    input.setSelectionRange(14, 14);
    input.dispatchEvent(new Event('input'));

    // Backspace logo depois da "/": o navegador remove só a pontuação.
    input.value = '12.345.6780001-95';
    input.setSelectionRange(10, 10);
    input.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward' }));

    // O "8" antes da barra também sai — a tecla não fica morta. A máscara é
    // posicional, então o resto do documento desliza uma casa para a esquerda.
    const value = component.companyForm.get('documentValue')?.value as string;
    expect(value.replace(/[^0-9]/g, '')).toBe('1234567000195');
    expect(value).toBe('12.345.670/0019-5');
  });

  describe('cache do nome da empresa na sessão', () => {
    it('atualiza selectedCompanyName e userCompanies após renomear', () => {
      const updated: CompanyFullResponse = { ...COMPANY_CPF, name: 'Locadora Beta' };
      updateCompany.mockReturnValue(of(updated));

      const { component } = render();
      component.companyForm.get('name')?.setValue('locadora beta');
      component.save();

      expect(session['selectedCompanyName']).toBe('Locadora Beta');
      const companies = JSON.parse(session['userCompanies']) as { companyName: string }[];
      expect(companies[0].companyName).toBe('Locadora Beta');
      // A outra empresa do usuário não é tocada.
      expect(companies[1].companyName).toBe('Outra Locadora');
    });

    it('não quebra quando userCompanies está corrompido', () => {
      session['userCompanies'] = '{ nao é json';
      updateCompany.mockReturnValue(of({ ...COMPANY_CPF, name: 'Locadora Beta' }));

      const { component } = render();
      component.save();

      expect(session['selectedCompanyName']).toBe('Locadora Beta');
    });
  });

  describe('empresa que já tem CNPJ — documento continua editável', () => {
    beforeEach(() => {
      getInfoCompany = vi.fn().mockReturnValue(of(COMPANY_CNPJ));
    });

    it('renderiza o campo de documento normalmente', () => {
      const { fixture } = render();

      expect(documentInputOf(fixture)).toBeTruthy();
      expect(fixture.nativeElement.textContent).toContain('CNPJ');
    });

    it('permite trocar o CNPJ por outro CNPJ', () => {
      updateCompany.mockReturnValue(of(COMPANY_CNPJ));

      const { component } = render();
      component.companyForm.get('documentValue')?.setValue(OTHER_CNPJ);
      component.save();

      expect(payloadOf(0)).toEqual({ name: 'Locadora Alfa', documentValue: '98765432000198' });
    });

    it('permite voltar de CNPJ para CPF', () => {
      updateCompany.mockReturnValue(of(COMPANY_CPF));

      const { component } = render();
      component.companyForm.get('documentValue')?.setValue(CPF);
      component.save();

      expect(payloadOf(0)).toEqual({ name: 'Locadora Alfa', documentValue: '01234567890' });
    });

    it('continua permitindo editar o nome sem tocar no documento', () => {
      const { component } = render();
      component.companyForm.get('name')?.setValue('Locadora Gama');
      component.save();

      expect(payloadOf(0)).toEqual({ name: 'Locadora Gama', documentValue: null });
    });
  });

  describe('erros do backend', () => {
    function failWith(status: number, message: string, field?: string): HttpErrorResponse {
      const error = new HttpErrorResponse({
        status,
        error: field ? { message, fieldErrors: { [field]: message } } : { message },
      });
      updateCompany.mockReturnValue(throwError(() => error));
      return error;
    }

    it('400 documento inválido → inline no campo documentValue', () => {
      const message = 'Informe um CPF ou CNPJ válido.';
      const error = failWith(400, message, 'documentValue');

      const { fixture, component } = render();
      component.companyForm.get('documentValue')?.setValue(CNPJ);
      component.save();
      fixture.detectChanges();

      expect(fieldErrorOf(component, 'documentValue')).toBe(message);
      expect(component.saveError()).toBeNull();

      TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
      vi.runAllTimers();
      expect(notifyError).not.toHaveBeenCalled();
    });

    it('409 documento de outra empresa → inline no campo documentValue', () => {
      const message = 'Este documento já está cadastrado em outra empresa.';
      failWith(409, message, 'documentValue');

      const { fixture, component } = render();
      component.companyForm.get('documentValue')?.setValue(CNPJ);
      component.save();
      fixture.detectChanges();

      expect(fieldErrorOf(component, 'documentValue')).toBe(message);
      expect(component.saveError()).toBeNull();
    });

    it('409 documento de outra pessoa → inline no campo documentValue', () => {
      const message =
        'Este documento já está cadastrado para outra pessoa. Verifique o número informado.';
      failWith(409, message, 'documentValue');

      const { fixture, component } = render();
      component.companyForm.get('documentValue')?.setValue(CPF);
      component.save();
      fixture.detectChanges();

      expect(fieldErrorOf(component, 'documentValue')).toBe(message);
      expect(component.saveError()).toBeNull();
    });

    // 0 / 401 / 403 / 5xx já viram toast no `errorInterceptor`: repetir no banner
    // mostraria a mesma falha duas vezes.
    it('403 sem papel de OWNER → sem banner, o toast do interceptor basta', () => {
      const message = 'Apenas o OWNER da empresa pode alterar os dados cadastrais.';
      failWith(403, message);

      const { fixture, component } = render();
      component.save();
      fixture.detectChanges();

      expect(component.saveError()).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain(message);
    });

    it('404 empresa não encontrada → banner de formulário', () => {
      const message = 'Empresa não encontrada';
      failWith(404, message);

      const { fixture, component } = render();
      component.save();
      fixture.detectChanges();

      expect(component.saveError()).toBe(message);
      expect(fixture.nativeElement.textContent).toContain(message);
    });

    it('500 ao registrar o documento → sem banner, o toast do interceptor basta', () => {
      const message = 'Erro ao registrar o documento da empresa. Tente novamente.';
      failWith(500, message);

      const { fixture, component } = render();
      component.save();
      fixture.detectChanges();

      expect(component.saveError()).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain(message);
    });

    it('400 de validação do nome → inline no campo name', () => {
      const message = 'Dados de entrada inválidos';
      failWith(400, message, 'name');

      const { fixture, component } = render();
      component.save();
      fixture.detectChanges();

      expect(fieldErrorOf(component, 'name')).toBe(message);
    });
  });
});
