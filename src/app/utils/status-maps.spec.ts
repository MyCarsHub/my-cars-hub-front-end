import { describe, expect, it } from 'vitest';

import {
  DRIVER_STATUS_FILTER_OPTIONS,
  DRIVER_STATUS_META,
  FINE_SEVERITY_FILTER_OPTIONS,
  FINE_SEVERITY_META,
  RENTAL_STATUS_FILTER_OPTIONS,
  RENTAL_STATUS_META,
  VEHICLE_STATUS_FILTER_OPTIONS,
  VEHICLE_STATUS_META,
  defaultPointsForSeverity,
} from './status-maps';
import type { FineSeverity } from '../types/fine.types';

/**
 * UMA fonte para os pontos da gravidade.
 *
 * Historia curta, porque ela e a razao deste arquivo existir:
 * - O FIX-0437 nasceu de DUAS copias do mesmo numero (o mapa e o prefill).
 * - O conserto do FIX-0437 tirou aquelas duas... e criou outras duas, um
 *   arquivo adiante: `defaultPointsForSeverity` passou a ler `FINE_SEVERITY_META`
 *   enquanto o ROTULO da opcao ("Média (4 pts)") continuou lendo um literal
 *   cravado em `FINE_SEVERITY_FILTER_OPTIONS`.
 * - Os numeros coincidiam, entao nada quebrou. O pior caso silencioso: a tela
 *   promete "(4 pts)" e o formulario grava outro numero.
 *
 * Por isso este teste NAO compara 4 com 4. Ele le OS DOIS LADOS do codigo e
 * afirma que sao o mesmo valor — se alguem mudar um sem o outro, cai aqui.
 * Mesma licao do FIX-0431: quando a regra e uma RELACAO ("igual a", "menor
 * que"), os dois lados tem de estar dentro do teste.
 */
describe('pontos da gravidade — fonte unica', () => {
  const SEVERITIES = Object.keys(FINE_SEVERITY_META) as FineSeverity[];

  it('o numero do ROTULO e o numero que o formulario GRAVA, para toda gravidade', () => {
    for (const severity of SEVERITIES) {
      const option = FINE_SEVERITY_FILTER_OPTIONS.find((o) => o.value === severity);

      expect(option, `gravidade ${severity} sumiu das opcoes`).toBeDefined();
      expect(
        option!.defaultPoints,
        `"${option!.label} (${option!.defaultPoints} pts)" promete um numero diferente do que seria gravado`,
      ).toBe(defaultPointsForSeverity(severity));
    }
  });

  /** A opcao "Todas" e do FILTRO, nao e gravidade: nao tem pontos. */
  it('a opcao de filtro "Todas" nao promete pontuacao', () => {
    const todas = FINE_SEVERITY_FILTER_OPTIONS.find((o) => o.value === '');

    expect(todas?.defaultPoints).toBe(0);
  });

  /** Nenhuma gravidade pode ficar sem pontos — todas as quatro pontuam no CTB. */
  it('toda gravidade tem pontuacao definida', () => {
    for (const severity of SEVERITIES) {
      expect(defaultPointsForSeverity(severity), `gravidade ${severity} sem pontos`).toBeGreaterThan(
        0,
      );
    }
  });

  /**
   * Os valores do CTB, afirmados UMA vez e num lugar so. Este e o unico teste
   * que pode citar os numeros: ele existe para prender a tabela legal. Todos os
   * outros comparam fontes entre si, nunca com literal.
   */
  it('espelha a tabela do CTB', () => {
    expect(SEVERITIES.map((s) => defaultPointsForSeverity(s))).toEqual([3, 4, 5, 7]);
  });
});

/**
 * FIX-0445 — IGUALDADE entre o mapa e as opcoes de filtro.
 *
 * O instrumento aqui e a igualdade, nao a unificacao: unificar resolve HOJE, o
 * teste e o que impede a proxima copia de nascer. Quem redigitar um rotulo a
 * mao — ou renomear so um dos lados — derruba estes testes.
 *
 * Nao-vazio primeiro em todos: a colheita e um `filter`, e sem afirmar que ela
 * trouxe algo o teste passaria justamente quando a lista sumisse.
 */
describe('opcoes de filtro x mapa de status', () => {
  /** Descarta o "Todos" (value ''), que nao existe no mapa. */
  function reais<T extends { value: string }>(options: readonly T[]): T[] {
    return options.filter((o) => o.value !== '');
  }

  describe('motorista', () => {
    it('todo rotulo do filtro vem do mapa', () => {
      const linhas = reais(DRIVER_STATUS_FILTER_OPTIONS);

      expect(linhas).toHaveLength(3);
      for (const o of linhas) {
        const meta = DRIVER_STATUS_META[o.value as keyof typeof DRIVER_STATUS_META];
        expect(o.label).toBe(meta.label);
        expect(o.chip).toBe(meta.chip);
      }
    });

    it('cobre TODOS os status do mapa — nenhum fica fora do filtro', () => {
      expect(reais(DRIVER_STATUS_FILTER_OPTIONS).map((o) => o.value).sort()).toEqual(
        Object.keys(DRIVER_STATUS_META).sort(),
      );
    });
  });

  describe('veiculo', () => {
    it('todo rotulo do filtro vem do mapa', () => {
      const linhas = reais(VEHICLE_STATUS_FILTER_OPTIONS);

      expect(linhas).toHaveLength(4);
      for (const o of linhas) {
        const meta = VEHICLE_STATUS_META[o.value as keyof typeof VEHICLE_STATUS_META];
        expect(o.label).toBe(meta.label);
        expect(o.chip).toBe(meta.chip);
      }
    });

    it('cobre TODOS os status do mapa', () => {
      expect(reais(VEHICLE_STATUS_FILTER_OPTIONS).map((o) => o.value).sort()).toEqual(
        Object.keys(VEHICLE_STATUS_META).sort(),
      );
    });
  });

  /**
   * ALUGUEL e a EXCECAO e o teste afirma a divergencia, nao a igualdade: o
   * filtro nomeia um CONJUNTO ("Reservados") e o selo nomeia UM aluguel
   * ("Reservado"). Se alguem unificar por simetria, este teste cai — e a
   * mudanca de copy passa a ser uma decisao, nao um efeito colateral.
   */
  describe('aluguel — plural no filtro, singular no selo', () => {
    it('o rotulo do filtro e o plural do rotulo do mapa', () => {
      const linhas = reais(RENTAL_STATUS_FILTER_OPTIONS);

      expect(linhas).toHaveLength(4);
      for (const o of linhas) {
        const meta = RENTAL_STATUS_META[o.value as keyof typeof RENTAL_STATUS_META];
        expect(o.label).toBe(`${meta.label}s`);
      }
    });

    it('mas o chip continua vindo do mapa', () => {
      for (const o of reais(RENTAL_STATUS_FILTER_OPTIONS)) {
        const meta = RENTAL_STATUS_META[o.value as keyof typeof RENTAL_STATUS_META];
        expect(o.chip).toBe(meta.chip);
      }
    });
  });
});
