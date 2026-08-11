import { PrerenderFallback, RenderMode, ServerRoute } from '@angular/ssr';

import { blogPrerenderParams } from './prerender-blog';

/**
 * What the build is allowed to render on the server.
 *
 * ONLY the public marketing/legal/editorial pages are prerendered (SSG, at build time).
 * Everything else — the whole authenticated tree, `/login`, `/oauth-success`,
 * `/invite/accept` — is `RenderMode.Client`.
 *
 * That split is a security boundary, not a performance choice: there is no session on
 * the server, so rendering an authenticated route there would either crash or, worse,
 * bake one visitor's state into a document that gets served to another. The catch-all
 * below is `Client` so a NEW route is CSR by default and has to opt in explicitly here.
 *
 * `/blog` and `/blog/:slug` ARE prerendered, and that does not weaken the reasoning
 * above: `GET /v1/blog` is public and session-free (see `pages/blog/blog.service.ts`), so
 * there is no visitor state that could leak into the document. What prerendering them
 * costs is freshness, and that cost is accepted deliberately:
 *
 *  - Content is frozen per deploy. A post published after a build stays out of the
 *    prerendered set and out of the sitemap until the next deploy. There is no
 *    invalidation mechanism and none is wanted.
 *  - A slug that was not prerendered (published since the build, or unreachable at build
 *    time) still works: `PrerenderFallback.Client` serves the CSR shell and the page
 *    fetches itself exactly as it does today.
 *  - `getPrerenderParams` NEVER throws and returns `[]` on any API problem, so a cold
 *    Render instance or an unreachable backend degrades the build to today's behaviour
 *    instead of failing it. See `prerender-blog.ts`.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'blog', renderMode: RenderMode.Prerender },
  {
    path: 'blog/:slug',
    renderMode: RenderMode.Prerender,
    // `Server` is the default and would be a lie here: `outputMode: static` ships no
    // server, so an unknown slug must fall back to the client shell or 404.
    fallback: PrerenderFallback.Client,
    getPrerenderParams: blogPrerenderParams,
  },
  { path: 'politica-de-privacidade', renderMode: RenderMode.Prerender },
  { path: 'termos-de-uso', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
