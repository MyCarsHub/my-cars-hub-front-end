import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CompanySettings } from './company-settings';
import { CompanyService } from '../../services/company.service';
import { SessionService } from '../../services/session.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
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
    editing: () => boolean;
    startEdit: () => void;
    cancelEdit: () => void;
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

  /**
   * O cartão institucional abre em leitura — os campos só existem no DOM depois do
   * "Editar". Specs que tocam em `input`/`#company-name` passam por aqui.
   *
   * `startEdit` sincroniza o formulário com a empresa carregada, então qualquer
   * `setValue` do teste vem DEPOIS desta chamada, nunca antes.
   */
  function renderEditing(): { fixture: ComponentFixture<CompanySettings>; component: Harness } {
    const rendered = render();
    rendered.component.startEdit();
    rendered.fixture.detectChanges();
    return rendered;
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
      // A rota é OWNER-only, então OWNER é o único papel que a página vê na
      // prática. Os testes que montam com MANAGER são defesa em profundidade.
      selectedRole: 'OWNER',
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

    const { fixture, component } = renderEditing();
    component.companyForm.get('documentValue')?.setValue(CNPJ);
    component.save();
    fixture.detectChanges();

    expect(component.companyForm.get('documentValue')?.value).toBe('');
    // Campo continua editável — nenhum estado travado após ganhar CNPJ.
    component.startEdit();
    fixture.detectChanges();
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
    const { fixture, component } = renderEditing();
    const input = documentInputOf(fixture);

    input.value = '12345678000195';
    input.setSelectionRange(4, 4);
    input.dispatchEvent(new Event('input'));

    expect(component.companyForm.get('documentValue')?.value).toBe(CNPJ);
    expect(input.selectionStart).toBe(5);
  });

  it('apaga o separador e o caractere anterior num único backspace', () => {
    const { fixture, component } = renderEditing();
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
      const { fixture } = renderEditing();

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

  /**
   * O avatar do proprietário era um disco laranja SEM filho nenhum — na tela lia como
   * imagem quebrada. Ele agora carrega as iniciais, e some quando não há nome.
   */
  describe('avatar do proprietário', () => {
    function avatarOf(fixture: ComponentFixture<CompanySettings>): HTMLElement | null {
      return (fixture.nativeElement as HTMLElement).querySelector('[data-owner-avatar]');
    }

    it('mostra as iniciais do primeiro e do último nome', () => {
      session['name'] = 'Lorran Sarmento Santos';
      const { fixture } = render();

      expect(avatarOf(fixture)?.textContent?.trim()).toBe('LS');
    });

    it('usa uma única letra quando o nome tem só uma palavra', () => {
      session['name'] = 'lorran';
      const { fixture } = render();

      expect(avatarOf(fixture)?.textContent?.trim()).toBe('L');
    });

    it('não desenha o círculo quando não há nome na sessão', () => {
      const { fixture } = render();

      expect(avatarOf(fixture)).toBeNull();
    });
  });

  /**
   * Sem dados carregados a tela mostrava um rótulo órfão ("Data de fundação" sem valor)
   * e um selo de status vazio — uma lasca verde de ~28x8px.
   */
  describe('estado vazio', () => {
    it('omite data de fundação, status e "desde" enquanto o GET não voltou', () => {
      getInfoCompany = vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      const { fixture } = render();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

      expect(text).not.toContain('Data de fundação');
      expect(text).not.toContain('Status da conta');
      expect(text).not.toContain('No MyCarsHub desde');
    });

    it('mostra as três linhas quando a empresa carrega', () => {
      const { fixture } = render();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

      expect(text).toContain('Data de fundação');
      expect(text).toContain('ACTIVE');
      expect(text).toContain('No MyCarsHub desde');
    });
  });

  /**
   * O cartão institucional abre em SOMENTE-LEITURA. Nome e documento só viram campo
   * depois do "Editar"; "Cancelar" descarta o que foi digitado e volta para leitura.
   *
   * Nada disso toca em validador, payload ou endpoint — os specs de save acima
   * continuam valendo palavra por palavra.
   */
  describe('leitura por padrão, edição sob demanda', () => {
    function host(fixture: ComponentFixture<CompanySettings>): HTMLElement {
      return fixture.nativeElement as HTMLElement;
    }

    function editToggleOf(fixture: ComponentFixture<CompanySettings>): HTMLButtonElement {
      const button = host(fixture).querySelector('[data-edit-toggle]');
      if (!(button instanceof HTMLButtonElement)) throw new Error('botão "Editar" ausente');
      return button;
    }

    function submitOf(fixture: ComponentFixture<CompanySettings>): HTMLElement | null {
      return host(fixture).querySelector('button[type="submit"]');
    }

    function cancelOf(fixture: ComponentFixture<CompanySettings>): HTMLButtonElement {
      const buttons = Array.from(host(fixture).querySelectorAll('button[type="button"]'));
      const cancel = buttons.find((b) => (b.textContent ?? '').trim() === 'Cancelar');
      if (!(cancel instanceof HTMLButtonElement)) throw new Error('botão "Cancelar" ausente');
      return cancel;
    }

    function retryOf(fixture: ComponentFixture<CompanySettings>): HTMLButtonElement {
      const buttons = Array.from(host(fixture).querySelectorAll('button[type="button"]'));
      const retry = buttons.find((b) => (b.textContent ?? '').trim() === 'Tentar de novo');
      if (!(retry instanceof HTMLButtonElement)) throw new Error('botão "Tentar de novo" ausente');
      return retry;
    }

    it('abre em leitura: sem campos, sem submit, com o botão "Editar"', () => {
      const { fixture, component } = render();

      expect(component.editing()).toBe(false);
      expect(host(fixture).querySelector('#company-name')).toBeNull();
      expect(host(fixture).querySelector('#company-document')).toBeNull();
      // Um submit visível sem nada para submeter é o que fazia a tela parecer inacabada.
      expect(submitOf(fixture)).toBeNull();
      expect(editToggleOf(fixture).textContent?.trim()).toContain('Editar');
    });

    it('em leitura mostra nome e documento como valor, no tratamento de legenda da página', () => {
      const { fixture } = render();
      const text = host(fixture).textContent ?? '';

      expect(text).toContain('Nome da empresa');
      expect(text).toContain('Locadora Alfa');
      expect(text).toContain('Documento');
      expect(text).toContain('CPF · ***.***.**X-90');
      // "Alterar documento" é rótulo de campo — não pode vazar para o modo de leitura.
      expect(text).not.toContain('Alterar documento');
    });

    it('clicar em "Editar" revela os campos e o par Salvar/Cancelar', () => {
      const { fixture, component } = render();

      editToggleOf(fixture).click();
      fixture.detectChanges();

      expect(component.editing()).toBe(true);
      expect(host(fixture).querySelector('#company-name')).not.toBeNull();
      expect(host(fixture).querySelector('#company-document')).not.toBeNull();
      expect(submitOf(fixture)).not.toBeNull();
      expect(cancelOf(fixture)).not.toBeNull();
      // O gatilho sai de cena enquanto o formulário está aberto.
      expect(host(fixture).querySelector('[data-edit-toggle]')).toBeNull();
    });

    it('o gatilho "Editar" não submete o formulário', () => {
      const { fixture } = render();

      expect(editToggleOf(fixture).type).toBe('button');

      editToggleOf(fixture).click();
      fixture.detectChanges();

      expect(updateCompany).not.toHaveBeenCalled();
    });

    it('"Cancelar" restaura o nome digitado e volta para leitura', () => {
      const { fixture, component } = renderEditing();
      component.companyForm.get('name')?.setValue('Nome Rascunho');
      fixture.detectChanges();

      cancelOf(fixture).click();
      fixture.detectChanges();

      expect(component.editing()).toBe(false);
      expect(updateCompany).not.toHaveBeenCalled();
      // Volta ao valor da empresa carregada, não ao rascunho.
      expect(component.companyForm.get('name')?.value).toBe('Locadora Alfa');
      expect(host(fixture).textContent).toContain('Locadora Alfa');
      expect(host(fixture).textContent).not.toContain('Nome Rascunho');
    });

    it('"Cancelar" descarta o documento digitado — reabrir a edição mostra o campo vazio', () => {
      const { fixture, component } = renderEditing();
      component.companyForm.get('documentValue')?.setValue(CNPJ);

      cancelOf(fixture).click();
      fixture.detectChanges();

      editToggleOf(fixture).click();
      fixture.detectChanges();

      expect(component.companyForm.get('documentValue')?.value).toBe('');
      expect(documentInputOf(fixture).value).toBe('');
    });

    it('"Cancelar" limpa o erro da tentativa anterior', () => {
      updateCompany.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({ status: 404, error: { message: 'Empresa não encontrada' } }),
        ),
      );

      const { fixture, component } = renderEditing();
      component.save();
      fixture.detectChanges();
      expect(component.saveError()).toBe('Empresa não encontrada');

      cancelOf(fixture).click();
      fixture.detectChanges();

      expect(component.saveError()).toBeNull();
      expect(host(fixture).querySelector('[data-save-error]')).toBeNull();
    });

    it('"Cancelar" não deixa a marcação de inválido do save anterior grudada no campo', () => {
      const { fixture, component } = renderEditing();
      component.companyForm.get('name')?.setValue('');
      component.save();
      fixture.detectChanges();
      expect(component.companyForm.get('name')?.touched).toBe(true);

      cancelOf(fixture).click();
      component.startEdit();
      fixture.detectChanges();

      expect(component.companyForm.get('name')?.touched).toBe(false);
      expect(host(fixture).querySelector('[aria-invalid="true"]')).toBeNull();
    });

    it('um save bem-sucedido volta sozinho para leitura', () => {
      updateCompany.mockReturnValue(of({ ...COMPANY_CPF, name: 'Locadora Beta' }));

      const { fixture, component } = renderEditing();
      component.companyForm.get('name')?.setValue('Locadora Beta');
      component.save();
      fixture.detectChanges();

      expect(component.editing()).toBe(false);
      expect(host(fixture).querySelector('#company-name')).toBeNull();
      expect(host(fixture).textContent).toContain('Locadora Beta');
    });

    it('um save que falha MANTÉM o formulário aberto, com o que o usuário digitou', () => {
      updateCompany.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({ status: 404, error: { message: 'Empresa não encontrada' } }),
        ),
      );

      const { fixture, component } = renderEditing();
      component.companyForm.get('name')?.setValue('Locadora Beta');
      component.save();
      fixture.detectChanges();

      expect(component.editing()).toBe(true);
      expect(host(fixture).querySelector('#company-name')).not.toBeNull();
      expect(component.companyForm.get('name')?.value).toBe('Locadora Beta');
    });

    /**
     * Sem empresa carregada o modo de leitura não pode virar uma pilha de legendas
     * sem valor — é o mesmo endurecimento de "Data de fundação" / "Status da conta".
     */
    it('sem empresa carregada, leitura não mostra legenda órfã de nome nem de documento', () => {
      getInfoCompany = vi
        .fn()
        .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      const { fixture } = render();
      const text = host(fixture).textContent ?? '';

      expect(text).not.toContain('Nome da empresa');
      expect(text).not.toContain('Documento');
    });

    it('empresa sem documento mostra a frase explícita, não uma legenda vazia', () => {
      getInfoCompany = vi.fn().mockReturnValue(of({ ...COMPANY_CPF, documentValue: '' }));

      const { fixture } = render();

      expect(host(fixture).textContent).toContain('Nenhum documento cadastrado');
    });

    it('"Documento atual" em edição sai da mesma fonte do modo de leitura', () => {
      getInfoCompany = vi.fn().mockReturnValue(of({ ...COMPANY_CPF, documentValue: '' }));

      const { fixture } = renderEditing();

      // Era a mesma regra escrita duas vezes no template; agora é `documentSummary()`
      // nos dois modos, então elas não têm como divergir.
      expect(host(fixture).textContent).toContain('Documento atual');
      expect(host(fixture).textContent).toContain('Nenhum documento cadastrado');
    });

    /**
     * Sem empresa carregada NÃO pode haver "Editar": o formulário abriria com o nome
     * vazio e o "Salvar" mandaria um `PUT` de renomeação montado sobre dados que o
     * usuário nunca viu. Mesma recusa de `company-contact`.
     */
    describe('sem dados carregados não há edição', () => {
      it('GET que falha não oferece o gatilho "Editar"', () => {
        getInfoCompany = vi
          .fn()
          .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

        const { fixture } = render();

        expect(host(fixture).querySelector('[data-edit-toggle]')).toBeNull();
        expect(host(fixture).querySelector('#company-name')).toBeNull();
        expect(submitOf(fixture)).toBeNull();
      });

      it('o estado de erro oferece "Tentar de novo", e o retry refaz o GET', () => {
        getInfoCompany = vi
          .fn()
          .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
          .mockReturnValue(of(COMPANY_CPF));

        const { fixture } = render();
        expect(host(fixture).querySelector('[data-edit-toggle]')).toBeNull();

        retryOf(fixture).click();
        fixture.detectChanges();

        expect(getInfoCompany).toHaveBeenCalledTimes(2);
        expect(host(fixture).textContent).toContain('Locadora Alfa');
        // Com os dados na mão o gatilho volta — e o banner de erro sai de cena.
        expect(host(fixture).querySelector('[data-edit-toggle]')).not.toBeNull();
        expect(host(fixture).textContent).not.toContain('Tentar de novo');
      });

      /**
       * A corrida entre `applyCompany()` e o que está sendo digitado morre aqui: entrar
       * em edição EXIGE `companyInfo()`, e quem o preenche é justamente o retorno do
       * GET. Não existe estado "formulário aberto com GET em voo" para sobrescrever.
       */
      it('enquanto o GET não respondeu não há gatilho — nem janela para o patchValue atropelar', () => {
        const pending = new Subject<CompanyFullResponse>();
        getInfoCompany = vi.fn().mockReturnValue(pending.asObservable());

        const { fixture, component } = render();

        expect(component.editing()).toBe(false);
        expect(host(fixture).querySelector('[data-edit-toggle]')).toBeNull();

        pending.next(COMPANY_CPF);
        pending.complete();
        fixture.detectChanges();

        expect(host(fixture).querySelector('[data-edit-toggle]')).not.toBeNull();
      });
    });

    /**
     * O foco é a justificativa de acessibilidade da troca de modo: o gatilho e os campos
     * se substituem no mesmo frame, então sem mover o foco de propósito ele cai no
     * `<body>` e o leitor de tela perde o contexto. Timers REAIS — `afterNextRender`
     * depende de `whenStable`, o mesmo par de `onboarding-container.spec.ts`.
     */
    describe('foco ao trocar de modo', () => {
      beforeEach(() => {
        vi.useRealTimers();
      });

      it('"Editar" leva o foco para o campo de nome', async () => {
        const { fixture } = render();

        editToggleOf(fixture).click();
        fixture.detectChanges();
        await fixture.whenStable();

        const nameInput = host(fixture).querySelector('#company-name');
        expect(nameInput).not.toBeNull();
        expect(document.activeElement).toBe(nameInput);
      });

      it('"Cancelar" devolve o foco ao gatilho "Editar"', async () => {
        const { fixture } = render();
        editToggleOf(fixture).click();
        fixture.detectChanges();
        await fixture.whenStable();

        cancelOf(fixture).click();
        fixture.detectChanges();
        await fixture.whenStable();

        // O gatilho é um elemento NOVO — o `@if` o recriou ao voltar para leitura.
        expect(document.activeElement).toBe(editToggleOf(fixture));
      });

      it('um save bem-sucedido também devolve o foco ao gatilho', async () => {
        updateCompany.mockReturnValue(of({ ...COMPANY_CPF, name: 'Locadora Beta' }));

        const { fixture, component } = render();
        editToggleOf(fixture).click();
        fixture.detectChanges();
        await fixture.whenStable();

        component.save();
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.editing()).toBe(false);
        expect(document.activeElement).toBe(editToggleOf(fixture));
      });
    });
  });

  /**
   * A ordem dos cartões é a ordem do DOM — não há array de abas nem config. Como o
   * mobile mostra tudo numa coluna só, a ordem do DOM É a ordem que o celular vê,
   * então ela é comportamento e fica travada por spec.
   */
  describe('ordem dos cartões', () => {
    function cardTitles(fixture: ComponentFixture<CompanySettings>): string[] {
      const host = fixture.nativeElement as HTMLElement;
      return Array.from(host.querySelectorAll('app-page-card h2')).map((h) =>
        (h.textContent ?? '').trim(),
      );
    }

    it('OWNER: Informações Institucionais → Contato → Integrações', () => {
      const { fixture } = render();

      expect(cardTitles(fixture).slice(0, 3)).toEqual([
        'Informações Institucionais',
        'Contato',
        'Integrações',
      ]);
    });

    it('MANAGER: só Integrações, sem cartão institucional nem de contato', () => {
      session['selectedRole'] = 'MANAGER';
      const { fixture } = render();

      expect(cardTitles(fixture)).toEqual(['Integrações']);
    });

    it('não sobrou nada da antiga seção "Devolução com atraso"', () => {
      const { fixture } = render();
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('app-overdue-fee')).toBeNull();
      expect(host.textContent).not.toContain('Devolução com atraso');
    });
  });

  /**
   * A rota é OWNER-only — quem garante isso é o `roleGuard` de `/configuracoes`
   * (coberto em `app.routes.roles.spec.ts`), não este template. O MANAGER não
   * chega mais aqui: a regra de multa por atraso, único motivo para ele entrar,
   * saiu do produto.
   *
   * O template mantém o recorte por papel como defesa em profundidade, para o
   * caso de alguém afrouxar o guard. É isso — e só isso — que o teste de
   * MANAGER abaixo cobre; ele não descreve um caminho que o produto ofereça.
   */
  describe('papéis', () => {
    it('OWNER vê o formulário da empresa e o atalho de contato', () => {
      const { fixture } = renderEditing();
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('#company-name')).not.toBeNull();
      expect(host.querySelector('a[href="/configuracoes/contato"]')).not.toBeNull();
      expect(getInfoCompany).toHaveBeenCalled();
    });

    it('defesa em profundidade: MANAGER que burlasse o guard não veria empresa nem contato', () => {
      session['selectedRole'] = 'MANAGER';

      const { fixture } = render();
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('#company-name')).toBeNull();
      expect(host.querySelector('a[href="/configuracoes/contato"]')).toBeNull();
      // Nem o gatilho de edição: para o MANAGER o cartão inteiro não existe, e não
      // apenas os campos (que em leitura estariam ausentes de qualquer jeito).
      expect(host.querySelector('[data-edit-toggle]')).toBeNull();
      // Sem formulário não há o que preencher — e o GET pode voltar 403.
      expect(getInfoCompany).not.toHaveBeenCalled();
    });

    // O produto está refazendo o fluxo de convites e tirou os pontos de entrada da UI:
    // o cartão Equipe saiu daqui inteiro. A rota `configuracoes/convites` continua
    // existindo (coberta em `app.routes.roles.spec.ts`) — só o atalho foi removido.
    it('OWNER vê o atalho de Asaas e nenhum atalho de Convites', () => {
      const owner = render().fixture.nativeElement as HTMLElement;
      expect(owner.querySelector('a[href="/configuracoes/integracoes/asaas"]')).not.toBeNull();
      expect(owner.querySelector('a[href="/configuracoes/convites"]')).toBeNull();
      expect(owner.textContent).not.toContain('Convites');
      expect(owner.textContent).not.toContain('Equipe');
    });
  });
});
