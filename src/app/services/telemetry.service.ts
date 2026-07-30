import { Injectable } from '@angular/core';
import * as Sentry from '@sentry/angular';

/** Structured key/value payload forwarded to the telemetry backend as `extra`. */
export type TelemetryExtra = Record<string, unknown>;

/** Identity attached to every subsequent event, or `null` to go anonymous. */
export interface TelemetryUser {
  id: string;
  email?: string;
}

/**
 * The app's single seam onto the Sentry SDK — every capture and every identity
 * call in `src/` goes through here. Outside this file, `@sentry/angular` is
 * imported only by `main.ts` (init) and `app.config.ts` (global `ErrorHandler`
 * + `TraceService`), both of which are bootstrap wiring rather than app code.
 *
 * Why this exists as a class instead of `LoggerService` importing Sentry
 * directly: `@sentry/angular` is an ESM namespace, so its bindings are neither
 * writable nor configurable — `vi.spyOn` refuses them, and `vi.mock()` is not
 * dependable under the Angular `@angular/build:unit-test` builder, which
 * pre-bundles specs with esbuild. In that pipeline the spec's own
 * `@sentry/angular` specifier and the copy linked into the service's chunk can
 * resolve to two different module instances, so the mock lands on one and the
 * production code keeps calling the other. Whether that split happens depends
 * on chunking and build cache, which is why it reproduced in CI but not on a
 * warm local cache.
 *
 * Routing capture through a DI token removes the question entirely: specs
 * override this provider and never touch the module graph.
 *
 * Deliberately not covered by a spec of its own — it is a pass-through, and any
 * test of it would have to mock the ESM module again, reintroducing exactly the
 * fragility this class was added to remove.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  /** Records a non-fatal event. Mirrors `Sentry.captureMessage`. */
  captureMessage(message: string, options: { level: 'warning'; extra?: TelemetryExtra }): void {
    Sentry.captureMessage(message, options);
  }

  /** Records a failure with a stack. Mirrors `Sentry.captureException`. */
  captureException(error: Error, options: { extra: TelemetryExtra }): void {
    Sentry.captureException(error, options);
  }

  /**
   * Tags subsequent events with the signed-in user, or clears the tag when
   * given `null`. Identity, not logging — hence it lives here rather than on
   * `LoggerService`. Mirrors `Sentry.setUser`.
   */
  setUser(user: TelemetryUser | null): void {
    Sentry.setUser(user);
  }
}
