import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { SessionService } from './session.service';

/**
 * Marks a request so the Angular service worker passes it straight to the
 * network instead of re-dispatching it through `fetch()` inside the worker.
 *
 * WHY THIS EXISTS: `ngsw-config.json` declares only `assetGroups` — there are
 * ZERO `dataGroups`, so the worker never caches an API response; it merely
 * re-issues the request. On iOS/WebKit that re-dispatch drops the body of a
 * `multipart/form-data` request (WebKit bug 187461), so the backend receives
 * multipart headers with no parts and answers "Required part 'file' is not
 * present". Bypassing every API call costs nothing (nothing was cached) and
 * kills the whole bug class — contract PDF, vistoria photos, inspection PDF,
 * contract template, and anything added later.
 *
 * WHY A QUERY PARAM AND NOT THE `ngsw-bypass` HEADER: `ngsw-worker.js` honours
 * both, but the backend CORS whitelist (my-cars-hub-back-end
 * `SecurityConfig.java:86`) allows only `Authorization`, `Content-Type` and
 * `X-Requested-With`. Sending it as a header would fail preflight and break
 * EVERY API call. The param has zero backend coupling — do not "clean it up"
 * into a header.
 */
const NGSW_BYPASS_PARAM = 'ngsw-bypass';

/**
 * Anchored match on `environment.apiUrl` — NEVER a substring test. In prod the
 * base is the relative `/api/v1`, so `includes()` would treat any third-party
 * absolute URL that merely CONTAINS that fragment (e.g.
 * `https://evil.example.com/api/v1/steal`) as our own API and leak the bearer
 * token to it. The base is matched from position 0 and must be followed by a
 * path/query boundary so `/api/v1x` can't slip through either.
 */
function isApiRequest(url: string): boolean {
  const base = environment.apiUrl;
  if (!url.startsWith(base)) return false;
  const rest = url.slice(base.length);
  return rest === '' || rest.startsWith('/') || rest.startsWith('?');
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const sessionService = inject(SessionService);
  const authToken = sessionService.getToken();

  // Requests to third parties (e.g. Supabase signed URLs) are forwarded untouched.
  if (!isApiRequest(req.url)) {
    return next(req);
  }

  // `set` on the existing HttpParams keeps any params the caller already added.
  const apiReq = req.clone({ params: req.params.set(NGSW_BYPASS_PARAM, '1') });

  // The token is still conditional — unauthenticated calls (login, signup) have none.
  if (!authToken) {
    return next(apiReq);
  }

  return next(
    apiReq.clone({
      setHeaders: {
        Authorization: `Bearer ${authToken}`,
      },
    }),
  );
};
