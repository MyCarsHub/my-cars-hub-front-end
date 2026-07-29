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

  // Âncoras root-absolutas: o header também é usado em /blog e /blog/:slug, onde
  // um href relativo (`#secao`) não encontraria nenhuma seção. Com `/#secao` o
  // clique volta para a landing e cai na seção certa; dentro da própria landing
  // o browser só troca o fragmento (mesmo path), sem recarregar a página.
  readonly links = [
    { href: '/#problema', label: 'Problema' },
    { href: '/#solucao', label: 'Solução' },
    { href: '/#funcionalidades', label: 'Funcionalidades' },
    { href: '/#planos', label: 'Planos' },
  ];

  onScroll(): void {
    this.scrolled.set(window.scrollY > 12);
  }
}
