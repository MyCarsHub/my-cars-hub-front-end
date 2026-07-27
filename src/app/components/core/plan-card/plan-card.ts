import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type PlanCardVariant = 'trial' | 'pro' | 'business';

@Component({
  selector: 'app-plan-card',
  templateUrl: './plan-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class PlanCardComponent {
  readonly variant = input.required<PlanCardVariant>();
  readonly name = input.required<string>();
  readonly price = input.required<string>();
  readonly cycleSuffix = input.required<string>();
  readonly subtitleText = input<string | null>(null);
  readonly description = input<string | null>(null);
  readonly features = input.required<readonly string[]>();
  readonly beforeFeaturesText = input<string | null>(null);
  readonly ctaLabel = input.required<string>();
  readonly ctaDisabled = input<boolean>(false);
  readonly isCurrent = input<boolean>(false);
  /** Short note rendered right under the CTA (e.g. "Muda no fim do período"). */
  readonly ctaNote = input<string | null>(null);
  /**
   * Error for THIS card, rendered next to the button the user just clicked —
   * a banner at the top of the page is off-screen on mobile.
   */
  readonly errorText = input<string | null>(null);
  readonly ribbonText = input<string | null>(null);
  readonly gradientCss = input<string | null>(null);
  readonly shadowCss = input<string | null>(null);
  readonly accentTextClass = input<string>('text-brand-strong');

  readonly ctaClick = output<void>();

  protected onCta(): void {
    if (this.ctaDisabled()) return;
    this.ctaClick.emit();
  }
}
