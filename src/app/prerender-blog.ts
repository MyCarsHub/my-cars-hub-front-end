/**
 * Build-time blog discovery for `getPrerenderParams` (`app.routes.server.ts`).
 *
 * SERVER BUNDLE ONLY. Nothing here is reachable from `main.ts`; it is pulled in by
 * `app.routes.server.ts`, which only `app.config.server.ts` (and the specs) import. That
 * is why it may read `process.env` at all.
 *
 * THE CONTRACT THIS FILE EXISTS TO HONOUR: **the build must never fail because of the
 * API.** Render cold starts, a paused backend, a DNS blip, a shape change — every one of
 * them resolves to "return an empty list, log why, let the build finish". An empty list
 * means `/blog/:slug` is simply not prerendered and falls back to client rendering
 * (`PrerenderFallback.Client`), which is exactly the behaviour the site has today. So the
 * worst case of this whole feature is "no worse than before", by construction.
 *
 * A PER-REQUEST timeout is not enough to honour that contract, which is why there is also
 * a WHOLE-RUN deadline. The two loops below are unbounded in their number of requests: a
 * ten-page list walk plus one verification call per slug is ~510 requests, and a backend
 * that is alive but slow — the degraded-Render case this module exists to absorb — pays
 * the full per-request timeout on every one of them. That multiplies out to hours, blows
 * the CI wall clock and FAILS THE DEPLOY: precisely the outcome this file promises cannot
 * happen. So the budget is taken once, at entry, and both loops bail to whatever they have
 * collected when it is spent. Degrading to a partial (or empty) prerender is always
 * correct here — `PrerenderFallback.Client` serves the rest — while overrunning is not.
 *
 * Every value is optional and overridable from the build environment:
 *   - `PRERENDER_API_BASE`       absolute API base, default the production API.
 *   - `PRERENDER_API_TIMEOUT_MS` per-attempt timeout, default 25s (cold start budget).
 *   - `PRERENDER_BUDGET_MS`      whole-run wall-clock budget, default 5min.
 *   - `PRERENDER_BLOG=false`     opt out entirely, for a build that must not touch the net.
 */

/** Default API base. Absolute on purpose: `environment.prod.apiUrl` is the relative
 *  `/api/v1`, which only resolves behind the Vercel rewrite — there is no such origin
 *  during a build. */
const DEFAULT_API_BASE = 'https://api.mycarshub.app.br/v1';

/** Per-attempt timeout. Render free-tier cold starts routinely take ~30s. */
const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Whole-run wall-clock budget, spanning the list walk AND the per-slug verification.
 * Five minutes is enough for a cold start plus a realistic catalogue, and small enough
 * that a slow backend costs the build minutes rather than hours.
 */
const DEFAULT_BUDGET_MS = 300_000;

/**
 * Per-request timeout for the RENDER phase — the API calls `@angular/ssr` makes while it
 * renders each accepted slug, via `PRERENDER_API` in `app.config.server.ts`.
 *
 * IT IS SEPARATE FROM THE ONE ABOVE BECAUSE THE TWO PHASES ARE BOUNDED DIFFERENTLY.
 * `DEFAULT_BUDGET_MS` covers only `blogPrerenderParams`; once that returns, the render
 * phase begins and NOTHING bounds its wall clock but this per-request ceiling times the
 * number of accepted slugs. The params phase already paid for the cold start (three
 * attempts on the first list page) and already warmed every accepted slug through
 * `slugIsFetchable`, so by the time rendering starts the API is warm and 10s is a long
 * time; a request that overruns it renders the error branch, which
 * `scripts/generate-sitemap.mjs` prunes. See `blogRenderTimeoutMs` for why this is a
 * CEILING rather than a default.
 */
const DEFAULT_RENDER_TIMEOUT_MS = 10_000;

/**
 * Hard ceiling on how many posts one build will prerender, independent of the clock. The
 * budget bounds a SLOW backend; this bounds a FAST one with a large catalogue, where each
 * extra post is also an extra rendered document and an extra sitemap entry. Posts beyond
 * the cap are not lost — they fall back to client rendering like any unprerendered slug.
 *
 * THE NUMBER IS DERIVED, NOT PICKED. It is the render phase's only bound, so it has to
 * multiply out to something that fits inside the build:
 *
 *   50 slugs x 1 API call each x 10s ceiling  =  500s
 *   + the `/blog` list page                   =   10s
 *   + the params phase (DEFAULT_BUDGET_MS)    =  300s
 *   ------------------------------------------------
 *   worst case, fully serial, backend at the ceiling on every call = 810s = 13.5 min
 *
 * against Vercel's 45-minute build ceiling (2700s), leaving ~31 min for the compile — an
 * order of magnitude more than it takes. The old pairing (200 x 25s = 5000s = 83 min)
 * blew that ceiling on its own, and `@angular/ssr`'s worker pool did not save it: ~4
 * workers still meant ~21 min of pure waiting, ~42 min on a 2-core runner. Nothing above
 * assumes any parallelism, so the pool is headroom rather than a load-bearing assumption.
 */
const MAX_PRERENDERED = 50;

/** Attempts for the LIST call. The first one is what pays for the cold start. */
const LIST_ATTEMPTS = 3;

/** Hard ceiling on pages walked, so a broken `total` cannot spin the build forever. */
const MAX_PAGES = 10;

/** Page size for the list walk. */
const PAGE_SIZE = 50;

/**
 * Characters that genuinely break a single path segment, and therefore the only grounds
 * for dropping a slug.
 *
 * This deliberately does NOT enforce a house style. `BlogPostRequest.slug` is a bare
 * `string` on the backend with no shape contract, so `LGPD_2026`, `Guia--2026-` and an
 * accented slug are all live, linkable pages. A stricter pattern here does not make them
 * invalid — it silently excludes them from BOTH the prerender and the sitemap, which is
 * the opposite of what this module is for. Anything that survives is escaped with
 * `encodeURIComponent` where it is put in a URL rather than trusted verbatim.
 *
 * `%` IS HERE FOR THE SITEMAP, NOT FOR THE FETCH. `slugIsFetchable` encodes the slug, so
 * `desconto-50%` verifies happily and gets accepted — but the RAW slug becomes the output
 * directory name, and `scripts/generate-sitemap.mjs` reads that name straight into
 * `<loc>https://…/blog/desconto-50%</loc>`. `escapeXml` does not touch `%` (it is not an
 * XML metacharacter), and a bare `%` is an invalid percent-escape, so Google rejects that
 * `<loc>` outright. Dropping the slug costs one client-rendered page; keeping it risks the
 * sitemap. (Distinct from an accented slug, which is valid-but-unencoded, not invalid.)
 */
const UNSAFE_IN_PATH_SEGMENT = /[\s/\\?#%]/;

/** `.` and `..` are legal strings but traversal as path segments. */
const TRAVERSAL_SEGMENTS = new Set(['.', '..']);

function isUsableSlug(slug: string): boolean {
  return slug.length > 0 && !UNSAFE_IN_PATH_SEGMENT.test(slug) && !TRAVERSAL_SEGMENTS.has(slug);
}

type EnvBag = Readonly<Record<string, string | undefined>>;

/** Reads `process.env` without pulling `@types/node` into the app tsconfig. */
function env(): EnvBag {
  const host = globalThis as { process?: { env?: EnvBag } };
  return host.process?.env ?? {};
}

export function blogApiBase(): string {
  return env()['PRERENDER_API_BASE']?.replace(/\/+$/, '') || DEFAULT_API_BASE;
}

/**
 * INTEGER, not merely finite. This value is handed to `HttpRequest.timeout` (via
 * `PRERENDER_API` in `app.config.server.ts`), and Angular rejects a fractional timeout
 * with `RuntimeError 2822` on EVERY request — so `PRERENDER_API_TIMEOUT_MS=2500.5` would
 * not slow the prerender down, it would turn every blog page into an error page, quietly.
 * A malformed override falls back to the default instead of poisoning the build.
 */
export function blogPrerenderTimeoutMs(): number {
  const raw = Number(env()['PRERENDER_API_TIMEOUT_MS']);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * Per-request timeout for the RENDER phase (`PRERENDER_API`, `app.config.server.ts`).
 *
 * A CEILING, deliberately, not a default: `Math.min` means an operator who raises
 * `PRERENDER_API_TIMEOUT_MS` to buy the params phase more cold-start patience cannot also
 * multiply the render phase's unbounded wall clock by the same factor. Lowering it still
 * lowers both, which is the direction that is always safe. This is what makes the
 * `MAX_PRERENDERED x timeout` arithmetic above a guarantee rather than a default — no
 * build environment can push the render phase past 50 x 10s.
 */
export function blogRenderTimeoutMs(): number {
  return Math.min(blogPrerenderTimeoutMs(), DEFAULT_RENDER_TIMEOUT_MS);
}

/**
 * Whole-run budget. `0` is honoured (prerender nothing); only garbage falls back.
 *
 * THE BLANK CHECK IS NOT DEFENSIVE PADDING. Vercel stores an emptied environment variable
 * as an empty STRING rather than unsetting it, and `Number('')` is `0`, which is an
 * integer and is `>= 0` — so `PRERENDER_BUDGET_MS=""` would sail through as a zero budget:
 * `expired()` true on the very first check, zero posts prerendered, zero blog entries in
 * the sitemap, build green and not one word logged about why. `Number(' ')` is `0` too,
 * hence the trim. The sibling above is immune only because it insists on `> 0`; rejecting
 * blank before `Number()` is what makes the two guards agree.
 */
export function blogPrerenderBudgetMs(): number {
  const text = env()['PRERENDER_BUDGET_MS']?.trim();
  if (!text) {
    return DEFAULT_BUDGET_MS;
  }
  const raw = Number(text);
  return Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_BUDGET_MS;
}

export function blogPrerenderEnabled(): boolean {
  return env()['PRERENDER_BLOG'] !== 'false';
}

function warn(message: string): void {
  console.warn(`[prerender:blog] ${message} Falling back to client rendering for /blog/:slug.`);
}

/** One bounded GET. Rejects on timeout, transport error or non-2xx. */
async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(blogPrerenderTimeoutMs()),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return (await response.json()) as unknown;
}

/** True once the whole-run budget taken at entry is spent. */
function expired(deadline: number): boolean {
  return Date.now() >= deadline;
}

/**
 * `PagedResponse<BlogPostListItem>` narrowing that trusts nothing about the payload.
 *
 * `count` is the RAW number of entries the page carried, before any filtering, and it is
 * separate from `slugs.length` on purpose — see the walk below.
 */
function readSlugs(payload: unknown): { slugs: string[]; count: number; total?: number } {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('list payload is not an object');
  }
  const bag = payload as { content?: unknown; total?: unknown };
  if (!Array.isArray(bag.content)) {
    throw new Error('list payload has no `content` array');
  }
  const slugs: string[] = [];
  for (const entry of bag.content) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const item = entry as { slug?: unknown; status?: unknown };
    // The public endpoint only returns PUBLISHED, but a draft leaking into the sitemap
    // is unrecoverable, so the filter is repeated here rather than assumed.
    if (item.status !== undefined && item.status !== 'PUBLISHED') {
      continue;
    }
    if (typeof item.slug === 'string' && isUsableSlug(item.slug)) {
      slugs.push(item.slug);
    }
  }
  // `total` is left UNDEFINED when the payload does not carry one, never defaulted to
  // `slugs.length`: a page whose entries were all filtered out would report `0` and stop
  // the walk on the same false signal the `count` check below exists to avoid.
  return {
    slugs,
    count: bag.content.length,
    total: typeof bag.total === 'number' ? bag.total : undefined,
  };
}

/** Walks the paged list, retrying the FIRST page to absorb a cold start. */
async function fetchPublishedSlugs(base: string, deadline: number): Promise<string[]> {
  const collected: string[] = [];
  // RAW entries seen, not usable slugs kept. `total` is the API's own count of ELEMENTS,
  // so comparing it against `collected.length` compares two different quantities: one page
  // with a single draft on it makes the filtered count lag the raw one permanently, the
  // condition never goes false, and the walk runs to `MAX_PAGES` every time — up to five
  // wasted round trips, charged to the very wall clock the verification loop still needs.
  let seen = 0;
  let page = 0;
  let total = Number.POSITIVE_INFINITY;

  while (page < MAX_PAGES && seen < total) {
    if (expired(deadline)) {
      warn(`Wall-clock budget spent after ${page} list page(s); keeping what was collected.`);
      break;
    }
    const url = `${base}/blog?page=${page}&size=${PAGE_SIZE}`;
    const attempts = page === 0 ? LIST_ATTEMPTS : 1;
    let payload: unknown;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        payload = await getJson(url);
        lastError = undefined;
        break;
      } catch (error: unknown) {
        lastError = error;
      }
    }
    if (lastError !== undefined) {
      throw lastError;
    }

    const { slugs, count, total: reported } = readSlugs(payload);
    if (reported !== undefined) {
      total = reported;
    }
    // Stop on a genuinely EMPTY page, not on a page that yielded no usable slug. Those are
    // different facts: a page can be full of drafts, or of slugs this module rejects, and
    // treating that as the end of the list silently drops every page after it — exactly
    // the posts a paged walk exists to reach.
    if (count === 0) {
      break;
    }
    collected.push(...slugs);
    seen += count;
    page++;
  }

  return [...new Set(collected)];
}

/**
 * Confirms `GET /blog/{slug}` answers before we commit to prerendering it.
 *
 * This is not paranoia about the list being wrong — it is about WHAT PRERENDER EMITS.
 * `BlogDetail` renders `.blog-detail__error` ("Post não encontrado") when its fetch
 * fails, and prerender would freeze that error page into static HTML and serve it to
 * Googlebot. A 404 page that returns 200 is worse for indexing than no page at all, so a
 * slug we cannot fetch here is simply not prerendered. It also warms the API, which makes
 * the render-time fetch that follows a cache-warm hit rather than a second cold start.
 */
async function slugIsFetchable(base: string, slug: string): Promise<boolean> {
  try {
    const payload = await getJson(`${base}/blog/${encodeURIComponent(slug)}`);
    return (
      typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as { bodyHtml?: unknown }).bodyHtml === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * `getPrerenderParams` for `/blog/:slug`. NEVER rejects, NEVER throws — the return type
 * is the whole point: `[]` is a valid, successful build.
 */
export async function blogPrerenderParams(): Promise<Record<string, string>[]> {
  if (!blogPrerenderEnabled()) {
    warn('Disabled via PRERENDER_BLOG=false.');
    return [];
  }

  // ONE budget for the whole run, taken before the first byte moves. Both loops below
  // check it; neither can be bounded by the per-request timeout alone.
  const deadline = Date.now() + blogPrerenderBudgetMs();

  const base = blogApiBase();
  let slugs: string[];
  try {
    slugs = await fetchPublishedSlugs(base, deadline);
  } catch (error: unknown) {
    warn(`Could not list posts from ${base}: ${describe(error)}.`);
    return [];
  }

  if (slugs.length === 0) {
    // Not a failure: the blog is simply empty. Said plainly so an empty sitemap after a
    // deploy is not mistaken for a broken fetch.
    warn('The API returned no published posts, so there is nothing to prerender.');
    return [];
  }

  const usable: Record<string, string>[] = [];
  for (const slug of slugs) {
    if (usable.length >= MAX_PRERENDERED) {
      warn(`Reached the ${MAX_PRERENDERED}-post cap; the remaining posts are not prerendered.`);
      break;
    }
    if (expired(deadline)) {
      warn(`Wall-clock budget spent after verifying ${usable.length} post(s); stopping here.`);
      break;
    }
    if (await slugIsFetchable(base, slug)) {
      usable.push({ slug });
    } else {
      warn(`Skipping "${slug}": GET /blog/${slug} did not return a usable post.`);
    }
  }
  return usable;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
