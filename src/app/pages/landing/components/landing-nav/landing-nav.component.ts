import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-landing-nav',
  imports: [RouterModule],
  templateUrl: './landing-nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:scroll)': 'onScroll()' },
})
export class LandingNavComponent {
  readonly scrolled = signal(false);

  readonly links = [
    { href: '#problema', label: 'Problema' },
    { href: '#solucao', label: 'Solução' },
    { href: '#funcionalidades', label: 'Funcionalidades' },
    { href: '#integracoes', label: 'Integrações' },
    { href: '#planos', label: 'Planos' },
  ];

  onScroll(): void {
    this.scrolled.set(window.scrollY > 12);
  }
}
