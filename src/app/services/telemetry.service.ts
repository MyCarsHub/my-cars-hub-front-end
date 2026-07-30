import { Injectable } from '@angular/core';
import * as Sentry from '@sentry/angular';

/** Structured key/value payload forwarded to the telemetry backend as `extra`. */
export type TelemetryExtra = Record<string, unknown>;

/**
 * The app's single seam onto the Sentry SDK for *capture* calls.
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
}
