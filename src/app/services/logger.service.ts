import { Injectable } from '@angular/core';
import * as Sentry from '@sentry/angular';

/**
 * Structured key/value payload attached to a log entry. Kept as
 * `Record<string, unknown>` so callers never have to reach for `any` and so
 * the whole object can be forwarded to Sentry as `extra` verbatim.
 */
export type LogContext = Record<string, unknown>;

/**
 * Single, centralized logging surface for the app.
 *
 * Why it exists: the project's `no-console` lint rule only allows
 * `console.error`, so before this service every event worth recording — a
 * hard failure and a partial degradation alike — had to be written as an
 * "error". Once the Sentry DSN is configured both would land in the same
 * bucket and compete for the same attention. `warn` vs `error` here maps
 * directly onto Sentry's `warning` vs `error` severities, so triage works.
 *
 * This file is the ONLY place in `src/` allowed to call `console.*` — see the
 * scoped override in `eslint.config.mjs`. Everything else goes through here.
 *
 * Sentry state: `main.ts` only calls `Sentry.init()` when a production DSN is
 * present, and `environment.sentryDsn` is empty in both environment files
 * today. With no client bound, the Sentry SDK's capture functions are
 * documented no-ops — but every call is still wrapped defensively (same
 * pattern as `session.service.ts`) so a telemetry problem can never take down
 * the feature that was merely trying to log.
 */
@Injectable({ providedIn: 'root' })
export class LoggerService {
  /**
   * Partial degradation: the user still has a usable outcome, but something
   * was skipped, retried or fell back. Reaches Sentry as `level: 'warning'`.
   *
   * Console output uses `console.error` (the only method the lint rule
   * permits) prefixed with `[warn]` so devtools filtering and log scraping can
   * still tell the two severities apart.
   */
  warn(message: string, context?: LogContext): void {
    console.error(`[warn] ${message}`, context ?? {});
    try {
      Sentry.captureMessage(message, { level: 'warning', extra: context });
    } catch {
      // Sentry may not be initialized (no DSN outside prod); never let a
      // telemetry failure escape into the caller's control flow.
    }
  }

  /**
   * Hard failure: the operation did not produce its expected outcome.
   * Reaches Sentry as an exception (`level: 'error'`).
   *
   * `error` is typed `unknown` because catch bindings are `unknown` under
   * strict TS; non-`Error` throwables are normalized before capture so Sentry
   * always gets a stack-bearing object.
   */
  error(message: string, error: unknown, context?: LogContext): void {
    console.error(`[error] ${message}`, error, context ?? {});
    try {
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        extra: { message, ...context },
      });
    } catch {
      // See `warn`.
    }
  }
}
