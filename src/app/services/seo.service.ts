import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

/**
 * Production origin — the SINGLE source of truth for the canonical host.
 *
 * Canonical/OG URLs MUST be absolute, so they cannot be derived from `location` (absent
 * during prerender) nor from `environment.apiUrl` (a path). Everything generated at
 * runtime flows from here: canonical, `og:url`, and every `@id`/`url` in the JSON-LD
 * (`pages/landing/landing-structured-data.ts`, `services/structured-data.ts`,
 * `pages/blog/blog-structured-data.ts`).
 *
 * CHOOSING www VS NON-www IS THIS ONE LINE. `www.` and the bare host are different URLs
 * to Google; whichever is not canonical must 301 to the one that is, at the host
 * (Vercel), or the two compete and split the ranking signal.
 *
 * STATIC MIRRORS — three files repeat this origin as literal text because they cannot
 * import a TS constant:
 *   - `public/robots.txt`   (header comment + the `Sitemap:` line)  — AUTO
 *   - `public/sitemap.xml`  (every `<loc>`)                         — AUTO
 *   - `src/index.html`      (`og:url`, `og:image`, `twitter:image`) — MANUAL
 *
 * The two marked AUTO are re-emitted into the build output by
 * `scripts/generate-sitemap.mjs` (the `postbuild` hook) with this value substituted, so
 * changing the host really is this one line for them. `src/index.html` is the prerender
 * template and nothing rewrites it — it must be edited by hand.
 *
 * `services/seo-origin.spec.ts` fails if any of the three drifts, so a missed edit shows
 * up as a named test failure instead of a split ranking signal in production.
 */
export const SITE_ORIGIN = 'https://www.mycarshub.app.br';

/**
 * Brand suffix appended to EVERY `<title>`. Declared here rather than in
 * `page-title.strategy.ts` because both writers of the title need it — the strategy on
 * navigation and `SeoService.setTitle` at runtime — and importing it the other way round
 * would make the two modules circular.
 */
export const BRAND = 'MyCarsHub';

/** `Relatórios` → `Relatórios — MyCarsHub`; nothing usable → the brand alone. */
export function brandedTitle(pageTitle?: string): string {
  return pageTitle ? `${pageTitle} — ${BRAND}` : BRAND;
}

/** Fallback description — mirrors the static one in `src/index.html`. */
export const DEFAULT_DESCRIPTION =
  'MyCarsHub — sistema para quem aluga carros para motoristas de aplicativo: ' +
  'contratos, cobranças, multas, manutenções e vistorias em um só lugar.';

/** Per-route SEO payload, carried in `Route.data.seo`. */
export interface RouteSeo {
  /** Meta description. Aim for 120–160 chars. */
  readonly description: string;
  /**
   * Canonical path, `/`-prefixed, WITHOUT query string. Defaults to the resolved URL
   * path. Legal pages set it explicitly so `?lang=en` collapses onto the PT canonical.
   */
  readonly canonicalPath?: string;
}

interface SeoInput {
  readonly title: string;
  readonly urlPath: string;
  readonly seo?: RouteSeo;
}

/**
 * Owns the `<head>`: description, canonical, Open Graph, Twitter Card, robots and
 * JSON-LD. Driven by `PageTitleStrategy` on each navigation; the title itself is written
 * by that strategy, and only re-written here by `setTitle` for pages whose real headline
 * exists just at runtime.
 *
 * Only `Title`, `Meta` and `DOCUMENT` are used, never `document`/`window` globals, so the
 * whole service runs unchanged under prerender (`@angular/ssr`) — that is what puts the
 * tags into the static HTML the crawler receives.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  /**
   * Applies the head tags for a navigation.
   *
   * Routes WITHOUT `data.seo` are treated as private surface: `noindex, nofollow` and
   * no canonical. Fail-closed on purpose — the authenticated app must never be indexed,
   * and a new route that forgets `seo` gets the safe behaviour by default.
   */
  applyRouteSeo({ title, urlPath, seo }: SeoInput): void {
    const description = seo?.description ?? DEFAULT_DESCRIPTION;
    const isPublic = seo !== undefined;

    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({
      name: 'robots',
      content: isPublic ? 'index, follow' : 'noindex, nofollow',
    });

    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });

    if (isPublic) {
      const canonical = absoluteUrl(seo.canonicalPath ?? urlPath);
      this.setCanonical(canonical);
      this.meta.updateTag({ property: 'og:url', content: canonical });
    } else {
      this.removeCanonical();
      this.meta.updateTag({ property: 'og:url', content: SITE_ORIGIN });
    }
  }

  /**
   * Overwrites the title (and the `og:`/`twitter:` mirrors of it) for pages whose real
   * headline exists just at runtime.
   *
   * Same defect as `setDescription`, on the stronger signal: `PageTitleStrategy` resolves
   * `/blog/:slug` from `data.pageTitle`, which is the literal string `Blog` for every
   * post. Prerendering bakes that into each static file, so without this every post ships
   * `<title>Blog — MyCarsHub</title>` and they are indistinguishable in search results.
   *
   * Callers pass the BARE headline: the brand suffix is applied here through
   * `brandedTitle`, the same helper the strategy uses, so the convention has one home.
   * Blank input is ignored, which leaves the route's static title standing — never an
   * empty or `undefined` title.
   */
  setTitle(headline: string): void {
    const clamped = clampText(headline, MAX_TITLE);
    if (!clamped) {
      return;
    }
    const full = brandedTitle(clamped);
    this.title.setTitle(full);
    this.meta.updateTag({ property: 'og:title', content: full });
    this.meta.updateTag({ name: 'twitter:title', content: full });
  }

  /**
   * Overwrites ONLY the description tags, for pages whose real description exists just at
   * runtime.
   *
   * `applyRouteSeo` runs on navigation with the static `data.seo.description`. For
   * `/blog/:slug` that is one sentence shared by every post — duplicate meta descriptions
   * on exactly the content the blog exists to rank. A component that resolves its own
   * description (the post's `metaDescription`/`excerpt`) calls this when the data lands;
   * the next navigation resets everything through `applyRouteSeo` as usual.
   *
   * Empty/blank input is ignored so a post without a description keeps the route default
   * instead of publishing an empty tag.
   */
  setDescription(description: string): void {
    const content = clampText(description, MAX_DESCRIPTION);
    if (!content) {
      return;
    }
    this.meta.updateTag({ name: 'description', content });
    this.meta.updateTag({ property: 'og:description', content });
    this.meta.updateTag({ name: 'twitter:description', content });
  }

  /**
   * Demotes the CURRENT page to `noindex, nofollow` and withdraws its canonical.
   *
   * For a page that resolves its content at runtime and finds none — `/blog/<slug>` for a
   * slug that does not exist. `applyRouteSeo` has already run by then and, because the
   * route is public, has published `index, follow` plus a canonical: a soft 404 served
   * with HTTP 200 that actively asks to be indexed. The build-time generator prunes that
   * case out of the static output, but the runtime path is the NORMAL one for any slug
   * published since the last deploy, and nothing prunes it there.
   *
   * The tags written here are exactly the ones `applyRouteSeo` writes for a route with no
   * `data.seo`, so failing closed at runtime and failing closed by default land on the
   * same head. The next navigation resets everything through `applyRouteSeo` as usual.
   */
  markNotFound(): void {
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    this.removeCanonical();
    this.meta.updateTag({ property: 'og:url', content: SITE_ORIGIN });
  }

  /**
   * Upserts a `<script type="application/ld+json">` in `<head>`, keyed by `id`.
   *
   * Keyed so the client re-render after hydration replaces the prerendered block
   * instead of appending a duplicate.
   */
  setJsonLd(id: string, payload: unknown): void {
    const head = this.document.head;
    if (!head) {
      return;
    }
    const existing = head.querySelector<HTMLScriptElement>(`script[data-seo-jsonld="${id}"]`);
    const script = existing ?? this.document.createElement('script');
    script.setAttribute('type', 'application/ld+json');
    script.setAttribute('data-seo-jsonld', id);
    // `<` is escaped so a stray "</script>" inside data can never close the tag.
    script.textContent = JSON.stringify(payload).replace(/</g, '\\u003c');
    if (!existing) {
      head.appendChild(script);
    }
  }

  removeJsonLd(id: string): void {
    this.document.head?.querySelector(`script[data-seo-jsonld="${id}"]`)?.remove();
  }

  private setCanonical(href: string): void {
    const head = this.document.head;
    if (!head) {
      return;
    }
    const existing = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const link = existing ?? this.document.createElement('link');
    link.setAttribute('rel', 'canonical');
    link.setAttribute('href', href);
    if (!existing) {
      head.appendChild(link);
    }
  }

  private removeCanonical(): void {
    this.document.head?.querySelector('link[rel="canonical"]')?.remove();
  }
}

/** Search results cut around 160 characters; anything longer is noise in the `<head>`. */
const MAX_DESCRIPTION = 160;

/**
 * Budget for the BARE headline, before ` — MyCarsHub` (12 more characters) is appended.
 * Google cuts the title around 60 characters, so this keeps the common case whole while
 * still leaving a long headline readable — clipping it harder would cost more meaning
 * than the truncation saves.
 */
const MAX_TITLE = 60;

/** Collapses whitespace and trims at a word boundary, never mid-word. */
function clampText(raw: string, max: number): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

/** `/precos` → `https://www.mycarshub.app.br/precos`; `/` → `https://www.mycarshub.app.br/`. */
function absoluteUrl(path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  return `${SITE_ORIGIN}${clean.startsWith('/') ? clean : `/${clean}`}`;
}
