import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { InviteOnboardingTokenStore } from '../../services/invite-onboarding-token.store';

/**
 * "Has an onboarding token." Nothing else: this route is NOT behind `authGuard`, because the
 * invitee has no session (the onboarding token is not one). Without the token there is
 * nothing to onboard, and the invite link is the only way to get one.
 */
export const inviteOnboardingGuard: CanActivateFn = () => {
  if (inject(InviteOnboardingTokenStore).has()) return true;
  return inject(Router).createUrlTree(['/login']);
};
