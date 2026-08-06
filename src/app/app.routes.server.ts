import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * What the build is allowed to render on the server.
 *
 * ONLY the public marketing/legal pages are prerendered (SSG, at build time). Everything
 * else — the whole authenticated tree, `/login`, `/oauth-success`, `/invite/accept`,
 * `/blog` — is `RenderMode.Client`.
 *
 * That split is a security boundary, not a performance choice: there is no session on
 * the server, so rendering an authenticated route there would either crash or, worse,
 * bake one visitor's state into a document that gets served to another. The catch-all
 * below is `Client` so a NEW route is CSR by default and has to opt in explicitly here.
 *
 * `/blog` and `/blog/:slug` stay client-rendered even though `GET /v1/blog` is PUBLIC
 * (see `pages/blog/blog.service.ts`). The reason is the build boundary, not auth: the
 * post list is editorial content that changes without a deploy, and prerendering it would
 * freeze whatever existed at build time — plus `/blog/:slug` would need
 * `getPrerenderParams` hitting the API during the build, coupling every frontend build to
 * a live backend. Making them SSG is a real option once the blog is worth a redeploy per
 * post; it is a deliberate trade, not an impossibility.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'politica-de-privacidade', renderMode: RenderMode.Prerender },
  { path: 'termos-de-uso', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
