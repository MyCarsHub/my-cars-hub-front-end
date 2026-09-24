import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideBrowserGlobalErrorListeners,
  provideEnvironmentInitializer,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  TitleStrategy,
} from '@angular/router';
import { provideClientHydration } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { authInterceptor } from './services/auth.interceptor';
import { errorInterceptor } from './services/error.interceptor';
import { impersonationInterceptor } from './services/impersonation.interceptor';
import { PageTitleStrategy } from './services/page-title.strategy';
import { prerenderApiBaseInterceptor } from './services/prerender-api-base.interceptor';
import { ImpersonationService } from './services/impersonation.service';
import { TenantCachesService } from './services/tenant-caches.service';
import { TelemetryErrorHandler } from './services/telemetry-error-handler';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    // Reuses the prerendered DOM of the public pages instead of throwing it away.
    // Deliberately WITHOUT `withEventReplay()`: that feature injects an executable inline
    // <script>, which the production CSP (`script-src 'self'`, see vercel.json) blocks.
    // Routes that were not prerendered are served the CSR shell and render normally.
    provideClientHydration(),
    // `impersonationInterceptor` vem PRIMEIRO de propósito: sendo o mais externo,
    // a recusa de escrita durante uma sessão somente-leitura nem chega a montar
    // a requisição — e o erro sintético que ele devolve não passa pelo
    // `errorInterceptor`, que senão duplicaria o aviso.
    // `prerenderApiBaseInterceptor` vem POR ÚLTIMO de propósito: ele reescreve a URL
    // relativa da API para uma base absoluta durante o prerender, e os três acima
    // precisam ver a URL original — `isApiRequest` ancora em `environment.apiUrl`. No
    // browser o token não está provido e ele é um pass-through.
    provideHttpClient(
      withFetch(),
      withInterceptors([
        impersonationInterceptor,
        authInterceptor,
        errorInterceptor,
        prerenderApiBaseInterceptor,
      ]),
    ),
    provideAnimations(),
    // Instancia no boot os dois donos de estado que se registram no
    // `SessionResetRegistry`. Sem isto o registro dependeria de o serviço já ter
    // sido injetado por outra via antes do `SessionService.clear()` — que é
    // exatamente o tipo de "depende de alguém lembrar" que deixou cinco dos seis
    // caminhos de queda de sessão sem limpar a impersonação e os caches.
    // `ImpersonationService` também precisa hidratar cedo: é ele que restaura o
    // token administrativo quando a aba recarrega com a sessão já vencida.
    provideEnvironmentInitializer(() => {
      inject(ImpersonationService);
      inject(TenantCachesService);
    }),
    { provide: TitleStrategy, useClass: PageTitleStrategy },
    provideServiceWorker('ngsw-worker.js', {
      enabled: environment.production,
      registrationStrategy: 'registerWhenStable:30000',
    }),
    /*
     * FIX-0564 — this used to be `Sentry.createErrorHandler()`, plus a
     * `Sentry.TraceService` provider and an `APP_INITIALIZER` whose only job was
     * to force that service to be constructed.
     *
     * All three referenced the `Sentry` namespace while the provider array was
     * being BUILT, which made `@sentry/angular` a static import of this file and
     * put 241.84 kB into the initial bundle of every visit — for an SDK that
     * reports nothing, because `environment.sentryDsn` is empty.
     *
     * The error handler now reaches the SDK through `TelemetryService`, which
     * loads it dynamically. Router tracing did not disappear: `TraceService` is
     * constructed in `main.ts` after bootstrap, inside the same dynamic import
     * that calls `Sentry.init()` — it only ever did anything once a client was
     * initialised, and now it is created in the same place.
     */
    { provide: ErrorHandler, useClass: TelemetryErrorHandler },
  ],
};
