import { Injectable } from '@angular/core';
import { telemetryEnabled } from './telemetry-enabled';

/**
 * TYPE-ONLY view of the SDK. `typeof import(...)` is erased at compile time, so
 * this keeps full typing on the calls below WITHOUT putting `@sentry/angular`
 * into the static import graph — which is the whole point of this file.
 */
type SentrySdk = typeof import('@sentry/angular');

/** Structured key/value payload forwarded to the telemetry backend as `extra`. */
export type TelemetryExtra = Record<string, unknown>;

/** Identity attached to every subsequent event, or `null` to go anonymous. */
export interface TelemetryUser {
  id: string;
  email?: string;
}

/**
 * The app's single seam onto the Sentry SDK — every capture and every identity
 * call in `src/` goes through here.
 *
 * LOADING CONTRACT (FIX-0564): `@sentry/angular` is reached ONLY through the
 * dynamic `import()` below. It used to be a static import here, in `main.ts`
 * and in `app.config.ts`, which put 241.84 kB into the initial bundle on every
 * visit — while `environment.sentryDsn` is empty and the SDK reports nothing.
 * `scripts/assert-initial-bundle.mjs` now fails CI if any static importer comes
 * back. All three had to be converted together: converting only some of them
 * measured WORSE (993.00 kB -> 1092.51 kB), because the static copy stays and
 * the split point duplicates.
 *
 * Calls are ordered and non-blocking. Nothing here awaits: a capture must never
 * make the caller wait on a network fetch, and `setUser` before an exception
 * must still be applied first, so the work is chained on one promise queue. A
 * rejected chain is swallowed — telemetry must not surface as an app error.
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
  /** The in-flight (or settled) SDK load. Started at most once, on first use. */
  private sdk: Promise<SentrySdk> | null = null;

  /** Serialises calls so they reach the SDK in the order they were made. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Runs `use` against the SDK, loading it on first call. With telemetry
   * disabled — which is every environment today — this returns without ever
   * requesting the chunk, so the weight is not paid.
   */
  private send(use: (sentry: SentrySdk) => void): void {
    if (!telemetryEnabled()) return;
    this.sdk ??= import('@sentry/angular');
    const sdk = this.sdk;
    this.queue = this.queue.then(() => sdk).then(use).catch(() => undefined);
  }

  /** Records a non-fatal event. Mirrors `Sentry.captureMessage`. */
  captureMessage(message: string, options: { level: 'warning'; extra?: TelemetryExtra }): void {
    this.send((sentry) => sentry.captureMessage(message, options));
  }

  /** Records a failure with a stack. Mirrors `Sentry.captureException`. */
  captureException(error: Error, options: { extra: TelemetryExtra }): void {
    this.send((sentry) => sentry.captureException(error, options));
  }

  /**
   * Tags subsequent events with the signed-in user, or clears the tag when
   * given `null`. Identity, not logging — hence it lives here rather than on
   * `LoggerService`. Mirrors `Sentry.setUser`.
   */
  setUser(user: TelemetryUser | null): void {
    this.send((sentry) => sentry.setUser(user));
  }
}
