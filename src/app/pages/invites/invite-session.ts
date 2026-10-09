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

/**
 * `history.state` key `OauthSuccess` sets when the Google login that just ended belonged to
 * the invite page, so `/convite` finishes with `accept-as-member` instead of asking again.
 * Lives here (not in the lazy page) so the eager `OauthSuccess` does not pull the page in.
 */
export const INVITE_RESUME_STATE_KEY = 'inviteResume';
