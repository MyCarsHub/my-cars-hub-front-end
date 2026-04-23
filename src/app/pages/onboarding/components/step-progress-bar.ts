import { ChangeDetectionStrategy, Component, input, computed } from '@angular/core';
import { STEP_CONFIGS } from '../onboarding.types';

@Component({
  selector: 'app-onboarding-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Segmented progress bar -->
    <div class="flex items-center gap-1.5 mb-5" role="progressbar"
         [attr.aria-valuenow]="currentStep()"
         [attr.aria-valuemin]="1"
         [attr.aria-valuemax]="totalSteps()"
         [attr.aria-label]="'Passo ' + currentStep() + ' de ' + totalSteps()">
      @for (n of stepsArray(); track n) {
        <div class="h-1.5 flex-1 rounded-full transition-all duration-500 ease-out"
             [class.bg-primary-500]="n <= currentStep()"
             [class.bg-gray-200]="n > currentStep()">
        </div>
      }
    </div>

    <!-- Step label -->
    <div class="flex items-center justify-between mb-1">
      <div class="flex items-center gap-2">
        <span class="text-lg leading-none" aria-hidden="true">{{ currentConfig().icon }}</span>
        <span class="text-sm font-semibold text-gray-800">{{ currentConfig().title }}</span>
      </div>
      <span class="text-xs text-gray-400 font-medium tabular-nums">
        {{ currentStep() }}/{{ totalSteps() }}
      </span>
    </div>
  `,
})
export class OnboardingProgressBar {
  readonly currentStep = input.required<number>();
  readonly totalSteps = input.required<number>();

  protected readonly stepsArray = computed(() =>
    Array.from({ length: this.totalSteps() }, (_, i) => i + 1),
  );

  protected readonly currentConfig = computed(() => {
    return STEP_CONFIGS.find((c) => c.step === this.currentStep()) ?? STEP_CONFIGS[0];
  });
}
