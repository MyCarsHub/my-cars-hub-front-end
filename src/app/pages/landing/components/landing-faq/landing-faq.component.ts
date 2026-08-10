import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';

import { LANDING_FAQS, LandingFaq } from '../../landing-faqs';

@Component({
  selector: 'app-landing-faq',
  templateUrl: './landing-faq.component.html',
  styleUrls: ['./landing-faq.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingFaqComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  /**
   * Mesma lista que o `FAQPage` do JSON-LD publica — ver `landing-faqs.ts`. Marcar
   * pergunta que a página não mostra é violação de política do Google, então a fonte
   * é uma só.
   */
  readonly faqs: readonly LandingFaq[] = LANDING_FAQS;

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
