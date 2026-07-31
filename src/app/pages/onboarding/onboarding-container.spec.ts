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

/**
 * FIXES — onboarding: toda transição derrubava o foco para o BODY, o passo 4 não tinha
 * "Voltar" e o "Próximo" bloqueado não anunciava o motivo. O foco agora vai para o
 * heading (`tabindex="-1"`) do novo passo, o rodapé existe em todos os passos e o
 * motivo do bloqueio é ligado ao botão via `aria-describedby`.
 */
describe('OnboardingContainer — foco, Voltar no passo 4 e motivo do bloqueio', () => {
  /**
   * Este bloco usa timers REAIS (o foco depende de `afterNextRender` + `whenStable`).
   * Cada passo emite `isValid` num `setTimeout` do `ngOnInit`; esse timer precisa ser
   * drenado enquanto o passo ainda está vivo — senão dispara num componente já
   * destruído (NG0953 no stderr). Chamado após `renderAt` e antes de cada transição.
   */
  function drainStepTimers(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  afterEach(drainStepTimers);

  interface Harness {
    onNext: () => void;
    onBack: () => void;
    onStepValidityChange: (valid: boolean) => void;
  }

  function renderAt(step: number, data: OnboardingState['data'] = {}) {
    const state: OnboardingState = { step, isCompleted: false, data };
    const currentStep = signal(step);
    const isFirstStep = signal(step === 1);
    const isLastStep = signal(step === 4);
    const goTo = (next: number): void => {
      currentStep.set(next);
      isFirstStep.set(next === 1);
      isLastStep.set(next === 4);
    };
    const svcMock = {
      loading: signal(false),
      checkingCnpj: signal(false),
      loadError: signal<string | null>(null),
      currentStep,
      totalSteps: 4,
      isFirstStep,
      isLastStep,
      formData: signal(data),
      loadState: vi.fn().mockReturnValue(of(state)),
      saveStep: vi.fn().mockImplementation(() => {
        goTo(currentStep() + 1);
        return of(state);
      }),
      finish: vi.fn(),
      checkCnpjAvailability: vi.fn().mockReturnValue(of({ available: true })),
      goBackStep: vi.fn().mockImplementation(() => goTo(currentStep() - 1)),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [OnboardingContainer],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        { provide: OnboardingService, useValue: svcMock },
        {
          provide: AuthService,
          useValue: { applyFinishResponse: vi.fn(), hydrateSession: vi.fn(), getMe: vi.fn() },
        },
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
    return { fixture, harness: fixture.componentInstance as unknown as Harness, svcMock };
  }

  function buttonByText(
    fixture: ComponentFixture<OnboardingContainer>,
    text: string,
  ): HTMLButtonElement | null {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    );
    return buttons.find((b) => b.textContent?.includes(text)) ?? null;
  }

  it('passo 4 tem "Voltar" no rodapé, sem "Próximo" nem hint', async () => {
    const { fixture, svcMock } = renderAt(4);
    await drainStepTimers();

    const back = fixture.nativeElement.querySelector(
      'button[aria-label="Voltar para o passo anterior"]',
    );
    expect(back instanceof HTMLButtonElement).toBe(true);
    expect(buttonByText(fixture, 'Próximo')).toBeNull();
    expect(fixture.nativeElement.querySelector('#onboarding-next-hint')).toBeNull();

    (back as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(svcMock.goBackStep).toHaveBeenCalledTimes(1);
  });

  it('"Próximo" bloqueado anuncia o motivo e mostra os erros inline ao clicar', () => {
    const { fixture } = renderAt(1);

    const hint = fixture.nativeElement.querySelector('#onboarding-next-hint');
    expect(hint?.textContent).toContain('Preencha os campos obrigatórios');

    const next = buttonByText(fixture, 'Próximo');
    expect(next?.disabled).toBe(false);
    expect(next?.getAttribute('aria-disabled')).toBe('true');
    expect(next?.getAttribute('aria-describedby')).toBe('onboarding-next-hint');

    next?.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#ob-name-error')?.textContent).toContain(
      'obrigatório',
    );
  });

  it('o motivo do bloqueio some quando o passo fica válido', () => {
    const { fixture, harness } = renderAt(1);

    harness.onStepValidityChange(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#onboarding-next-hint')).toBeNull();
    const next = buttonByText(fixture, 'Próximo');
    expect(next?.getAttribute('aria-disabled')).toBe('false');
    expect(next?.getAttribute('aria-describedby')).toBeNull();
  });

  it('avançar move o foco para o heading do novo passo', async () => {
    const { fixture, harness } = renderAt(1, {
      name: 'Ada',
      cpf: '52998224725',
      phoneNumber: '11987654321',
    });
    await drainStepTimers();

    harness.onStepValidityChange(true);
    harness.onNext();
    fixture.detectChanges();
    await fixture.whenStable();

    const heading = fixture.nativeElement.querySelector('h2[tabindex="-1"]');
    expect(heading?.textContent).toContain('Sua empresa');
    expect(document.activeElement).toBe(heading);
  });

  it('voltar move o foco para o heading do passo anterior', async () => {
    const { fixture, harness } = renderAt(2, { name: 'Ada' });
    await drainStepTimers();

    harness.onBack();
    fixture.detectChanges();
    await fixture.whenStable();

    const heading = fixture.nativeElement.querySelector('h2[tabindex="-1"]');
    expect(heading?.textContent).toContain('Seus dados pessoais');
    expect(document.activeElement).toBe(heading);
  });
});
