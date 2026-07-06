import { bootstrapApplication } from '@angular/platform-browser';
import * as Sentry from '@sentry/angular';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

if (environment.production && environment.sentryDsn && environment.sentryDsn.startsWith('https://')) {
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
}

bootstrapApplication(App, appConfig).catch((err) => {
  // keep: bootstrap failure must surface — no logger available before app is up
  console.error(err);
});
