import { ErrorHandler, Injectable, inject } from '@angular/core';
import { LoggerService } from './logger.service';

/**
 * Global `ErrorHandler`, replacing `Sentry.createErrorHandler()`.
 *
 * The Sentry factory had to be CALLED while the provider array was being built,
 * which forced `@sentry/angular` into the static import graph of
 * `app.config.ts` — and with it 241.84 kB into every first paint, for an SDK
 * that reports nothing while `environment.sentryDsn` is empty.
 *
 * It delegates to `LoggerService`, which is the project's single sanctioned
 * console surface and already does both halves of what the Sentry handler did:
 * it logs the failure and forwards it to telemetry, normalising non-`Error`
 * throwables on the way. Going through it also means this class needs no
 * `no-console` exemption — that rule is a P0 block here, and a fourth exception
 * to it should be a decision, not a side effect of moving an import.
 *
 * Capture must never mask the original error, so `LoggerService` swallows its
 * own telemetry failures; the console line is the guarantee.
 */
@Injectable()
export class TelemetryErrorHandler implements ErrorHandler {
  private readonly logger = inject(LoggerService);

  handleError(error: unknown): void {
    this.logger.error('Uncaught error reached the global ErrorHandler', error);
  }
}
