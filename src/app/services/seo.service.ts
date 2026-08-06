import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';

/**
 * Production origin. Canonical/OG URLs MUST be absolute, so they cannot be derived
 * from `location` (absent during prerender) nor from `environment.apiUrl` (a path).
 */
export const SITE_ORIGIN = 'https://mycarshub.app.br';

/** Fallback description — mirrors the static one in `src/index.html`. */
export const DEFAULT_DESCRIPTION =
  'MyCarsHub — plataforma completa para gestão de locadoras: veículos, motoristas, ' +
  'aluguéis, cobranças e relatórios em um só lugar.';

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
 * Owns every `<head>` tag that is not the title: description, canonical, Open Graph,
 * Twitter Card, robots and JSON-LD. Driven by `PageTitleStrategy` on each navigation.
 *
 * Only `Meta` and `DOCUMENT` are used, never `document`/`window` globals, so the whole
 * service runs unchanged under prerender (`@angular/ssr`) — that is what puts the tags
 * into the static HTML the crawler receives.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
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
    const content = clampDescription(description);
    if (!content) {
      return;
    }
    this.meta.updateTag({ name: 'description', content });
    this.meta.updateTag({ property: 'og:description', content });
    this.meta.updateTag({ name: 'twitter:description', content });
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

/** Collapses whitespace and trims at a word boundary, never mid-word. */
function clampDescription(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length <= MAX_DESCRIPTION) {
    return text;
  }
  const cut = text.slice(0, MAX_DESCRIPTION - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

/** `/precos` → `https://mycarshub.app.br/precos`; `/` → `https://mycarshub.app.br/`. */
function absoluteUrl(path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  return `${SITE_ORIGIN}${clean.startsWith('/') ? clean : `/${clean}`}`;
}
