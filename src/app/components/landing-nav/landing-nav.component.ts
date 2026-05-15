import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-landing-nav',
  imports: [RouterModule],
  templateUrl: './landing-nav.component.html',
  styleUrls: ['./landing-nav.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:scroll)': 'onScroll()',
  },
})
export class LandingNavComponent {
  readonly scrolled = signal(false);
  readonly mobileOpen = signal(false);

  onScroll(): void {
    this.scrolled.set(window.scrollY > 12);
  }

  toggleMobile(): void {
    this.mobileOpen.update((v) => !v);
  }

  closeMobile(): void {
    this.mobileOpen.set(false);
  }
}
