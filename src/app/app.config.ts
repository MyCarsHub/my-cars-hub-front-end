import {
  APP_INITIALIZER,
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideBrowserGlobalErrorListeners,
  provideEnvironmentInitializer,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  Router,
  TitleStrategy,
} from '@angular/router';
import { provideClientHydration } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import * as Sentry from '@sentry/angular';

import { routes } from './app.routes';
import { authInterceptor } from './services/auth.interceptor';
import { errorInterceptor } from './services/error.interceptor';
import { impersonationInterceptor } from './services/impersonation.interceptor';
import { PageTitleStrategy } from './services/page-title.strategy';
import { prerenderApiBaseInterceptor } from './services/prerender-api-base.interceptor';
import { ImpersonationService } from './services/impersonation.service';
import { TenantCachesService } from './services/tenant-caches.service';
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
    {
      provide: ErrorHandler,
      useValue: Sentry.createErrorHandler(),
    },
    {
      provide: Sentry.TraceService,
      deps: [Router],
    },
    {
      provide: APP_INITIALIZER,
      useFactory: () => () => {},
      deps: [Sentry.TraceService],
      multi: true,
    },
  ],
};
