import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-page-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './page-card.html',
  host: { class: 'block' },
})
export class PageCard {
  title = input.required<string>();
}
