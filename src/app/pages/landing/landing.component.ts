import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LandingNavComponent } from '../../components/landing-nav/landing-nav.component';
import { LandingHeroComponent } from '../../components/landing-hero/landing-hero.component';
import { LandingProblemComponent } from '../../components/landing-problem/landing-problem.component';
import { LandingSolutionComponent } from '../../components/landing-solution/landing-solution.component';
import { LandingFeaturesComponent } from '../../components/landing-features/landing-features.component';
import { LandingMultitenantComponent } from '../../components/landing-multitenant/landing-multitenant.component';
import { LandingStatsComponent } from '../../components/landing-stats/landing-stats.component';
import { LandingPricingComponent } from '../../components/landing-pricing/landing-pricing.component';
import { LandingCtaComponent } from '../../components/landing-cta/landing-cta.component';
import { LandingFooterComponent } from '../../components/landing-footer/landing-footer.component';

@Component({
  selector: 'app-landing',
  imports: [
    LandingNavComponent,
    LandingHeroComponent,
    LandingProblemComponent,
    LandingSolutionComponent,
    LandingFeaturesComponent,
    LandingMultitenantComponent,
    LandingStatsComponent,
    LandingPricingComponent,
    LandingCtaComponent,
    LandingFooterComponent,
  ],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingComponent {}
