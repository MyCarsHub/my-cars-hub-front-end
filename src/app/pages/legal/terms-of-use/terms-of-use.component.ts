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
import { HTML_LANG, LegalLang, legalLangSync } from '../legal-lang';

@Component({
  selector: 'app-terms-of-use',
  imports: [LegalNavComponent, LandingFooterComponent],
  templateUrl: './terms-of-use.component.html',
  styleUrls: ['../legal.styles.css', './terms-of-use.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Esta rota é PRERENDERIZADA e o prerender roda sem query string, então o HTML estático
  // contém só o ramo português do `@if (lang() === 'pt')` — que é o corpo INTEIRO da
  // página. Em `/termos-de-uso?lang=en` a hidratação teria de trocar esse bloco e falharia
  // (erro no Sentry + flash de PT antes do EN). `ngSkipHydration` faz o Angular descartar e
  // re-renderizar a subárvore no cliente: o crawler continua recebendo o HTML PT completo
  // (o valor do prerender) e o visitante EN recebe o conteúdo certo sem erro.
  host: { ngSkipHydration: 'true' },
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
    // Restaura o padrão do site (`pt-BR`, ver `src/index.html`) ao sair da página.
    this.applyHtmlLang('pt');
  }

  protected setLang(next: LegalLang): void {
    this.langSync.setLang(next);
  }

  private applyHtmlLang(lang: LegalLang): void {
    this.renderer.setAttribute(this.document.documentElement, 'lang', HTML_LANG[lang]);
  }
}
