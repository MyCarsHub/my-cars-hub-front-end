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
} from '../landing-structured-data';
import { enableRevealAnimations } from '../reveal-ready';
import { LandingNavComponent } from '../components/landing-nav/landing-nav.component';
import { LandingHeroComponent } from '../components/landing-hero/landing-hero.component';
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
    this.seo.removeJsonLd('software-application');
    this.seo.removeJsonLd('faq');
  }

  protected onScroll(): void {
    this.showFab.set(window.scrollY > 600);
  }

  protected scrollTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
