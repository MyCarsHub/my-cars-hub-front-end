import { describe, expect, it, vi } from 'vitest';
import { initVercelAnalytics } from './vercel-analytics';

describe('vercel-analytics', () => {
  /**
   * O gate por `environment.production` é a ÚNICA barreira contra carregar o script
   * em dev: o `mode: 'auto'` do pacote cai em "production" quando `process.env.NODE_ENV`
   * não existe (caso do bundle browser do Angular). Se este contrato quebrar, o
   * `ng serve` passa a enviar pageviews reais para o projeto na Vercel.
   */
  it('não injeta o script fora de produção', () => {
    const injectFn = vi.fn();

    const injected = initVercelAnalytics(false, injectFn);

    expect(injected).toBe(false);
    expect(injectFn).not.toHaveBeenCalled();
  });

  it('injeta exatamente uma vez em produção, com mode explícito (nunca "auto")', () => {
    const injectFn = vi.fn();

    const injected = initVercelAnalytics(true, injectFn);

    expect(injected).toBe(true);
    expect(injectFn).toHaveBeenCalledTimes(1);
    expect(injectFn).toHaveBeenCalledWith({ mode: 'production' });
  });
});
