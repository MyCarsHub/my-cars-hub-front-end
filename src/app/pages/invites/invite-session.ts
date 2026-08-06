/**
 * sessionStorage key that carries the raw invite token across the Google OAuth round trip.
 *
 * The invitee lands on `/invite/accept?token=…` logged out. Logging in navigates the tab
 * away to Google and back to `/oauth-success`, which no longer has the token in its URL —
 * the OAuth `state` is owned by the backend and cannot carry it. sessionStorage survives a
 * same-tab cross-origin round trip, so the token is stashed before the redirect and read
 * back by `OauthSuccess`, which bounces to the accept screen instead of the dashboard.
 *
 * `SessionService.clear()` wipes it (it wipes everything). Every writer therefore re-stashes
 * AFTER clearing, and the accept screen re-stashes on every init from its own query param.
 */
export const PENDING_INVITE_TOKEN_KEY = 'pendingInviteToken';
