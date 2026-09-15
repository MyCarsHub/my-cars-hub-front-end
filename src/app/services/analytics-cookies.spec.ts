import { describe, expect, it } from 'vitest';

import {
  analyticsCookieNames,
  domainVariants,
  expiryAssignments,
  isAnalyticsCookie,
} from './analytics-cookies';

/**
 * A cobertura de DOMINIO e o que decide se a limpeza funciona em producao, e e
 * exatamente o que um teste de integracao no jsdom NAO consegue provar: la a
 * origem e localhost, e o `.mycarshub.app.br` real nunca entra em jogo. Por isso
 * a geracao das atribuicoes e pura e conferida aqui, string por string.
 */
describe('analytics-cookies', () => {
  describe('isAnalyticsCookie', () => {
    it('reconhece os cookies do GA4, inclusive o por container', () => {
      expect(isAnalyticsCookie('_ga')).toBe(true);
      expect(isAnalyticsCookie('_ga_SW8RSDYTQN')).toBe(true);
      expect(isAnalyticsCookie('_gid')).toBe(true);
    });

    /** Nao e vassoura: apagar sessao ou preferencia alheia seria pior que o defeito. */
    it('nao toca em cookie que nao e de analytics', () => {
      for (const alheio of ['authToken', 'analyticsConsent', 'session', 'ga', '_gaXX']) {
        expect(isAnalyticsCookie(alheio)).toBe(false);
      }
    });
  });

  describe('domainVariants', () => {
    /**
     * O CASO QUE IMPORTA. O GA4 grava o `_ga` no eTLD+1, entao a partir de
     * `www.mycarshub.app.br` a limpeza SO funciona se `.mycarshub.app.br` estiver
     * entre as tentativas. Sem ele o cookie sobrevive e ninguem percebe.
     */
    it('cobre o eTLD+1 a partir do host com www', () => {
      const variants = domainVariants('www.mycarshub.app.br');

      expect(variants).toContain('.mycarshub.app.br');
      expect(variants).toContain('mycarshub.app.br');
      expect(variants).toContain('.www.mycarshub.app.br');
      // host-only (sem atributo domain) tambem, que e como alguns cookies entram
      expect(variants).toContain(null);
    });

    it('funciona no apex, sem inventar um rotulo a mais', () => {
      const variants = domainVariants('mycarshub.app.br');

      expect(variants).toContain('.mycarshub.app.br');
      expect(variants).toContain('mycarshub.app.br');
    });

    it('nao quebra em localhost', () => {
      expect(domainVariants('localhost')).toEqual([null]);
    });
  });

  describe('expiryAssignments', () => {
    it('expira no passado, no path raiz, em todas as variantes de dominio', () => {
      const assignments = expiryAssignments('_ga', 'www.mycarshub.app.br');

      expect(assignments.every((a) => a.startsWith('_ga=;'))).toBe(true);
      expect(assignments.every((a) => a.includes('expires=Thu, 01 Jan 1970'))).toBe(true);
      expect(assignments.every((a) => a.includes('path=/'))).toBe(true);
      expect(assignments).toContain(
        '_ga=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.mycarshub.app.br',
      );
    });
  });

  describe('analyticsCookieNames', () => {
    it('extrai so os de analytics de um header real', () => {
      const header = '_ga=GA1.1.123; authToken=abc; _ga_SW8RSDYTQN=GS1.1.9; outro=1';

      expect(analyticsCookieNames(header)).toEqual(['_ga', '_ga_SW8RSDYTQN']);
    });

    it('aguenta header vazio', () => {
      expect(analyticsCookieNames('')).toEqual([]);
    });
  });
});
