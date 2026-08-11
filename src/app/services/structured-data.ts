import { SITE_ORIGIN } from './seo.service';

/**
 * schema.org blocks that are not tied to one page's editorial content.
 *
 * Same rule as `pages/landing/landing-structured-data.ts`: every field must be
 * verifiable against something the page really shows. A breadcrumb whose labels do not
 * match the visible navigation is exactly the kind of contradiction Google demotes for.
 */

/** One hop of a breadcrumb trail. `path` is `/`-prefixed and query-free. */
export interface BreadcrumbHop {
  readonly name: string;
  readonly path: string;
}

/** Stable id for the breadcrumb of a given page path — one block per URL. */
export const BREADCRUMB_JSONLD_ID = 'breadcrumb';

/**
 * `BreadcrumbList` for a public page.
 *
 * The trail must start at the home page and end at the current page, mirroring the
 * "Voltar para…" / nav links the page actually renders. The last hop keeps its `item`:
 * Google allows omitting it, but an explicit self URL is unambiguous and matches the
 * canonical the page already emits.
 */
export function breadcrumbListJsonLd(trail: readonly BreadcrumbHop[]): unknown {
  const last = trail.at(-1);
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    '@id': `${absoluteUrl(last?.path ?? '/')}#breadcrumb`,
    itemListElement: trail.map((hop, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: hop.name,
      item: absoluteUrl(hop.path),
    })),
  };
}

/** `/blog` → `https://…/blog`. Absolute inputs (an external CDN cover) pass through. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const clean = pathOrUrl.split('?')[0].split('#')[0];
  return `${SITE_ORIGIN}${clean.startsWith('/') ? clean : `/${clean}`}`;
}
