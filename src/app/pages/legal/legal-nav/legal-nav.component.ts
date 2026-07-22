import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type Lang = 'pt' | 'en';

@Component({
  selector: 'app-legal-nav',
  imports: [RouterLink],
  templateUrl: './legal-nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:scroll)': 'onScroll()' },
})
export class LegalNavComponent {
  readonly pageTitlePt = input.required<string>();
  readonly pageTitleEn = input.required<string>();
  readonly lang = input.required<Lang>();
  readonly langChange = output<Lang>();

  protected readonly scrolled = signal(false);

  protected onScroll(): void {
    this.scrolled.set(window.scrollY > 12);
  }

  protected setLang(next: Lang): void {
    this.langChange.emit(next);
  }
}
