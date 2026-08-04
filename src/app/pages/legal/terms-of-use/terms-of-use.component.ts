import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  Renderer2,
  effect,
  inject,
} from '@angular/core';
import { LegalNavComponent } from '../legal-nav/legal-nav.component';
import { LandingFooterComponent } from '../../landing/components/landing-footer/landing-footer.component';
import { LegalLang, legalLangSync } from '../legal-lang';

@Component({
  selector: 'app-terms-of-use',
  imports: [LegalNavComponent, LandingFooterComponent],
  templateUrl: './terms-of-use.component.html',
  styleUrls: ['../legal.styles.css', './terms-of-use.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsOfUseComponent implements OnDestroy {
  private readonly renderer = inject(Renderer2);
  private readonly document = inject(DOCUMENT);
  private readonly langSync = legalLangSync();

  /** Driven by `?lang` — `pt` when the param is absent. */
  protected readonly lang = this.langSync.lang;
  protected readonly lastUpdated = '2026-07-21';

  constructor() {
    effect(() => this.applyHtmlLang(this.lang()));
  }

  ngOnDestroy(): void {
    this.applyHtmlLang('pt');
  }

  protected setLang(next: LegalLang): void {
    this.langSync.setLang(next);
  }

  private applyHtmlLang(lang: LegalLang): void {
    this.renderer.setAttribute(this.document.documentElement, 'lang', lang);
  }
}
