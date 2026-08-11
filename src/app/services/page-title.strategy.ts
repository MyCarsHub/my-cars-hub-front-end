import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import {
  ActivatedRouteSnapshot,
  PRIMARY_OUTLET,
  RouterStateSnapshot,
  TitleStrategy,
} from '@angular/router';

import { RouteSeo, SeoService, brandedTitle } from './seo.service';

/**
 * Routes in this app carry their label in `data.pageTitle` (also used by `ConstructorPage`),
 * not in the router's own `title` property, so the default strategy never fired.
 *
 * Resolution order: `Route.title` → deepest primary `data.pageTitle` → brand only.
 * The brand suffix is always appended (via `brandedTitle`), so route labels stay bare.
 *
 * This runs on NAVIGATION, so it only ever knows the static route label. A page whose
 * real headline arrives with its data — `/blog/:slug` — overwrites it afterwards through
 * `SeoService.setTitle`, which reuses the same `brandedTitle` helper.
 *
 * Also the single place that drives `SeoService`: title, description, canonical, Open
 * Graph and robots all change together on navigation, so they are written together.
 * Public routes declare `data.seo`; anything without it is treated as private surface
 * and gets `noindex, nofollow`.
 */
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly seo = inject(SeoService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const pageTitle = this.buildTitle(snapshot) ?? deepestPageTitle(snapshot.root);
    const fullTitle = brandedTitle(pageTitle);
    this.title.setTitle(fullTitle);
    this.seo.applyRouteSeo({
      title: fullTitle,
      urlPath: snapshot.url,
      seo: deepestSeo(snapshot.root),
    });
  }
}

/** Walks the primary-outlet chain and keeps the deepest non-empty `data.pageTitle`. */
function deepestPageTitle(root: ActivatedRouteSnapshot): string | undefined {
  let found: string | undefined;
  let current: ActivatedRouteSnapshot | undefined = root;

  while (current) {
    const candidate: unknown = current.data['pageTitle'];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      found = candidate.trim();
    }
    current = current.children.find((child) => child.outlet === PRIMARY_OUTLET);
  }

  return found;
}

/** Same walk for `data.seo` — the deepest declaration wins, parents act as defaults. */
function deepestSeo(root: ActivatedRouteSnapshot): RouteSeo | undefined {
  let found: RouteSeo | undefined;
  let current: ActivatedRouteSnapshot | undefined = root;

  while (current) {
    const candidate: unknown = current.data['seo'];
    if (isRouteSeo(candidate)) {
      found = candidate;
    }
    current = current.children.find((child) => child.outlet === PRIMARY_OUTLET);
  }

  return found;
}

function isRouteSeo(value: unknown): value is RouteSeo {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { description?: unknown }).description === 'string'
  );
}
