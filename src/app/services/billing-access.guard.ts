import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { BillingAccessService } from './billing-access.service';
import { SessionService } from './session.service';

// Routes that must remain accessible even when the tenant is blocked.
// Anything under these prefixes is passed through.
const ALLOWLIST_PREFIXES = ['billing', 'logout', 'perfil', 'admin'];

const isAllowlisted = (url: string): boolean => {
  const path = url.split('?')[0].replace(/^\/+/, '');
  return ALLOWLIST_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
};

/**
 * Hard-paywall guard (brief Q5). When `access-status.blocked === true`,
 * redirects every route outside the allowlist to `/billing?reason=<reason>`.
 * PLATFORM_ADMIN is bypassed inside BillingAccessService.isBlocked().
 */
export const billingAccessGuard: CanActivateChildFn = (_route, state) => {
  const access = inject(BillingAccessService);
  const router = inject(Router);
  const session = inject(SessionService);

  // Onboarding-incomplete users hold a TEMPORALLY token; billing endpoints
  // would 403. The onboarding guard already forces them to /onboarding.
  if (!session.isOnboardingCompleted()) {
    return true;
  }

  const decide = () => {
    if (!access.isBlocked()) return true;
    if (isAllowlisted(state.url)) return true;
    const reason = access.reason() ?? 'BLOCKED';
    return router.createUrlTree(['/billing'], { queryParams: { reason } });
  };

  if (access.loaded()) {
    return decide();
  }

  return access.load().pipe(map(() => decide()));
};
