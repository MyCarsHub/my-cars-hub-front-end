import { describe, expect, it } from 'vitest';
import { PLAN_CAPACITY, planPresentsAsUnlimited, showsAsUnlimited } from './plan-limits';

describe('plan-limits', () => {
  it('espelha os tetos reais da V44', () => {
    expect(PLAN_CAPACITY.TRIAL).toEqual({ vehicles: 3, drivers: 4 });
    expect(PLAN_CAPACITY.PRO).toEqual({ vehicles: 20, drivers: 40 });
    expect(PLAN_CAPACITY.ENTERPRISE).toEqual({ vehicles: 500, drivers: 1000 });
  });

  describe('planPresentsAsUnlimited', () => {
    it('maquia só o ENTERPRISE', () => {
      expect(planPresentsAsUnlimited('ENTERPRISE')).toBe(true);
      expect(planPresentsAsUnlimited('PRO')).toBe(false);
      expect(planPresentsAsUnlimited('TRIAL')).toBe(false);
      expect(planPresentsAsUnlimited('BUSINESS')).toBe(false);
    });

    it('normaliza caixa e espaços do name vindo da API', () => {
      expect(planPresentsAsUnlimited(' enterprise ')).toBe(true);
    });

    it('sem plano conhecido, não maquia', () => {
      expect(planPresentsAsUnlimited(null)).toBe(false);
      expect(planPresentsAsUnlimited(undefined)).toBe(false);
      expect(planPresentsAsUnlimited('')).toBe(false);
    });
  });

  describe('showsAsUnlimited', () => {
    it('esconde o teto real do ENTERPRISE', () => {
      expect(showsAsUnlimited('ENTERPRISE', 500)).toBe(true);
      expect(showsAsUnlimited('ENTERPRISE', 1000)).toBe(true);
    });

    it('mostra o número dos planos sem maquiagem', () => {
      expect(showsAsUnlimited('PRO', 20)).toBe(false);
      expect(showsAsUnlimited('PRO', 40)).toBe(false);
      expect(showsAsUnlimited('TRIAL', 3)).toBe(false);
    });

    // O sentinela da coluna continua valendo mesmo sem nenhum plano usando-o
    // hoje — é a semântica documentada de `plans.vehicle_limit` nula.
    it('mantém o ramo de limite nulo/ausente', () => {
      expect(showsAsUnlimited('PRO', null)).toBe(true);
      expect(showsAsUnlimited('TRIAL', undefined)).toBe(true);
      expect(showsAsUnlimited(null, null)).toBe(true);
    });
  });
});
