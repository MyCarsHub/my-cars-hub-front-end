import { describe, expect, it } from 'vitest';
import { homeRouteForRole } from './home-route';

describe('home-route', () => {
  /**
   * FEAT-0108 — `/dashboard` e 403 para DRIVER desde o FIX-0360, entao a casa
   * dele e `/alugueis`, a unica area que o escopo libera.
   */
  it('manda o motorista para /alugueis', () => {
    expect(homeRouteForRole('DRIVER')).toBe('/alugueis');
  });

  it('mantem /dashboard para os demais papeis', () => {
    expect(homeRouteForRole('OWNER')).toBe('/dashboard');
    expect(homeRouteForRole('MANAGER')).toBe('/dashboard');
  });

  /** Sem papel resolvido o destino antigo continua valendo. */
  it('cai em /dashboard quando nao ha papel', () => {
    expect(homeRouteForRole(null)).toBe('/dashboard');
    expect(homeRouteForRole(undefined)).toBe('/dashboard');
    expect(homeRouteForRole('')).toBe('/dashboard');
  });
});
