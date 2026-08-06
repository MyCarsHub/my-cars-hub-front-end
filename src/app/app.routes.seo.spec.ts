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

    expect(prerendered).toEqual(['', 'politica-de-privacidade', 'termos-de-uso']);

    const catchAll = serverRoutes.at(-1);
    expect(catchAll?.path).toBe('**');
    expect(catchAll?.renderMode).toBe(1 /* RenderMode.Client */);
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
