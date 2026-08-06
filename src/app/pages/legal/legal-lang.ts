import { Signal, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

export type LegalLang = 'pt' | 'en';

/**
 * BCP-47 tag written to `<html lang>` while a legal page is open.
 *
 * PT maps to `pt-BR`, the same value `src/index.html` ships and the rest of the site
 * keeps — the legal pages are the only bilingual surface, so they must restore the site
 * default on the way out instead of leaving a bare `pt` behind.
 */
export const HTML_LANG: Readonly<Record<LegalLang, string>> = {
  pt: 'pt-BR',
  en: 'en',
};

export interface LegalLangSync {
  /** Current language, derived from the `?lang` query param. */
  readonly lang: Signal<LegalLang>;
  /** Writes the language back to the URL so it is shareable and survives a reload. */
  setLang(next: LegalLang): void;
}

/**
 * Keeps the PT/EN switch of the legal pages in sync with the `?lang` query param.
 *
 * Portuguese is the default and is represented by the ABSENCE of the param, so the
 * canonical URL stays clean (`/termos-de-uso`) and only English carries `?lang=en`.
 * Must be called from an injection context (component field/constructor).
 */
export function legalLangSync(): LegalLangSync {
  const route = inject(ActivatedRoute);
  const router = inject(Router);

  const queryParams = toSignal(route.queryParamMap, {
    initialValue: route.snapshot.queryParamMap,
  });
  const lang = computed<LegalLang>(() => (queryParams().get('lang') === 'en' ? 'en' : 'pt'));

  return {
    lang,
    setLang(next: LegalLang): void {
      void router.navigate([], {
        relativeTo: route,
        queryParams: { lang: next === 'en' ? 'en' : null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    },
  };
}
