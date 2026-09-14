import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { SeoService } from '../../../services/seo.service';
import {
  faqPageJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from '../landing-structured-data';
import { enableRevealAnimations } from '../reveal-ready';
import { LandingNavComponent } from '../components/landing-nav/landing-nav.component';
import { LandingHeroComponent } from '../components/landing-hero/landing-hero.component';
import { LandingSimulatorComponent } from '../components/landing-simulator/landing-simulator.component';
import { LandingProblemComponent } from '../components/landing-problem/landing-problem.component';
import { LandingSolutionComponent } from '../components/landing-solution/landing-solution.component';
import { LandingFeaturesComponent } from '../components/landing-features/landing-features.component';
import { LandingMultitenantComponent } from '../components/landing-multitenant/landing-multitenant.component';
import { LandingTestimonialsComponent } from '../components/landing-testimonials/landing-testimonials.component';
import { LandingStatsComponent } from '../components/landing-stats/landing-stats.component';
import { LandingPricingComponent } from '../components/landing-pricing/landing-pricing.component';
import { LandingFaqComponent } from '../components/landing-faq/landing-faq.component';
import { LandingCtaComponent } from '../components/landing-cta/landing-cta.component';
import { LandingBuildingPublicComponent } from '../components/landing-building-public/landing-building-public.component';
import { LandingFooterComponent } from '../components/landing-footer/landing-footer.component';

@Component({
  selector: 'app-landing',
  imports: [
    LandingNavComponent,
    LandingHeroComponent,
    LandingSimulatorComponent,
    LandingProblemComponent,
    LandingSolutionComponent,
    LandingFeaturesComponent,
    LandingMultitenantComponent,
    LandingTestimonialsComponent,
    LandingStatsComponent,
    LandingPricingComponent,
    LandingFaqComponent,
    LandingCtaComponent,
    LandingBuildingPublicComponent,
    LandingFooterComponent,
  ],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:scroll)': 'onScroll()' },
})
export class LandingComponent implements OnDestroy {
  private readonly seo = inject(SeoService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly showFab = signal(false);

  constructor() {
    // Written in the constructor so the blocks are already in <head> when the prerender
    // serializes the document — that is what puts them in the static HTML Google reads.
    this.seo.setJsonLd('organization', organizationJsonLd());
    this.seo.setJsonLd('website', webSiteJsonLd());
    this.seo.setJsonLd('software-application', softwareApplicationJsonLd());
    this.seo.setJsonLd('faq', faqPageJsonLd());

    // Só depois que o cliente renderizou o CSS pode esconder o que vai entrar animado —
    // até lá o HTML prerenderizado fica visível. Ver `reveal-ready.ts`.
    afterNextRender(() => {
      const root = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '.landing-root',
      );
      if (root) enableRevealAnimations(root);
    });
  }

  ngOnDestroy(): void {
    // Navigating away in the SPA must not leave the landing's schema on other pages.
    this.seo.removeJsonLd('organization');
    this.seo.removeJsonLd('website');
    this.seo.removeJsonLd('software-application');
    this.seo.removeJsonLd('faq');
  }

  protected onScroll(): void {
    this.showFab.set(window.scrollY > 600 && !this.pricingInView());
  }

  /**
   * O FAB é `position: fixed` no canto inferior direito, e no TELEFONE não há
   * goteira em que ele caiba: o card de plano ocupa a largura toda, então ele
   * fica POR CIMA do card. Medido num viewport de 386px, cobrindo a linha do
   * preço anual ("ou R$ 66,58/mês no anual") numa área de 21x16px (FIX-0295).
   *
   * No desktop a grade tem quatro colunas centradas e sobra margem — por isso o
   * defeito nunca apareceu lá. Some nas duas larguras mesmo assim: a decisão não
   * pode sair de uma media query em JavaScript, porque esta página é
   * prerenderizada, e em larguras intermediárias (grade 2x2, margem estreita) a
   * sobreposição volta. Um botão decorativo em cima do preço é caro justamente
   * na página que existe para converter, e barato de dispensar ali — o logo do
   * rodapé já leva ao topo.
   *
   * Geometria simples em vez de `IntersectionObserver`: só roda no evento de
   * rolagem, que é sempre do cliente, então não há nada a decidir no prerender.
   */
  private pricingInView(): boolean {
    const host = this.host.nativeElement as HTMLElement;
    const section = host.querySelector<HTMLElement>('#planos');
    if (!section) return false;

    const viewportHeight = host.ownerDocument.defaultView?.innerHeight ?? 0;
    const rect = section.getBoundingClientRect();
    return rect.top < viewportHeight && rect.bottom > 0;
  }

  protected scrollTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
