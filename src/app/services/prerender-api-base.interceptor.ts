import { HttpInterceptorFn } from '@angular/common/http';
import { InjectionToken, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { isApiRequest } from './auth.interceptor';

/** How a prerendered page is allowed to reach the API. */
export interface PrerenderApiConfig {
  /** Absolute API base replacing `environment.apiUrl` (which is relative in prod). */
  readonly base: string;
  /** Hard per-request ceiling, in ms. See the interceptor doc for why it is mandatory. */
  readonly timeoutMs: number;
}

/**
 * Provided ONLY by `app.config.server.ts`, so in the browser the injection is `null` and
 * the interceptor below is a pass-through.
 *
 * An optional token rather than a second `provideHttpClient()` on the server: merging two
 * `provideHttpClient` calls leaves interceptor ordering up to `mergeApplicationConfig`,
 * and a silently dropped interceptor here means every prerendered blog page freezes an
 * error state into static HTML. The token is unambiguous.
 */
export const PRERENDER_API = new InjectionToken<PrerenderApiConfig>('PRERENDER_API');

/**
 * Makes API calls resolvable — and, crucially, BOUNDED — during prerender.
 *
 * RESOLVABLE: in production `environment.apiUrl` is the relative `/api/v1`, which only
 * means anything behind the Vercel rewrite (`vercel.json`). During a build there is no
 * origin to resolve it against — `@angular/ssr` renders each route against
 * `http://localhost/…`, so the request would go to `http://localhost/api/v1/...` and die
 * on connection refused.
 *
 * BOUNDED: this is the part that keeps the build alive. Node's `fetch` has NO default
 * timeout, so an API host that accepts the connection and then never answers — a paused
 * Render instance, a black-holed IP, a hung proxy — would hang the prerender forever and
 * the build would die on the CI wall clock instead of failing fast. `timeout` is a
 * first-class `HttpRequest` option, so the abort surfaces as a normal `HttpErrorResponse`
 * that `BlogList`/`BlogDetail` already handle; `scripts/generate-sitemap.mjs` then prunes
 * whatever error page that produced. No hang, no broken deploy.
 *
 * Registered LAST in the chain on purpose, so `impersonationInterceptor`,
 * `authInterceptor` and `errorInterceptor` all still see the original relative URL —
 * `isApiRequest()` anchors on `environment.apiUrl` and would stop recognising our own API
 * if the rewrite happened first.
 */
export const prerenderApiBaseInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(PRERENDER_API, { optional: true });
  if (config === null || !isApiRequest(req.url)) {
    return next(req);
  }
  return next(
    req.clone({
      url: `${config.base}${req.url.slice(environment.apiUrl.length)}`,
      timeout: config.timeoutMs,
      // NO transfer cache for a rewritten request. The cache is keyed by URL, and the URL
      // the server used (`https://api.…/v1/blog/x`) is not the one the browser will use
      // (`/api/v1/blog/x`), so the entry could never be hit — it would only bloat every
      // prerendered post with a second, verbatim copy of its own `bodyHtml` and publish
      // the backend origin in the page source. The client refetches either way.
      transferCache: false,
    }),
  );
};
