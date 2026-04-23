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
import { finalize } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { LayoutStore } from '../../components/core/layouts/layout.store';

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
      error: () => {
        // Even on error, show the form (fields will be empty)
        this.loaded.set(true);
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
      this.svc.finish().pipe(
        finalize(() => {
          this.authService.getMe().pipe(
            finalize(() => {
              this.layoutStore.refreshTenants();
              this.router.navigate(['/dashboard']);
            })
          ).subscribe();
        })
      ).subscribe();
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
    });
  }

  protected onBack(): void {
    if (this.svc.loading() || this.svc.isFirstStep()) return;

    this.svc.loadState().subscribe({
      next: (state) => {
        this.stepValid.set(false);
        this.pendingData.set({});
        this.direction.set('backward');
        // Always decrement locally after re-syncing current backend state
        this.svc.goBackStep();
      },
    });
  }
}
