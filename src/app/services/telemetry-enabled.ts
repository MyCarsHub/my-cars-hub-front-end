import { environment } from '../../environments/environment';

/**
 * The ONE condition that decides whether the Sentry SDK is fetched at all.
 *
 * It lives in its own module because two very different places have to agree on
 * it — `main.ts`, which initialises the SDK, and `TelemetryService`, which sends
 * events through it. When the two drifted apart the failure was silent in both
 * directions: events queued against an SDK that was never initialised, or a
 * 241.84 kB download for a client that reports nothing.
 *
 * `environment.sentryDsn` is EMPTY in both environment files today, so this
 * returns `false` everywhere and `@sentry/*` is never downloaded. Whether the
 * product should report for real is an open question for the owner; this
 * predicate only decides WHEN the weight is paid.
 */
export const telemetryEnabled = (): boolean =>
  environment.production &&
  !!environment.sentryDsn &&
  environment.sentryDsn.startsWith('https://');
