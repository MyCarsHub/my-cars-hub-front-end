import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
    selector: 'app-step-progress-bar',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <!-- Progress bar segments -->
    <div class="flex items-center gap-1.5 mb-4">
      @for (step of stepsArray(); track step) {
        <div
          class="h-1 flex-1 rounded-full transition-colors duration-500"
          [class.bg-primary-500]="step <= currentStep()"
          [class.bg-gray-200]="step > currentStep()"
        ></div>
      }
    </div>

    <!-- Step indicator -->
    <div class="flex items-center gap-2 text-sm text-gray-500">
      <span>{{ stepIcon() }}</span>
      <span>Passo {{ currentStep() }} de {{ totalSteps() }} — <strong class="text-gray-700">{{ stepTitle() }}</strong></span>
    </div>
  `,
})
export class StepProgressBar {
    readonly currentStep = input.required<number>();
    readonly totalSteps = input.required<number>();
    readonly stepTitle = input.required<string>();
    readonly stepIcon = input.required<string>();

    protected stepsArray(): number[] {
        const total = this.totalSteps();
        return Array.from({ length: total }, (_, i) => i + 1);
    }
}
