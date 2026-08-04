import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import {
  ActivatedRouteSnapshot,
  PRIMARY_OUTLET,
  RouterStateSnapshot,
  TitleStrategy,
} from '@angular/router';

const BRAND = 'MyCarsHub';

/**
 * Routes in this app carry their label in `data.pageTitle` (also used by `ConstructorPage`),
 * not in the router's own `title` property, so the default strategy never fired.
 *
 * Resolution order: `Route.title` → deepest primary `data.pageTitle` → brand only.
 * The brand suffix is always appended here, so route labels stay bare.
 */
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const pageTitle = this.buildTitle(snapshot) ?? deepestPageTitle(snapshot.root);
    this.title.setTitle(pageTitle ? `${pageTitle} — ${BRAND}` : BRAND);
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
