import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-detail-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './detail-actions.html',
  host: { class: 'block w-full lg:w-auto' },
})
export class DetailActions {
  readonly editRouterLink = input<unknown[] | null>(null);
  readonly editDisabled = input<boolean>(false);
  readonly delete = output<void>();

  protected onDelete(): void {
    this.delete.emit();
  }
}
