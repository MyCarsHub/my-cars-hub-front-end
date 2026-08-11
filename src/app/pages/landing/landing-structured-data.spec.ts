import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';

import { LandingFaqComponent } from './components/landing-faq/landing-faq.component';
import { LandingPricingComponent } from './components/landing-pricing/landing-pricing.component';
import { LANDING_FAQS } from './landing-faqs';
import { PLAN_PRICES } from './landing-plans';
import {
  faqPageJsonLd,
  organizationJsonLd,
  organizationRef,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from './landing-structured-data';

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

interface Offer {
  readonly '@type': string;
  readonly price: string;
  readonly priceCurrency: string;
}

/** The single place prices are published: `SoftwareApplication.offers`. */
function offers(): readonly Offer[] {
  return (softwareApplicationJsonLd() as { offers: readonly Offer[] }).offers;
}

describe('landing structured data', () => {
  it('emits Organization with an absolute url and logo', () => {
    const org = organizationJsonLd() as Record<string, unknown>;

    expect(org['@type']).toBe('Organization');
    expect(org['url']).toBe('https://www.mycarshub.app.br/');
    expect(String(org['logo'])).toMatch(/^https:\/\/www\.mycarshub\.app\.br\//);
  });

  it('emits SoftwareApplication that points back at the Organization node', () => {
    const app = softwareApplicationJsonLd() as Record<string, unknown>;

    expect(app['@type']).toBe('SoftwareApplication');
    expect(app['publisher']).toEqual({ '@id': 'https://www.mycarshub.app.br/#organization' });
    expect(Array.isArray(app['offers'])).toBe(true);
  });

  describe('WebSite', () => {
    it('names the site and points back at the Organization node', () => {
      const site = webSiteJsonLd() as Record<string, unknown>;

      expect(site['@type']).toBe('WebSite');
      expect(site['@id']).toBe('https://www.mycarshub.app.br/#website');
      expect(site['url']).toBe('https://www.mycarshub.app.br/');
      expect(site['name']).toBe('MyCarsHub');
      expect(site['publisher']).toEqual({ '@id': 'https://www.mycarshub.app.br/#organization' });
    });

    /**
     * A sitelinks searchbox is earned by HAVING search. `/blog` filters by category in
     * component state and there is no `?q=` route anywhere, so a `SearchAction` would
     * publish a URL template that resolves to the 404 page.
     */
    it('omits SearchAction — the site has no search URL to declare', () => {
      const site = webSiteJsonLd() as Record<string, unknown>;

      expect(site['potentialAction']).toBeUndefined();
    });
  });

  /** Pages that do not emit the full Organization still need a resolvable publisher. */
  it('exposes an Organization reference that reuses the canonical @id', () => {
    const ref = organizationRef() as Record<string, unknown>;
    const org = organizationJsonLd() as Record<string, unknown>;

    expect(ref['@type']).toBe('Organization');
    expect(ref['@id']).toBe(org['@id']);
    expect(ref['name']).toBe(org['name']);
    // Um nó de referência não pode declarar `@context`: ele é sempre embutido em outro.
    expect(ref['@context']).toBeUndefined();
  });

  it('omits aggregateRating and review — there is no verified review data to back them', () => {
    const app = softwareApplicationJsonLd() as Record<string, unknown>;
    const org = organizationJsonLd() as Record<string, unknown>;

    for (const node of [app, org]) {
      expect(node['aggregateRating']).toBeUndefined();
      expect(node['review']).toBeUndefined();
    }
  });

  /**
   * The support number is only rendered on authenticated screens. Structured data must
   * reflect what the crawled page shows, so the landing's Organization cannot claim it.
   */
  it('omits contactPoint — the support phone is not on the landing', () => {
    const org = organizationJsonLd() as Record<string, unknown>;

    expect(org['contactPoint']).toBeUndefined();
    expect(org['telephone']).toBeUndefined();
  });

  it('prices every offer in BRL with two decimals', () => {
    expect(offers().length).toBeGreaterThan(0);
    for (const offer of offers()) {
      expect(offer['@type']).toBe('Offer');
      expect(offer.priceCurrency).toBe('BRL');
      expect(offer.price).toMatch(/^\d+\.\d{2}$/);
    }
  });

  /**
   * Standalone `Product` nodes used to repeat the same three plans. Two schema.org nodes
   * describing one product is a duplicate entity, and they shipped without `image` and
   * with a bare `@id` as `brand`. For software the canonical shape is
   * `SoftwareApplication.offers` — this asserts nothing brings the duplicates back.
   */
  it('publishes prices ONLY through SoftwareApplication.offers', async () => {
    const module = (await import('./landing-structured-data')) as Record<string, unknown>;

    expect(module['pricingJsonLd']).toBeUndefined();
  });

  /**
   * The whole point of `landing-plans.ts`: structured data that advertises a price the
   * page does not show is a Google policy violation. This renders the real pricing cards
   * and asserts the numbers agree.
   */
  describe('agreement with the rendered pricing cards', () => {
    let rendered: string;

    beforeEach(async () => {
      (
        globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }
      ).IntersectionObserver = IntersectionObserverStub;
      await TestBed.configureTestingModule({
        imports: [LandingPricingComponent],
        providers: [provideRouter([])],
      }).compileComponents();
      const fixture = TestBed.createComponent(LandingPricingComponent);
      fixture.detectChanges();
      rendered = (fixture.nativeElement as HTMLElement).textContent ?? '';
    });

    it('shows every plan the JSON-LD advertises', () => {
      for (const plan of ['Trial', 'Pro', 'Enterprise']) {
        expect(rendered).toContain(plan);
      }
    });

    it('shows the monthly price of every paid plan', () => {
      const monthly = [PLAN_PRICES.proMonthly, PLAN_PRICES.enterpriseMonthly];
      // Todo preço mensal do JSON-LD tem de estar entre os que os cards exibem.
      const advertised = offers().map((o) => o.price);

      for (const price of monthly) {
        expect(advertised).toContain(price.toFixed(2));
        expect(rendered).toContain(`R$ ${price.toFixed(2).replace('.', ',')}`);
      }
      // O trial sai como "R$ 0" no card e como offer de preço zero no JSON-LD.
      expect(advertised).toContain('0.00');
      expect(rendered).toContain('R$ 0');
    });
  });

  /**
   * FAQ marcada que a página não mostra é violação de política do Google, não só um
   * detalhe. Este bloco renderiza a FAQ de verdade e confere par a par.
   */
  describe('FAQPage', () => {
    interface Question {
      readonly '@type': string;
      readonly name: string;
      readonly acceptedAnswer: { readonly '@type': string; readonly text: string };
    }

    function questions(): readonly Question[] {
      return (faqPageJsonLd() as { mainEntity: readonly Question[] }).mainEntity;
    }

    it('emits one Question per FAQ entry, each with an Answer', () => {
      const node = faqPageJsonLd() as Record<string, unknown>;

      expect(node['@type']).toBe('FAQPage');
      expect(questions().length).toBe(LANDING_FAQS.length);
      for (const question of questions()) {
        expect(question['@type']).toBe('Question');
        expect(question.acceptedAnswer['@type']).toBe('Answer');
        expect(question.acceptedAnswer.text.length).toBeGreaterThan(0);
      }
    });

    it('marks up the question the ICP with a single car asks', () => {
      expect(questions().map((q) => q.name)).toContain(
        'Tenho só 1 carro alugado. O MyCarsHub é pra mim?',
      );
    });

    it('marks up nothing the FAQ section does not actually render', async () => {
      (
        globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }
      ).IntersectionObserver = IntersectionObserverStub;
      await TestBed.configureTestingModule({ imports: [LandingFaqComponent] }).compileComponents();
      const fixture = TestBed.createComponent(LandingFaqComponent);
      fixture.detectChanges();
      const rendered = (fixture.nativeElement as HTMLElement).textContent ?? '';

      for (const question of questions()) {
        expect(rendered).toContain(question.name);
        expect(rendered).toContain(question.acceptedAnswer.text);
      }
    });

    /**
     * O trial anuncia 3 veículos em `plan-limits.ts`; a resposta ao dono de 1 carro só
     * convence se o número bater. Se a `plans` mudar, este teste quebra junto.
     */
    it('keeps the single-car answer consistent with the advertised trial capacity', () => {
      const answer = questions().find((q) => q.name.startsWith('Tenho só 1 carro'))?.acceptedAnswer
        .text;

      expect(answer).toContain('até 3 veículos');
    });
  });
});
