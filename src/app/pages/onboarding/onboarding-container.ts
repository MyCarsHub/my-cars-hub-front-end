import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { animate, style, transition, trigger } from '@angular/animations';
import { OnboardingService } from './onboarding.service';
import { OnboardingData } from './onboarding.types';
import { OnboardingProgressBar } from './components/step-progress-bar';
import { StepPersonal } from './components/step-personal';
import { StepCompany } from './components/step-company';
import { StepDocument } from './components/step-document';
import { StepWelcome } from './components/step-welcome';
import { AuthService } from '../../services/auth.service';
import { LayoutStore } from '../../components/core/layouts/layout.store';
import { NotificationService } from '../../services/notification.service';
import { SessionService } from '../../services/session.service';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-onboarding-container',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    OnboardingProgressBar,
    StepPersonal,
    StepCompany,
    StepDocument,
    StepWelcome,
  ],
  templateUrl: './onboarding-container.html',
  styleUrl: './onboarding-container.css',
  animations: [
    trigger('backdropFade', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('250ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [animate('200ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('cardEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95) translateY(12px)' }),
        animate(
          '300ms 80ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 1, transform: 'scale(1) translateY(0)' }),
        ),
      ]),
    ]),
  ],
})
export class OnboardingContainer implements OnInit {
  protected readonly svc = inject(OnboardingService);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly layoutStore = inject(LayoutStore);
  private readonly notify = inject(NotificationService);
  private readonly session = inject(SessionService);

  /** True once the initial GET /onboarding call has resolved */
  protected readonly loaded = signal(false);

  /** Accumulated form data merged on each step — reset after successful save */
  private readonly pendingData = signal<OnboardingData>({});

  /** Navigation direction for CSS animation */
  protected readonly direction = signal<'forward' | 'backward'>('forward');

  /**
   * Whether the current step's form is valid.
   * Starts false so step 1 (required fields) blocks "Next" until the user fills in data.
   * Steps 3 & 5 always emit true immediately from their components.
   */
  protected readonly stepValid = signal(false);

  /** References to step components so we can call markAllTouched() */
  private readonly stepPersonalRef = viewChild(StepPersonal);
  private readonly stepCompanyRef = viewChild(StepCompany);

  protected readonly currentStep = this.svc.currentStep;
  protected readonly totalSteps = this.svc.totalSteps;
  protected readonly loading = this.svc.loading;
  protected readonly error = this.svc.error;

  protected readonly isFirstStep = this.svc.isFirstStep;
  protected readonly isLastStep = this.svc.isLastStep;

  /**
   * Merged view of backend data + unsaved local changes.
   * Steps receive this as [initialData] — only after `loaded` is true,
   * ensuring ngOnInit reads the correct pre-filled values.
   */
  protected readonly formData = computed<OnboardingData>(() => ({
    ...this.svc.formData(),
    ...this.pendingData(),
  }));

  protected readonly nextLabel = computed(() => {
    if (this.svc.loading()) return 'Salvando...';
    return this.svc.isLastStep() ? 'Acessar Plataforma' : 'Próximo';
  });

  ngOnInit(): void {
    // Load backend state first; only render step components after this resolves
    // so that ngOnInit in each step gets the correct pre-filled data.
    this.svc.loadState().subscribe({
      next: (state) => {
        if (state.isCompleted) {
          this.router.navigate(['/dashboard']);
          return;
        }
        this.loaded.set(true);
      },
      error: (err: HttpErrorResponse) => {
        // Even on error, show the form (fields will be empty), but toast
        // so the user understands why the form is blank.
        this.loaded.set(true);
        // 404 on first entry is expected (no onboarding row yet) — do not toast.
        if (err?.status !== 404) {
          this.notify.error(
            err?.error?.message ??
              'Não foi possível carregar seu progresso. Você pode continuar mesmo assim.',
          );
        }
      },
    });
  }

  protected onStepFormChange(data: Partial<OnboardingData>): void {
    this.pendingData.update((prev) => ({ ...prev, ...data }));
  }

  protected onStepValidityChange(valid: boolean): void {
    this.stepValid.set(valid);
  }

  protected onNext(): void {
    if (this.svc.loading()) return;

    if (!this.stepValid()) {
      this.stepPersonalRef()?.markAllTouched();
      this.stepCompanyRef()?.markAllTouched();
      return;
    }

    const step = this.svc.currentStep();

    if (step === 4) {
      this.svc.finish().subscribe({
        next: () => {
          // Only refresh session + navigate on real success. On error we stay
          // on /onboarding so the user can retry.
          this.authService.getMe().subscribe({
            next: () => {
              // Guarda: se o getMe pós-finish veio SEM companies, algo quebrou
              // (rollback silencioso backend, transaction visibility no pooler,
              // etc). Navegar pra /dashboard aqui joga o user num 403 mudo.
              // Melhor mostrar erro e deixar ele retentar.
              if (!this.session.getItem('selectedCompanyId')) {
                this.notify.error('Não conseguimos vincular sua empresa. Tente novamente.');
                return;
              }
              this.layoutStore.refreshTenants();
              this.router.navigate(['/dashboard']);
            },
            error: (err: HttpErrorResponse) => this.handleFinishError(err),
          });
        },
        error: (err: HttpErrorResponse) => this.handleFinishError(err),
      });
      return;
    }

    const fullData: OnboardingData = {
      ...this.svc.formData(),
      ...this.pendingData(),
    };

    this.svc.saveStep(step, fullData).subscribe({
      next: () => {
        this.stepValid.set(false);
        this.pendingData.set({});
        this.direction.set('forward');
      },
      error: (err: HttpErrorResponse) => {
        this.notify.error(
          err?.error?.message ?? 'Não foi possível salvar esta etapa. Tente novamente.',
        );
      },
    });
  }

  private handleFinishError(err: HttpErrorResponse): void {
    this.notify.error(
      err?.error?.message ??
        'Não foi possível finalizar seu cadastro. Verifique os dados e tente novamente.',
    );
  }

  protected onBack(): void {
    if (this.svc.loading() || this.svc.isFirstStep()) return;

    this.svc.loadState().subscribe({
      next: () => {
        this.stepValid.set(false);
        this.pendingData.set({});
        this.direction.set('backward');
        // Always decrement locally after re-syncing current backend state
        this.svc.goBackStep();
      },
      error: (err: HttpErrorResponse) => {
        this.notify.error(
          err?.error?.message ?? 'Não foi possível voltar. Tente novamente.',
        );
      },
    });
  }
}
