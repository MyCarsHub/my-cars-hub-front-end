import { Route } from '@angular/router';
import { describe, it, expect } from 'vitest';

import { routes } from './app.routes';
import { serverRoutes } from './app.routes.server';
import { RouteSeo } from './services/seo.service';

/**
 * Guards the indexability boundary.
 *
 * `data.seo` is what makes `PageTitleStrategy` emit `index, follow` + a canonical. The
 * authenticated tree lives under a route that carries `AppShell` + `authGuard`; if `seo`
 * ever leaks into it, private pages become indexable. These tests fail loudly if that
 * boundary moves, which a code review of a 900-line route file would not catch.
 */

/** Every top-level route path that declares `data.seo`, in declaration order. */
function publicPaths(): string[] {
  return routes.filter((route) => hasSeo(route)).map((route) => `/${route.path ?? ''}`);
}

function hasSeo(route: Route): boolean {
  const seo: unknown = route.data?.['seo'];
  return typeof seo === 'object' && seo !== null && typeof (seo as RouteSeo).description === 'string';
}

/** Depth-first walk over the whole tree, yielding every route that declares `seo`. */
function allSeoRoutes(list: readonly Route[], prefix = ''): string[] {
  const found: string[] = [];
  for (const route of list) {
    const path = [prefix, route.path ?? ''].filter(Boolean).join('/');
    if (hasSeo(route)) {
      found.push(`/${path}`);
    }
    if (route.children) {
      found.push(...allSeoRoutes(route.children, path));
    }
  }
  return found;
}

describe('public/private SEO boundary in app.routes', () => {
  it('marks exactly the intended public routes as indexable', () => {
    expect(publicPaths().sort()).toEqual(
      ['/', '/blog', '/blog/:slug', '/politica-de-privacidade', '/termos-de-uso'].sort(),
    );
  });

  it('never marks a route inside the authenticated AppShell tree as indexable', () => {
    const shell = routes.find((route) => route.component !== undefined && route.canActivate);
    expect(shell).toBeDefined();

    expect(allSeoRoutes(shell?.children ?? [])).toEqual([]);
  });

  it('leaves the token-bearing and auth routes without seo, so they fail closed to noindex', () => {
    for (const path of ['login', 'oauth-success', 'invite/accept']) {
      const route = routes.find((r) => r.path === path);
      expect(route, `route ${path} disappeared`).toBeDefined();
      expect(hasSeo(route as Route)).toBe(false);
    }
  });

  it('prerenders only public routes and keeps the catch-all client-rendered', () => {
    const prerendered = serverRoutes
      .filter((route) => route.renderMode === 2 /* RenderMode.Prerender */)
      .map((route) => route.path);

    expect(prerendered).toEqual([
      '',
      'blog',
      'blog/:slug',
      'politica-de-privacidade',
      'termos-de-uso',
    ]);

    const catchAll = serverRoutes.at(-1);
    expect(catchAll?.path).toBe('**');
    expect(catchAll?.renderMode).toBe(1 /* RenderMode.Client */);
  });

  /**
   * `PrerenderFallback.Server` is the @angular/ssr DEFAULT and would be a lie: the build
   * uses `outputMode: static`, so no server exists to render the miss. A post published
   * after the last deploy — or one the API could not serve at build time — must reach the
   * client shell, which is what `/blog/:slug` already does today.
   */
  it('falls back to client rendering for a blog slug that was not prerendered', () => {
    const slugRoute = serverRoutes.find((route) => route.path === 'blog/:slug');

    expect(slugRoute?.renderMode).toBe(2 /* RenderMode.Prerender */);
    expect((slugRoute as { fallback?: number }).fallback).toBe(1 /* PrerenderFallback.Client */);
    expect(typeof (slugRoute as { getPrerenderParams?: unknown }).getPrerenderParams).toBe(
      'function',
    );
  });

  /**
   * `redirectTo: 'login'` here used to soft-404 every unknown URL onto a robots-Disallowed
   * path: HTTP 200, wrong content, and a destination Google is explicitly told not to
   * crawl. The catch-all must render a real not-found page instead.
   */
  it('renders a not-found page on the catch-all instead of redirecting', () => {
    const catchAll = routes.find((route) => route.path === '**');

    expect(catchAll).toBeDefined();
    expect(catchAll?.redirectTo).toBeUndefined();
    expect(typeof catchAll?.loadComponent).toBe('function');
  });

  /**
   * No `data.seo` is what makes `SeoService` fail closed to `noindex, nofollow` with no
   * canonical — the only de-indexing signal a static build can emit for a URL that does
   * not exist, since it cannot change the HTTP status.
   */
  it('leaves the catch-all without seo, so an invalid URL fails closed to noindex', () => {
    const catchAll = routes.find((route) => route.path === '**');

    expect(hasSeo(catchAll as Route)).toBe(false);
  });

  /** The not-found page must be reachable logged out, so it cannot live inside the shell. */
  it('keeps the catch-all outside the authenticated AppShell tree', () => {
    expect(routes.at(-1)?.path).toBe('**');
    expect(routes.at(-1)?.canActivate).toBeUndefined();
  });

  it('prerenders nothing that is not also marked public in app.routes', () => {
    const publicSet = new Set(publicPaths());
    for (const route of serverRoutes) {
      if (route.renderMode !== 2 || route.path === '**') {
        continue;
      }
      expect(publicSet.has(`/${route.path}`)).toBe(true);
    }
  });
});
