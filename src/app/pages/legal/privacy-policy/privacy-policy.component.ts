import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  Renderer2,
  inject,
  signal,
} from '@angular/core';
import { LegalNavComponent } from '../legal-nav/legal-nav.component';
import { LandingFooterComponent } from '../../landing/components/landing-footer/landing-footer.component';

type Lang = 'pt' | 'en';

@Component({
  selector: 'app-privacy-policy',
  imports: [LegalNavComponent, LandingFooterComponent],
  templateUrl: './privacy-policy.component.html',
  styleUrls: ['../legal.styles.css', './privacy-policy.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyPolicyComponent implements OnInit, OnDestroy {
  private readonly renderer = inject(Renderer2);
  private readonly document = inject(DOCUMENT);

  protected readonly lang = signal<Lang>('pt');
  protected readonly lastUpdated = '2026-07-21';

  ngOnInit(): void {
    this.applyHtmlLang('pt');
  }

  ngOnDestroy(): void {
    this.applyHtmlLang('pt');
  }

  protected setLang(next: Lang): void {
    this.lang.set(next);
    this.applyHtmlLang(next);
  }

  private applyHtmlLang(lang: Lang): void {
    this.renderer.setAttribute(this.document.documentElement, 'lang', lang);
  }
}
