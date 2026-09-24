import { bootstrapApplication } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';
import { telemetryEnabled } from './app/services/telemetry-enabled';
import { initVercelAnalytics } from './app/utils/vercel-analytics';

// Vercel Web Analytics: cookieless, só em produção, sem hook no Router (o script
// da Vercel detecta pushState sozinho). Ver contrato em utils/vercel-analytics.ts.
initVercelAnalytics(environment.production);

/*
 * FIX-0564 — `@sentry/angular` was a STATIC import here, so 241.84 kB was
 * downloaded and parsed on every visit even though the SDK only does anything
 * when a real DSN is configured, and `environment.sentryDsn` is empty in both
 * environment files. The import is dynamic now: no DSN, no request.
 *
 * The load STARTS here rather than after bootstrap so `Sentry.init()` still
 * happens as early as it can, but nothing is awaited before
 * `bootstrapApplication` — making first paint wait on a telemetry fetch would
 * trade one regression for a worse one.
 */
const sentryReady = telemetryEnabled()
  ? import('@sentry/angular').then((Sentry) => {
      Sentry.init({
        dsn: environment.sentryDsn,
        environment: 'production',
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
        ],
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.0,
        replaysOnErrorSampleRate: 1.0,
      });
      return Sentry;
    })
  : null;

bootstrapApplication(App, appConfig)
  .then(async (appRef) => {
    if (!sentryReady) return;
    /*
     * Router tracing. `TraceService` used to be an `app.config.ts` provider,
     * which is what dragged the namespace into the static graph. Constructing it
     * here keeps the same instrumentation — it subscribes to router events in
     * its constructor — without a static import, and it now happens strictly
     * after `Sentry.init()`, which is the only state in which it did anything.
     */
    const Sentry = await sentryReady;
    const tracing = new Sentry.TraceService(appRef.injector.get(Router));
    appRef.onDestroy(() => tracing.ngOnDestroy());
  })
  .catch((err) => {
    // keep: bootstrap failure must surface — no logger available before app is up
    console.error(err);
  });
