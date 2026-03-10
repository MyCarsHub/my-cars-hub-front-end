import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { animate, style, transition, trigger } from '@angular/animations';
import { AccountSetupStore } from './account-setup.store';
import { StepProgressBar } from './components/step-progress-bar';
import { StepPersonalData } from './components/step-personal-data';
import { StepCompany } from './components/step-company';
import { StepCnpj } from './components/step-cnpj';
import { StepComplete } from './components/step-complete';

@Component({
  selector: 'app-account-steps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StepProgressBar,
    StepPersonalData,
    StepCompany,
    StepCnpj,
    StepComplete,
  ],
  templateUrl: './account-steps.html',
  styleUrl: './account-steps.css',
  animations: [
    // Slide forward (next)
    trigger('slideForward', [
      transition(':enter', [
        style({ transform: 'translateX(100%)', opacity: 0 }),
        animate('350ms cubic-bezier(0.4, 0, 0.2, 1)', style({ transform: 'translateX(0)', opacity: 1 })),
      ]),
      transition(':leave', [
        animate('350ms cubic-bezier(0.4, 0, 0.2, 1)', style({ transform: 'translateX(-100%)', opacity: 0 })),
      ]),
    ]),
    // Slide backward (back)
    trigger('slideBackward', [
      transition(':enter', [
        style({ transform: 'translateX(-100%)', opacity: 0 }),
        animate('350ms cubic-bezier(0.4, 0, 0.2, 1)', style({ transform: 'translateX(0)', opacity: 1 })),
      ]),
      transition(':leave', [
        animate('350ms cubic-bezier(0.4, 0, 0.2, 1)', style({ transform: 'translateX(100%)', opacity: 0 })),
      ]),
    ]),
    // Modal backdrop fade
    trigger('backdropFade', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('250ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [
        animate('200ms ease-in', style({ opacity: 0 })),
      ]),
    ]),
    // Modal card scale-in
    trigger('cardEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95) translateY(10px)' }),
        animate('300ms 100ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 1, transform: 'scale(1) translateY(0)' })),
      ]),
    ]),
  ],
})
export class AccountSteps {
  protected readonly store = inject(AccountSetupStore);
  private readonly router = inject(Router);

  protected onNext(): void {
    if (this.store.isLastStep()) {
      this.store.reset();
      this.router.navigate(['/dashboard']);
    } else if (this.store.canAdvance()) {
      this.store.next();
    }
  }

  protected onBack(): void {
    this.store.back();
  }

  protected get nextLabel(): string {
    return this.store.isLastStep() ? 'Acessar plataforma' : 'Próximo';
  }

  protected get canAdvance(): boolean {
    return this.store.isLastStep() || this.store.canAdvance();
  }
}
