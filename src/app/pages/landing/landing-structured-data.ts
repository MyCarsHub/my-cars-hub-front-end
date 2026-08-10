import { SITE_ORIGIN } from '../../services/seo.service';
import { LANDING_FAQS } from './landing-faqs';
import { ENTERPRISE_YEARLY_TOTAL, PLAN_PRICES } from './landing-plans';

/**
 * schema.org blocks for the landing page.
 *
 * RULE: every field here must be verifiable against something the app really shows.
 * Fields with no trustworthy source are OMITTED, never guessed — notably
 * `aggregateRating`/`review` (the landing carries NO customer testimonial at all: the six
 * that used to sit there were not real, and the section was replaced by build-in-public
 * proof), `sku`/`gtin` (plans have no such identifiers) and `contactPoint` (the support
 * number only appears on authenticated screens, never on the landing itself).
 */

const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;
const SOFTWARE_ID = `${SITE_ORIGIN}/#software`;
const FAQ_ID = `${SITE_ORIGIN}/#faq`;
const PRICING_URL = `${SITE_ORIGIN}/#planos`;

const SOFTWARE_DESCRIPTION =
  'Plataforma de gestão para quem aluga carros para motoristas de aplicativo: cadastro ' +
  'de veículos e motoristas, aluguéis e contratos, cobranças automáticas, multas, ' +
  'manutenções e relatórios — de 1 carro a uma frota inteira.';

export function organizationJsonLd(): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: 'MyCarsHub',
    url: `${SITE_ORIGIN}/`,
    logo: `${SITE_ORIGIN}/icons/icon-512.png`,
    image: `${SITE_ORIGIN}/png/og-image.png`,
    description: SOFTWARE_DESCRIPTION,
  };
}

export function softwareApplicationJsonLd(): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_ID,
    name: 'MyCarsHub',
    url: `${SITE_ORIGIN}/`,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Fleet & rental management',
    operatingSystem: 'Web',
    inLanguage: 'pt-BR',
    description: SOFTWARE_DESCRIPTION,
    publisher: { '@id': ORGANIZATION_ID },
    offers: planOffers(),
  };
}

/**
 * `FAQPage` para a seção de dúvidas da landing.
 *
 * Cada `Question` sai de `LANDING_FAQS`, que é a MESMA lista que o
 * `LandingFaqComponent` renderiza — a política do Google exige que todo par
 * pergunta/resposta marcado esteja visível na página. Duplicar o texto aqui seria
 * exatamente o jeito de a marcação passar a descrever algo que a página não mostra.
 */
export function faqPageJsonLd(): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': FAQ_ID,
    inLanguage: 'pt-BR',
    isPartOf: { '@id': SOFTWARE_ID },
    mainEntity: LANDING_FAQS.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  };
}

/** All offers share currency, seller and availability; only price/duration differ. */
function offer(price: number, unit?: 'MONTH' | 'YEAR'): unknown {
  return {
    '@type': 'Offer',
    price: price.toFixed(2),
    priceCurrency: 'BRL',
    availability: 'https://schema.org/InStock',
    url: PRICING_URL,
    seller: { '@id': ORGANIZATION_ID },
    ...(unit
      ? {
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: price.toFixed(2),
            priceCurrency: 'BRL',
            billingDuration: 1,
            billingIncrement: 1,
            unitCode: unit === 'MONTH' ? 'MON' : 'ANN',
          },
        }
      : {}),
  };
}

/**
 * Every price the pricing section (`/#planos`) advertises, as the `offers` of the single
 * `SoftwareApplication` node.
 *
 * This is the ONLY place prices are emitted. Standalone `Product` nodes used to duplicate
 * the same offers with no `image` and a bare `@id` brand — for software the canonical
 * shape is `SoftwareApplication.offers`, and two nodes describing the same thing is a
 * duplicate-entity problem, not extra coverage.
 */
function planOffers(): unknown[] {
  return [
    offer(0),
    offer(PLAN_PRICES.proMonthly, 'MONTH'),
    offer(PLAN_PRICES.proYearlyTotal, 'YEAR'),
    offer(PLAN_PRICES.enterpriseMonthly, 'MONTH'),
    offer(ENTERPRISE_YEARLY_TOTAL, 'YEAR'),
  ];
}
