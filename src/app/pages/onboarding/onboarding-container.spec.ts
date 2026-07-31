import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { AbstractControl, FormGroup } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { OnboardingContainer } from './onboarding-container';
import { OnboardingService } from './onboarding.service';
import { AuthService } from '../../services/auth.service';
import { LayoutStore } from '../../components/core/layouts/layout.store';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import { SessionService } from '../../services/session.service';
import { SERVER_ERROR_KEY } from '../../services/validation-messages';
import type { OnboardingState } from './onboarding.types';

/**
 * Passo 3 (documento): a disponibilidade do CNPJ é conferida ANTES de salvar a etapa,
 * para o usuário não descobrir o problema só em "Finalizar", quando a transação inteira
 * é abortada. A checagem é consultiva — o gatilho no banco continua sendo a garantia.
 */
describe('OnboardingContainer — disponibilidade do CNPJ no passo 3', () => {
  const CNPJ = '12345678000195';

  let checkCnpjAvailability: ReturnType<typeof vi.fn>;
  let saveStep: ReturnType<typeof vi.fn>;
  let loading: ReturnType<typeof signal<boolean>>;
  let checkingCnpj: ReturnType<typeof signal<boolean>>;

  interface Harness {
    onNext: () => void;
    error: () => string | null;
  }

  const state: OnboardingState = {
    step: 3,
    isCompleted: false,
    data: { name: 'Ada', companyName: 'Locadora Alfa', hasCnpj: true, cnpj: CNPJ },
  };

  function render(): { fixture: ComponentFixture<OnboardingContainer>; component: Harness } {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [OnboardingContainer],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: OnboardingService,
          useValue: {
            loading,
            checkingCnpj,
            loadError: signal<string | null>(null),
            currentStep: signal(3),
            totalSteps: 4,
            isFirstStep: signal(false),
            isLastStep: signal(false),
            formData: signal(state.data),
            loadState: vi.fn().mockReturnValue(of(state)),
            saveStep,
            finish: vi.fn(),
            checkCnpjAvailability,
            goBackStep: vi.fn(),
          },
        },
        { provide: AuthService, useValue: { applyFinishResponse: vi.fn(), hydrateSession: vi.fn(), getMe: vi.fn() } },
        { provide: LayoutStore, useValue: { refreshTenants: vi.fn() } },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
        { provide: SessionService, useValue: { getItem: () => null, setItem: vi.fn() } },
      ],
    });

    const fixture = TestBed.createComponent(OnboardingContainer);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance as unknown as Harness };
  }

  /**
   * O passo só libera "Próximo" depois de emitir `isValid`, o que ele faz num
   * `setTimeout` no `ngOnInit`. Sem drenar o timer, `onNext()` sai cedo demais.
   */
  function markStepValid(fixture: ComponentFixture<OnboardingContainer>): void {
    expect(fixture.nativeElement.querySelector('#ob-cnpj')).toBeTruthy();
    vi.runAllTimers();
    fixture.detectChanges();
  }

  function cnpjFieldError(fixture: ComponentFixture<OnboardingContainer>): string | null {
    const control = findCnpjControl(fixture);
    const serverError = control?.errors?.[SERVER_ERROR_KEY] as { message?: string } | undefined;
    return serverError?.message ?? null;
  }

  function findCnpjControl(fixture: ComponentFixture<OnboardingContainer>): AbstractControl | null {
    const instance = fixture.componentInstance as unknown as {
      stepDocumentRef: () => { form: FormGroup } | undefined;
    };
    return instance.stepDocumentRef()?.form.get('cnpj') ?? null;
  }

  function failWith(status: number, body: unknown, headers?: HttpHeaders): HttpErrorResponse {
    const error = new HttpErrorResponse({ status, error: body, headers });
    checkCnpjAvailability.mockReturnValue(throwError(() => error));
    return error;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    loading = signal(false);
    checkingCnpj = signal(false);
    checkCnpjAvailability = vi.fn().mockReturnValue(of({ available: true }));
    saveStep = vi.fn().mockReturnValue(of(state));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('CNPJ disponível → segue e salva a etapa', () => {
    const { fixture, component } = render();
    markStepValid(fixture);
    component.onNext();

    expect(checkCnpjAvailability).toHaveBeenCalledWith(CNPJ);
    expect(saveStep).toHaveBeenCalledTimes(1);
    expect(component.error()).toBeNull();
  });

  it('409 → bloqueia e mostra a mensagem genérica do backend inline no campo', () => {
    const message = 'Não foi possível usar este CNPJ. Verifique o número ou fale com o suporte.';
    failWith(409, { message, fieldErrors: { cnpj: message } });

    const { fixture, component } = render();
    markStepValid(fixture);
    component.onNext();
    fixture.detectChanges();

    expect(saveStep).not.toHaveBeenCalled();
    // A cópia é do backend: não pode ser reescrita para confirmar que existe cadastro.
    expect(cnpjFieldError(fixture)).toBe(message);
    expect(component.error()).toBeNull();
  });

  it('400 CNPJ inválido → bloqueia e mostra inline', () => {
    const message = 'CNPJ inválido';
    failWith(400, { message, fieldErrors: { cnpj: message } });

    const { fixture, component } = render();
    markStepValid(fixture);
    component.onNext();
    fixture.detectChanges();

    expect(saveStep).not.toHaveBeenCalled();
    expect(cnpjFieldError(fixture)).toBe(message);
  });

  it('429 → bloqueia, informa a espera e não repete a chamada sozinho', () => {
    failWith(429, { error: 'rate_limited', message: 'Too many requests', retryAfterSeconds: 42 });

    const { fixture, component } = render();
    markStepValid(fixture);
    component.onNext();
    fixture.detectChanges();
    vi.runAllTimers();

    expect(saveStep).not.toHaveBeenCalled();
    expect(checkCnpjAvailability).toHaveBeenCalledTimes(1);
    expect(component.error()).toContain('42');
    // Nada da cópia crua em inglês do backend vaza para a tela.
    expect(component.error()).not.toContain('Too many requests');
  });

  it('429 sem corpo → cai no header Retry-After', () => {
    failWith(429, null, new HttpHeaders({ 'Retry-After': '30' }));

    const { fixture, component } = render();
    markStepValid(fixture);
    component.onNext();
    fixture.detectChanges();

    expect(component.error()).toContain('30');
  });

  it('falha de rede / 5xx → não bloqueia, segue para o salvamento', () => {
    failWith(0, null);

    const { fixture, component } = render();
    markStepValid(fixture);
    component.onNext();
    fixture.detectChanges();

    // A checagem é consultiva: /finish e o gatilho no banco continuam sendo o portão.
    expect(saveStep).toHaveBeenCalledTimes(1);
    expect(component.error()).toBeNull();
  });

  it('500 → não bloqueia', () => {
    failWith(500, { message: 'boom' });

    const { fixture } = render();
    markStepValid(fixture);
    (fixture.componentInstance as unknown as Harness).onNext();

    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('não chama a API quando a empresa declara não ter CNPJ', () => {
    const { fixture, component } = render();
    const instance = fixture.componentInstance as unknown as {
      stepDocumentRef: () => { form: { patchValue: (v: unknown) => void } } | undefined;
    };
    instance.stepDocumentRef()?.form.patchValue({ hasCnpj: false, cnpj: '' });
    fixture.detectChanges();

    component.onNext();

    expect(checkCnpjAvailability).not.toHaveBeenCalled();
    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('não chama a API enquanto o mod 11 local reprova o CNPJ', () => {
    const { fixture, component } = render();
    const instance = fixture.componentInstance as unknown as {
      stepDocumentRef: () => { form: { patchValue: (v: unknown) => void } } | undefined;
    };
    // Forma correta, dígitos verificadores errados.
    instance.stepDocumentRef()?.form.patchValue({ hasCnpj: true, cnpj: '12345678000196' });
    fixture.detectChanges();

    component.onNext();

    expect(checkCnpjAvailability).not.toHaveBeenCalled();
  });

  it('CNPJ inválido → "Próximo" mostra o erro inline em vez de não fazer nada', () => {
    const { fixture, component } = render();
    const instance = fixture.componentInstance as unknown as {
      stepDocumentRef: () => { form: { patchValue: (v: unknown) => void } } | undefined;
    };
    instance.stepDocumentRef()?.form.patchValue({ hasCnpj: true, cnpj: '12345678000196' });
    fixture.detectChanges();

    component.onNext();
    fixture.detectChanges();

    // Antes, nenhum ref de passo casava com o passo 3 e o botão simplesmente
    // não respondia: sem inline, sem banner, sem chamada.
    expect(findCnpjControl(fixture)?.touched).toBe(true);
    const message = fixture.nativeElement.querySelector('#ob-cnpj-error');
    expect(message?.getAttribute('role')).toBe('alert');
    expect(message?.textContent).toContain('CNPJ inválido');
    expect(fixture.nativeElement.querySelector('#ob-cnpj')?.getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(checkCnpjAvailability).not.toHaveBeenCalled();
    expect(saveStep).not.toHaveBeenCalled();
  });

  it('ignora cliques enquanto a verificação está em voo', () => {
    checkingCnpj.set(true);

    const { fixture, component } = render();
    markStepValid(fixture);
    component.onNext();

    expect(checkCnpjAvailability).not.toHaveBeenCalled();
    expect(saveStep).not.toHaveBeenCalled();
  });
});
