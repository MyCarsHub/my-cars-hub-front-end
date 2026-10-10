import { describe, expect, it } from 'vitest';
import { homeRouteForRole } from './home-route';

describe('home-route', () => {
  /**
   * FEAT-0108 — `/dashboard` e 403 para DRIVER desde o FIX-0360, entao a casa
   * dele nao e o painel da frota. Antes era `/alugueis` (a unica area que o escopo
   * liberava); agora e o painel PROPRIO dele, `/meu-painel`, e `/alugueis` segue
   * alcancavel pelo menu.
   */
  it('manda o motorista para o painel proprio dele', () => {
    expect(homeRouteForRole('DRIVER')).toBe('/meu-painel');
  });

  it('o motorista nao e mais mandado para /alugueis nem para o painel da frota', () => {
    expect(homeRouteForRole('DRIVER')).not.toBe('/alugueis');
    expect(homeRouteForRole('DRIVER')).not.toBe('/dashboard');
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
