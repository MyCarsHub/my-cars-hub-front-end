import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-landing-cta',
  imports: [RouterModule],
  templateUrl: './landing-cta.component.html',
  styleUrls: ['./landing-cta.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingCtaComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly particles = Array.from({ length: 8 }, (_, i) => i);

  constructor() {
    this.revealOnScroll();
  }

  private revealOnScroll(): void {
    // `afterNextRender` em vez de `ngAfterViewInit`: este bloco usa APIs de DOM real
    // (IntersectionObserver, NodeList.forEach) que não existem durante o prerender. O
    // Angular pula estes callbacks no servidor — ver `app.routes.server.ts`.
    afterNextRender(() => {
      const obs = new IntersectionObserver(
        (entries) => { for (const e of entries) { if (e.isIntersecting) { e.target.classList.add('revealed'); obs.unobserve(e.target); } } },
        { threshold: 0.15 }
      );
      this.host.nativeElement.querySelectorAll('.reveal').forEach((el: Element) => obs.observe(el));
    });
  }
}
