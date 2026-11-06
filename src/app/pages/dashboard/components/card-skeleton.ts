import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PageCard } from '../../../components/core/page-card/page-card';

/**
 * Placeholder for one dashboard card while its data is on the way. It sits in the SAME grid slot
 * as the real card (same shell, same title) so nothing reflows when the data arrives; the body
 * height is the real card's, passed by the caller as `bodyClass`.
 */
@Component({
  selector: 'app-card-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard],
  host: { class: 'block min-w-0 h-full', 'aria-busy': 'true' },
  template: `
    <app-page-card [title]="title()" [fill]="true" [truncateTitle]="true">
      <div class="px-4 pb-5 sm:px-6 min-w-0 flex-1 flex flex-col">
        <div data-skeleton-body class="w-full flex-1 rounded-xl bg-surface-sunken animate-pulse" [class]="bodyClass()"></div>
      </div>
    </app-page-card>
  `,
})
export class CardSkeleton {
  readonly title = input.required<string>();
  /** Tailwind height classes of the body (the real card's content height). */
  readonly bodyClass = input('min-h-40');
}
