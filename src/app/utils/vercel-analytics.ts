import { inject } from '@vercel/analytics';

/**
 * Liga o Vercel Web Analytics — coleta cookieless de pageviews, sem consentimento extra.
 *
 * Chamado UMA vez no bootstrap do browser (`main.ts`). Só injeta o script quando
 * `isProduction` é true, e sempre com `mode: 'production'` explícito: o modo `'auto'`
 * do pacote lê `process.env.NODE_ENV`, que não existe no bundle browser do Angular —
 * o try/catch interno cai no default `"production"` e o `ng serve` passaria a carregar
 * o script real. O gate por `environment.production` é a única barreira confiável aqui.
 *
 * O script (`/_vercel/insights/script.js`) e o beacon (`/_vercel/insights/*`) são
 * same-origin na Vercel, então o CSP atual (`script-src 'self'`, `connect-src 'self'`)
 * já os cobre. SPA: o script detecta `pushState` sozinho — nada de hook no Router.
 *
 * @returns true se o script foi injetado, false se pulou (dev).
 */
export function initVercelAnalytics(
  isProduction: boolean,
  injectFn: typeof inject = inject,
): boolean {
  if (!isProduction) {
    return false;
  }
  injectFn({ mode: 'production' });
  return true;
}
