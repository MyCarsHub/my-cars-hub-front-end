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
 * redirects every route outside the allowlist to `/billing?reason=<reason>` - for the OWNER,
 * the only role that can open that page. Everyone else stays where they are and sees the
 * shell's paywall dialog instead.
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
    /*
     * `/billing` is `roleGuard(['OWNER'])`. Sending anyone else there is the laco
     * /dashboard -> /billing -> (roleGuard back to their home) -> /billing ...: no guard ever
     * says "stop", no screen opens, and the redirect storm never yields to the browser, which
     * froze the tab of an invitee who had JUST been added to a company with a lapsed
     * subscription (a MANAGER or DRIVER is by definition not the owner).
     *
     * The paywall is still shown: the shell opens the hard-block dialog whenever
     * `access.isBlocked()`, and the backend refuses the writes. What a non-owner cannot do is
     * open the billing page, so they are simply not sent to it. The role comes from the TOKEN,
     * the same source `roleGuard` uses, so both guards always agree on who may enter /billing.
     */
    if (session.getCompanyRoleFromToken() !== 'OWNER') return true;
    const reason = access.reason() ?? 'BLOCKED';
    return router.createUrlTree(['/billing'], { queryParams: { reason } });
  };

  if (access.loaded()) {
    return decide();
  }

  return access.load().pipe(map(() => decide()));
};
