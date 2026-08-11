import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';

import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { blogApiBase, blogRenderTimeoutMs } from './prerender-blog';
import { PRERENDER_API } from './services/prerender-api-base.interceptor';

/**
 * Server (prerender) configuration. Runs ONLY during `ng build` — `outputMode: static`
 * emits no runtime server, so nothing here reaches production as a running process.
 *
 * `PRERENDER_API` is provided HERE and nowhere else. It is what lets `BlogList` and
 * `BlogDetail` reach a real API while being prerendered: `environment.prod.apiUrl` is the
 * relative `/api/v1`, which has no origin to resolve against at build time. Because the
 * token is absent in the browser bundle, the interceptor that consumes it is inert in
 * production — the running app keeps using the relative path and the Vercel rewrite.
 *
 * It carries a timeout as well as a base, and that is not optional: Node's `fetch` never
 * times out on its own, so an API that accepts the connection and then goes quiet would
 * hang the prerender — and the build — indefinitely.
 *
 * The timeout is `blogRenderTimeoutMs()`, NOT the params-phase `blogPrerenderTimeoutMs()`.
 * This token is read only while `@angular/ssr` renders a route, which happens after
 * `blogPrerenderParams` has returned and therefore outside its wall-clock budget: the
 * render phase's only bound is this ceiling times `MAX_PRERENDERED`. The params phase has
 * already absorbed the cold start and warmed every accepted slug, so the render phase
 * needs the shorter, tighter number. See the arithmetic on `MAX_PRERENDERED`.
 */
const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    {
      provide: PRERENDER_API,
      useValue: { base: blogApiBase(), timeoutMs: blogRenderTimeoutMs() },
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
