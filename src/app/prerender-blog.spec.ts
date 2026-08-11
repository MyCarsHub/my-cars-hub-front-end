import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  blogPrerenderBudgetMs,
  blogPrerenderParams,
  blogPrerenderTimeoutMs,
  blogRenderTimeoutMs,
} from './prerender-blog';

/**
 * THE BUILD MUST NEVER FAIL BECAUSE OF THE BLOG API.
 *
 * `blogPrerenderParams` runs inside `ng build` (see `app.routes.server.ts`). If it
 * rejects, the whole production build dies — and the API it talks to is a Render
 * instance that cold-starts, gets paused, and is redeployed independently of the
 * frontend. So a cold start, a 500, a timeout or a shape change are NORMAL conditions
 * here, not exceptional ones, and every one of them must resolve to `[]`: no blog page
 * prerendered, `/blog/:slug` served by the client shell, deploy green.
 *
 * These tests are the contract. A future refactor that lets an error escape this function
 * takes production deploys down with it, and that is what must fail here first.
 */
describe('blogPrerenderParams (build-time, must never throw)', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // Keep each case bounded: the retry loop would otherwise burn its real 25s budget.
    process.env['PRERENDER_API_TIMEOUT_MS'] = '50';
    delete process.env['PRERENDER_BLOG'];
    delete process.env['PRERENDER_BUDGET_MS'];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env['PRERENDER_API_TIMEOUT_MS'];
    delete process.env['PRERENDER_BLOG'];
    delete process.env['PRERENDER_BUDGET_MS'];
    vi.restoreAllMocks();
  });

  /** Minimal `Response` stand-in — only the members the module actually reads. */
  function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
  }

  it('returns an empty list when the API is unreachable', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')));

    await expect(blogPrerenderParams()).resolves.toEqual([]);
  });

  it('returns an empty list when the request times out', async () => {
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('TimeoutError')), 5)),
    );

    await expect(blogPrerenderParams()).resolves.toEqual([]);
  });

  it('returns an empty list on a 5xx, which is what a cold Render instance answers', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(jsonResponse(null, false, 503)));

    await expect(blogPrerenderParams()).resolves.toEqual([]);
  });

  it('returns an empty list when the payload is not the paged shape', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(jsonResponse({ items: [{ slug: 'a' }] })));

    await expect(blogPrerenderParams()).resolves.toEqual([]);
  });

  it('returns an empty list when the API answers with no published posts', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ content: [], page: 0, size: 50, total: 0 })),
    );

    await expect(blogPrerenderParams()).resolves.toEqual([]);
  });

  it('returns an empty list when PRERENDER_BLOG=false, without touching the network', async () => {
    process.env['PRERENDER_BLOG'] = 'false';
    const fetchSpy = vi.fn(() => Promise.reject(new Error('must not be called')));
    globalThis.fetch = fetchSpy;

    await expect(blogPrerenderParams()).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('prerenders the slugs the API really serves', async () => {
    globalThis.fetch = vi.fn((input: string | URL | Request) =>
      Promise.resolve(
        String(input).includes('/blog?')
          ? jsonResponse({
              content: [
                { slug: 'como-cobrar-diaria', status: 'PUBLISHED' },
                { slug: 'checklist-vistoria', status: 'PUBLISHED' },
              ],
              page: 0,
              size: 50,
              total: 2,
            })
          : jsonResponse({ bodyHtml: '<p>conteúdo</p>' }),
      ),
    ) as typeof fetch;

    await expect(blogPrerenderParams()).resolves.toEqual([
      { slug: 'como-cobrar-diaria' },
      { slug: 'checklist-vistoria' },
    ]);
  });

  /**
   * A slug whose detail call fails is DROPPED, not prerendered. Prerendering it would
   * freeze `BlogDetail`'s "Post não encontrado" branch into static HTML and serve that
   * with HTTP 200 — a soft 404 aimed straight at Googlebot. Dropping it costs nothing:
   * the path still resolves through the client shell.
   */
  it('drops a listed slug whose detail endpoint does not serve a post', async () => {
    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/blog?')) {
        return Promise.resolve(
          jsonResponse({
            content: [
              { slug: 'post-bom', status: 'PUBLISHED' },
              { slug: 'post-quebrado', status: 'PUBLISHED' },
            ],
            page: 0,
            size: 50,
            total: 2,
          }),
        );
      }
      return url.endsWith('/blog/post-bom')
        ? Promise.resolve(jsonResponse({ bodyHtml: '<p>ok</p>' }))
        : Promise.resolve(jsonResponse(null, false, 404));
    }) as typeof fetch;

    await expect(blogPrerenderParams()).resolves.toEqual([{ slug: 'post-bom' }]);
  });

  /**
   * The public endpoint only returns PUBLISHED, but a DRAFT reaching the sitemap is
   * unrecoverable once Google has it, so the filter is enforced on this side too.
   */
  it('never prerenders a draft, even if the API leaks one into the list', async () => {
    globalThis.fetch = vi.fn((input: string | URL | Request) =>
      Promise.resolve(
        String(input).includes('/blog?')
          ? jsonResponse({
              content: [{ slug: 'rascunho', status: 'DRAFT' }],
              page: 0,
              size: 50,
              total: 1,
            })
          : jsonResponse({ bodyHtml: '<p>ok</p>' }),
      ),
    ) as typeof fetch;

    await expect(blogPrerenderParams()).resolves.toEqual([]);
  });

  /** A slug that is not URL-safe is a backend bug; baking it into a path spreads it. */
  it('drops a slug that is not a clean URL segment', async () => {
    globalThis.fetch = vi.fn((input: string | URL | Request) =>
      Promise.resolve(
        String(input).includes('/blog?')
          ? jsonResponse({
              content: [{ slug: '../../etc/passwd', status: 'PUBLISHED' }, { slug: '', status: 'PUBLISHED' }],
              page: 0,
              size: 50,
              total: 2,
            })
          : jsonResponse({ bodyHtml: '<p>ok</p>' }),
      ),
    ) as typeof fetch;

    await expect(blogPrerenderParams()).resolves.toEqual([]);
  });

  /**
   * THE AGGREGATE WALL CLOCK, which the per-request timeout does not bound.
   *
   * A backend that is alive but slow answers every one of the ~510 requests this module
   * can make, each just under the per-attempt ceiling. That is hours, and it does not
   * degrade the build — it KILLS it on the CI wall clock, which is the single outcome
   * this file promises is impossible. The budget is taken once at entry and both loops
   * honour it; the three tests below pin each half of that.
   */
  it('does not walk the list at all when the wall-clock budget is already spent', async () => {
    process.env['PRERENDER_BUDGET_MS'] = '0';
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          content: [{ slug: 'post', status: 'PUBLISHED' }],
          page: 0,
          size: 50,
          total: 1,
        }),
      ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(blogPrerenderParams()).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stops verifying slugs once the budget is spent, instead of paying the timeout per slug', async () => {
    process.env['PRERENDER_BUDGET_MS'] = '20';
    let detailCalls = 0;
    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      if (String(input).includes('/blog?')) {
        // The list walk alone outlives the budget: the degraded-but-alive backend.
        return new Promise<Response>((resolve) =>
          setTimeout(
            () =>
              resolve(
                jsonResponse({
                  content: [
                    { slug: 'um', status: 'PUBLISHED' },
                    { slug: 'dois', status: 'PUBLISHED' },
                    { slug: 'tres', status: 'PUBLISHED' },
                  ],
                  page: 0,
                  size: 50,
                  total: 3,
                }),
              ),
            60,
          ),
        );
      }
      detailCalls++;
      return Promise.resolve(jsonResponse({ bodyHtml: '<p>ok</p>' }));
    }) as unknown as typeof fetch;

    await expect(blogPrerenderParams()).resolves.toEqual([]);
    expect(detailCalls).toBe(0);
  });

  it('caps the prerendered set, so a large blog cannot blow the build budget', async () => {
    const catalogue = Array.from({ length: 250 }, (_, i) => ({
      slug: `post-${i}`,
      status: 'PUBLISHED',
    }));
    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/blog?')) {
        const page = Number(/page=(\d+)/.exec(url)?.[1] ?? '0');
        return Promise.resolve(
          jsonResponse({
            content: catalogue.slice(page * 50, page * 50 + 50),
            page,
            size: 50,
            total: catalogue.length,
          }),
        );
      }
      return Promise.resolve(jsonResponse({ bodyHtml: '<p>ok</p>' }));
    }) as unknown as typeof fetch;

    const params = await blogPrerenderParams();

    expect(params).toHaveLength(50);
    expect(params[0]).toEqual({ slug: 'post-0' });
  });

  /**
   * THE RENDER PHASE'S ONLY BOUND. The wall-clock budget covers this function; once it
   * returns, `@angular/ssr` renders every accepted slug and each of those makes its own
   * API call, bounded by nothing but the per-request ceiling times this cap. The pairing
   * has to multiply out to something the build survives:
   *
   *   50 x 10s = 500s render, + 10s for /blog, + 300s params = 810s = 13.5 min < 45 min.
   *
   * The assertion is the product, not the cap, so raising either number alone fails here.
   */
  it('keeps the cap times the render timeout inside the Vercel build ceiling', async () => {
    const VERCEL_BUILD_CEILING_MS = 45 * 60 * 1000;
    const catalogue = Array.from({ length: 250 }, (_, i) => ({
      slug: `post-${i}`,
      status: 'PUBLISHED',
    }));
    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/blog?')) {
        const page = Number(/page=(\d+)/.exec(url)?.[1] ?? '0');
        return Promise.resolve(
          jsonResponse({
            content: catalogue.slice(page * 50, page * 50 + 50),
            page,
            size: 50,
            total: catalogue.length,
          }),
        );
      }
      return Promise.resolve(jsonResponse({ bodyHtml: '<p>ok</p>' }));
    }) as unknown as typeof fetch;

    // The cap, read from the module's own behaviour rather than re-declared here.
    const params = await blogPrerenderParams();

    // …then the REAL production numbers, with the test's 50ms override out of the way.
    delete process.env['PRERENDER_API_TIMEOUT_MS'];
    const worstCaseRenderMs = (params.length + 1) * blogRenderTimeoutMs();
    const worstCaseTotalMs = worstCaseRenderMs + blogPrerenderBudgetMs();

    expect(worstCaseRenderMs).toBe(510_000);
    expect(worstCaseTotalMs).toBeLessThan(VERCEL_BUILD_CEILING_MS);
  });

  /**
   * `total` is the API's count of RAW ELEMENTS; `collected` holds the slugs that SURVIVED
   * filtering. Comparing the two makes the loop condition permanently true the moment one
   * entry is dropped, so the walk runs to `MAX_PAGES` instead of stopping at the end of
   * the catalogue — five wasted round trips, paid out of the wall clock the verification
   * loop still needs, and worst exactly when the backend is already degraded.
   */
  it('stops the walk when the API reports its total is reached, even if entries were filtered out', async () => {
    let listCalls = 0;
    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/blog?')) {
        listCalls++;
        return Promise.resolve(
          jsonResponse({
            content: [
              { slug: 'publicado', status: 'PUBLISHED' },
              { slug: 'rascunho', status: 'DRAFT' },
            ],
            page: 0,
            size: 50,
            total: 2,
          }),
        );
      }
      return Promise.resolve(jsonResponse({ bodyHtml: '<p>ok</p>' }));
    }) as unknown as typeof fetch;

    await expect(blogPrerenderParams()).resolves.toEqual([{ slug: 'publicado' }]);
    expect(listCalls).toBe(1);
  });

  /**
   * `slugIsFetchable` encodes the slug, so a `%` verifies and gets accepted — but the RAW
   * slug becomes the output directory name and lands in `<loc>…/blog/desconto-50%</loc>`.
   * `escapeXml` leaves `%` alone and a bare `%` is an invalid percent-escape, so Google
   * rejects that entry outright. Dropping the slug costs one client-rendered page.
   */
  it('drops a slug containing a percent sign, which cannot appear raw in a sitemap <loc>', async () => {
    globalThis.fetch = vi.fn((input: string | URL | Request) =>
      Promise.resolve(
        String(input).includes('/blog?')
          ? jsonResponse({
              content: [
                { slug: 'desconto-50%', status: 'PUBLISHED' },
                { slug: 'post-normal', status: 'PUBLISHED' },
              ],
              page: 0,
              size: 50,
              total: 2,
            })
          : jsonResponse({ bodyHtml: '<p>ok</p>' }),
      ),
    ) as unknown as typeof fetch;

    await expect(blogPrerenderParams()).resolves.toEqual([{ slug: 'post-normal' }]);
  });

  /**
   * A page that CARRIED entries but yielded no usable slug (all drafts, say) is not the
   * end of the list. Ending the walk there drops every page after it — silently, and
   * worst on the biggest catalogues, where the loss is largest.
   */
  it('keeps walking when a whole page is filtered out, instead of dropping every later page', async () => {
    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/blog?')) {
        if (url.includes('page=0')) {
          return Promise.resolve(
            jsonResponse({
              content: [
                { slug: 'rascunho-a', status: 'DRAFT' },
                { slug: 'rascunho-b', status: 'DRAFT' },
              ],
              page: 0,
              size: 50,
              total: 4,
            }),
          );
        }
        if (url.includes('page=1')) {
          return Promise.resolve(
            jsonResponse({
              content: [
                { slug: 'post-real', status: 'PUBLISHED' },
                { slug: 'outro-real', status: 'PUBLISHED' },
              ],
              page: 1,
              size: 50,
              total: 4,
            }),
          );
        }
        return Promise.resolve(jsonResponse({ content: [], page: 2, size: 50, total: 4 }));
      }
      return Promise.resolve(jsonResponse({ bodyHtml: '<p>ok</p>' }));
    }) as unknown as typeof fetch;

    await expect(blogPrerenderParams()).resolves.toEqual([
      { slug: 'post-real' },
      { slug: 'outro-real' },
    ]);
  });

  /**
   * `BlogPostRequest.slug` is a bare `string` with no shape contract, so these ARE live,
   * linkable pages. A house-style pattern here does not make them invalid — it drops them
   * from the prerender AND the sitemap, which is the opposite of this module's job.
   */
  it('prerenders slugs the backend permits: uppercase, underscores, repeated hyphens', async () => {
    globalThis.fetch = vi.fn((input: string | URL | Request) =>
      Promise.resolve(
        String(input).includes('/blog?')
          ? jsonResponse({
              content: [
                { slug: 'LGPD_2026', status: 'PUBLISHED' },
                { slug: 'guia--2026-', status: 'PUBLISHED' },
              ],
              page: 0,
              size: 50,
              total: 2,
            })
          : jsonResponse({ bodyHtml: '<p>ok</p>' }),
      ),
    ) as unknown as typeof fetch;

    await expect(blogPrerenderParams()).resolves.toEqual([
      { slug: 'LGPD_2026' },
      { slug: 'guia--2026-' },
    ]);
  });
});

/**
 * This value reaches `HttpRequest.timeout` through `PRERENDER_API`
 * (`app.config.server.ts`), and Angular throws `RuntimeError 2822` on a fractional
 * timeout — for EVERY request. A typo in the build env would therefore not slow the
 * prerender, it would turn every blog page into a frozen error page without a word.
 */
describe('blogPrerenderTimeoutMs', () => {
  afterEach(() => {
    delete process.env['PRERENDER_API_TIMEOUT_MS'];
  });

  it('ignores a fractional override, which would make every prerender request throw', () => {
    process.env['PRERENDER_API_TIMEOUT_MS'] = '2500.5';

    expect(blogPrerenderTimeoutMs()).toBe(25_000);
  });

  it('honours an integer override', () => {
    process.env['PRERENDER_API_TIMEOUT_MS'] = '2500';

    expect(blogPrerenderTimeoutMs()).toBe(2500);
  });
});

/**
 * The render phase runs AFTER `blogPrerenderParams` returns, so the wall-clock budget does
 * not cover it: this ceiling times `MAX_PRERENDERED` is its only bound. It is a `Math.min`
 * and not a default precisely so that no build environment can widen that product.
 */
describe('blogRenderTimeoutMs', () => {
  afterEach(() => {
    delete process.env['PRERENDER_API_TIMEOUT_MS'];
  });

  it('defaults well below the params-phase timeout, since the API is warm by then', () => {
    expect(blogRenderTimeoutMs()).toBe(10_000);
    expect(blogRenderTimeoutMs()).toBeLessThan(blogPrerenderTimeoutMs());
  });

  it('caps a raised override instead of honouring it, keeping the render phase bounded', () => {
    process.env['PRERENDER_API_TIMEOUT_MS'] = '60000';

    expect(blogPrerenderTimeoutMs()).toBe(60_000);
    expect(blogRenderTimeoutMs()).toBe(10_000);
  });

  it('still follows an override downwards, the direction that is always safe', () => {
    process.env['PRERENDER_API_TIMEOUT_MS'] = '2500';

    expect(blogRenderTimeoutMs()).toBe(2500);
  });
});

/**
 * Vercel stores an EMPTIED environment variable as an empty string rather than unsetting
 * it. `Number('')` is `0`, an integer that satisfies `>= 0`, so a blank override used to
 * pass as a zero budget: `expired()` true on the first check, nothing prerendered, no blog
 * entries in the sitemap, build green and silent. The sibling timeout guard is immune only
 * because it insists on `> 0`; these pin the two guards to the same behaviour.
 */
describe('blogPrerenderBudgetMs', () => {
  afterEach(() => {
    delete process.env['PRERENDER_BUDGET_MS'];
  });

  it('falls back to the default when the variable is blank, as an emptied Vercel var is', () => {
    process.env['PRERENDER_BUDGET_MS'] = '';

    expect(blogPrerenderBudgetMs()).toBe(300_000);
  });

  it('falls back to the default on whitespace, which Number() also reads as zero', () => {
    process.env['PRERENDER_BUDGET_MS'] = '   ';

    expect(blogPrerenderBudgetMs()).toBe(300_000);
  });

  it('still honours a deliberate zero, which means "prerender nothing"', () => {
    process.env['PRERENDER_BUDGET_MS'] = '0';

    expect(blogPrerenderBudgetMs()).toBe(0);
  });

  it('honours an integer override and rejects garbage', () => {
    process.env['PRERENDER_BUDGET_MS'] = '60000';
    expect(blogPrerenderBudgetMs()).toBe(60_000);

    process.env['PRERENDER_BUDGET_MS'] = 'cinco minutos';
    expect(blogPrerenderBudgetMs()).toBe(300_000);
  });
});
