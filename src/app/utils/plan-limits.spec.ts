import { describe, expect, it } from 'vitest';
import {
  PLAN_CAPACITY,
  normalizePlanName,
  planPresentsAsUnlimited,
  showsAsUnlimited,
} from './plan-limits';

describe('plan-limits', () => {
  // Cada par vem dos UPDATEs de limite da V59 (TRIAL 325-328, STARTER 330-333,
  // PRO 335-338, ENTERPRISE 340-343), conferidos contra o estado-alvo do
  // cabeçalho da própria migration (V59:9-15).
  it('espelha os tetos reais da V59', () => {
    // Só VEÍCULOS: o teto de motorista virou guarda-corpo interno (FEAT-0070).
    expect(PLAN_CAPACITY.TRIAL).toEqual({ vehicles: 3 });
    expect(PLAN_CAPACITY.STARTER).toEqual({ vehicles: 15 });
    expect(PLAN_CAPACITY.PRO).toEqual({ vehicles: 25 });
    expect(PLAN_CAPACITY.ENTERPRISE).toEqual({ vehicles: 100 });
  });

  // O catálogo tem QUATRO famílias depois da V59 — ver o estado-alvo em
  // V59:9-15 e a trava de completude em V59:425-432, que derruba o boot se
  // faltar linha ativa para qualquer uma delas. Um plano que exista na `plans`
  // e não aqui é a landing calando um teto que o backend aplica — foi assim que
  // o STARTER entrou sem aparecer em lugar nenhum.
  it('cobre todas as famílias do catálogo, sem sobra', () => {
    expect(Object.keys(PLAN_CAPACITY).sort()).toEqual([
      'ENTERPRISE',
      'PRO',
      'STARTER',
      'TRIAL',
    ]);
  });

  /**
   * Um carro roda com mais de um motorista (turnos, troca de titular no meio do
   * contrato), e uma proporção menor esgotaria o limite de motorista antes do
   * de frota. A V59 fixa motoristas = 3 × veículos nos planos PAGOS (V59:17-18)
   * e deixa o TRIAL fora de propósito — 3/4 é um teste, não uma operação.
   *
   * É decisão de produto, não fórmula: a razão vive nos números da migration.
   * Este teste existe para que um tier novo que a rompa quebre AQUI, e não na
   * frente do cliente.
   */
  /**
   * FEAT-0070 — a razão "motoristas = 3× veículos" morreu junto com o eixo: o
   * teto de motorista virou guarda-corpo interno (200 igual em todo plano),
   * saiu das respostas da API e saiu daqui. O que resta afirmar é que a tabela
   * NÃO guarda número de motorista: guardar um seria convidar a reexibição.
   */
  it('não guarda capacidade de motoristas — só veículos', () => {
    for (const tier of ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'] as const) {
      expect(Object.keys(PLAN_CAPACITY[tier])).toEqual(['vehicles']);
    }
    expect(PLAN_CAPACITY.TRIAL).toEqual({ vehicles: 3 });
  });

  /**
   * A escada precisa ser monotônica nos DOIS eixos: um tier mais caro que
   * entregue menos que o anterior em qualquer um deles é um catálogo que cobra
   * mais por menos. Um número trocado de lugar numa migration futura passaria
   * por todos os testes de valor acima — este é o único que o pega.
   */
  it('mantém a escada crescente — um tier nunca entrega menos que o anterior', () => {
    const ladder = [
      PLAN_CAPACITY.TRIAL,
      PLAN_CAPACITY.STARTER,
      PLAN_CAPACITY.PRO,
      PLAN_CAPACITY.ENTERPRISE,
    ];

    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i].vehicles).toBeGreaterThan(ladder[i - 1].vehicles);
    }
  });

  /**
   * Exportada porque `planTierOf` (em `plan-features.ts`) normaliza pelo MESMO
   * ponto. Testada direto para que a normalização não dependa de um predicado
   * para ser observada: se ela sumisse, `planPresentsAsUnlimited` continuaria
   * respondendo certo para os names já canônicos e só quebraria no dia em que a
   * API mandasse `" enterprise "`.
   */
  describe('normalizePlanName', () => {
    it('apara espaços e sobe a caixa do name vindo da API', () => {
      expect(normalizePlanName(' enterprise ')).toBe('ENTERPRISE');
      expect(normalizePlanName('Pro')).toBe('PRO');
      expect(normalizePlanName('\tstarter\n')).toBe('STARTER');
    });

    it('resolve ausência de name para string vazia, não para exceção', () => {
      expect(normalizePlanName(null)).toBe('');
      expect(normalizePlanName(undefined)).toBe('');
      expect(normalizePlanName('   ')).toBe('');
    });
  });

  describe('planPresentsAsUnlimited', () => {
    it('maquia só o ENTERPRISE', () => {
      expect(planPresentsAsUnlimited('ENTERPRISE')).toBe(true);
      expect(planPresentsAsUnlimited('PRO')).toBe(false);
      expect(planPresentsAsUnlimited('STARTER')).toBe(false);
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
      expect(showsAsUnlimited('ENTERPRISE', 100)).toBe(true);
      expect(showsAsUnlimited('ENTERPRISE', 300)).toBe(true);
    });

    it('mostra o número dos planos sem maquiagem', () => {
      expect(showsAsUnlimited('PRO', 25)).toBe(false);
      expect(showsAsUnlimited('PRO', 75)).toBe(false);
      expect(showsAsUnlimited('STARTER', 15)).toBe(false);
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
