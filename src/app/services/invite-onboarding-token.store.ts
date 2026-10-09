import { Injectable, inject } from '@angular/core';
import { SessionService } from './session.service';

/**
 * sessionStorage key of the invite ONBOARDING token.
 *
 * Deliberately NOT `token`: that key is the normal auth slot every guard, the shell and the
 * `authInterceptor` read. The onboarding token is a narrow credential (it answers 401
 * `ONBOARDING_TOKEN_SCOPE` everywhere but `/v1/invite-onboarding/**`), and parking it in the
 * normal slot would both log the invitee "in" for guards and overwrite a session the same tab
 * may already hold. Keep the two apart.
 */
export const INVITE_ONBOARDING_TOKEN_KEY = 'inviteOnboardingToken';

/** Holds the onboarding token in its own slot. Only `authInterceptor` ever sends it. */
@Injectable({ providedIn: 'root' })
export class InviteOnboardingTokenStore {
  private readonly session = inject(SessionService);

  get(): string | null {
    const value = this.session.getItem(INVITE_ONBOARDING_TOKEN_KEY);
    return value && value.length > 0 ? value : null;
  }

  has(): boolean {
    return this.get() !== null;
  }

  set(token: string): void {
    this.session.setItem(INVITE_ONBOARDING_TOKEN_KEY, token);
  }

  clear(): void {
    this.session.removeItem(INVITE_ONBOARDING_TOKEN_KEY);
  }
}
