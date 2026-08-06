import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { config } from './app/app.config.server';

/**
 * Prerender entry point. Executed by `@angular/build` at BUILD TIME only — `outputMode`
 * is `static`, so no server process is deployed and nothing here runs in production.
 *
 * No browser-API shims are needed, and none should be added: the two hazards this app
 * had were handled at the source instead.
 *  - `SessionService` already guards `sessionStorage`/`window` behind `typeof` checks.
 *  - The landing's scroll-reveal used `IntersectionObserver` and `NodeList.forEach` in
 *    `ngAfterViewInit`, which Angular DOES run on the server; those blocks now sit in
 *    `afterNextRender()`, which the server skips.
 * Every other `window` reference on a public page is inside a DOM event handler, and
 * events never fire during prerender.
 */
const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, config, context);

export default bootstrap;
