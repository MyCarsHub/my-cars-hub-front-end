import { describe, expect, it } from 'vitest';

import {
  IDLE_THRESHOLD_DAYS,
  MAX_WINDOW_DAYS,
  addDays,
  buildGrid,
  exceedsWindowLimit,
  normalizeKind,
  windowDays,
} from './fleet-calendar.grid';
import {
  FleetCalendarBlock,
  FleetCalendarResponse,
  FleetCalendarVehicle,
} from '../../../types/fleet-calendar.types';

/**
 * Cobre a montagem client-side da grade de ocupação:
 *  - posição/largura das barras dentro da janela;
 *  - bloco que extravasa a janela nas duas pontas (o que a tela desenha como
 *    "entrando pela esquerda" em vez de fingir que começou no dia 1);
 *  - sobreposição empilhada em sub-faixas em vez de fundida;
 *  - manutenção de um único dia (limitação de schema da V19);
 *  - ociosidade dentro da janela e o limiar de "veículo parado";
 *  - janela vazia / invertida / acima do teto de 366 dias.
 *
 * Janela padrão dos casos: agosto/2026, 31 dias — cada dia vale 1/31 da largura.
 */
describe('fleet-calendar.grid', () => {
  const FROM = '2026-08-01';
  const TO = '2026-08-31';
  const DAY = 100 / 31;

  function block(partial: Partial<FleetCalendarBlock> = {}): FleetCalendarBlock {
    return {
      kind: 'RENTAL',
      sourceId: 'rental-1',
      status: 'ACTIVE',
      start: '2026-08-05',
      end: '2026-08-09',
      label: 'João Silva',
      ...partial,
    };
  }

  function vehicle(blocks: FleetCalendarBlock[], partial: Partial<FleetCalendarVehicle> = {}): FleetCalendarVehicle {
    return {
      vehicleId: 'veh-1',
      plate: 'ABC1D23',
      label: 'Fiat Argo · ABC1D23',
      vehicleStatus: 'AVAILABLE',
      blocks,
      ...partial,
    };
  }

  function response(
    vehicles: FleetCalendarVehicle[],
    from = FROM,
    to = TO,
  ): FleetCalendarResponse {
    return { from, to, timezone: 'America/Sao_Paulo', vehicles };
  }

  // ------------------------------------------------------------- janela

  describe('janela', () => {
    it('conta os dois extremos — 01/08 a 31/08 são 31 dias', () => {
      expect(windowDays(FROM, TO)).toBe(31);
      expect(windowDays('2026-08-10', '2026-08-10')).toBe(1);
    });

    it('devolve 0 para janela invertida, que o backend recusa com 400', () => {
      expect(windowDays(TO, FROM)).toBe(0);
    });

    it('só estoura o teto ACIMA de 366 dias — 366 exatos ainda passam', () => {
      const from = '2026-01-01';
      expect(windowDays(from, addDays(from, MAX_WINDOW_DAYS - 1))).toBe(366);
      expect(exceedsWindowLimit(from, addDays(from, MAX_WINDOW_DAYS - 1))).toBe(false);
      expect(exceedsWindowLimit(from, addDays(from, MAX_WINDOW_DAYS))).toBe(true);
    });

    it('soma dias sem escorregar de fuso na virada do mês', () => {
      // `new Date('2026-08-31').getDate()` devolveria 30 a oeste de Greenwich.
      expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
      expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    });

    it('usa a janela devolvida pelo backend, não a pedida pela tela', () => {
      // Sem `from`/`to` o backend aplica o mês corrente em horário de Brasília.
      const grid = buildGrid(response([vehicle([])], '2026-09-01', '2026-09-30'));
      expect(grid.from).toBe('2026-09-01');
      expect(grid.days).toBe(30);
      expect(grid.timezone).toBe('America/Sao_Paulo');
    });

    it('janela invertida não quebra a montagem: grade vazia, sem faixas', () => {
      const grid = buildGrid(response([vehicle([block()])], TO, FROM));
      expect(grid.days).toBe(0);
      expect(grid.lanes).toEqual([]);
      expect(grid.blockCount).toBe(0);
    });
  });

  // ------------------------------------------------------- posicionamento

  describe('posicionamento das barras', () => {
    it('posiciona o bloco proporcionalmente à janela, contando o dia final', () => {
      const grid = buildGrid(response([vehicle([block({ start: '2026-08-05', end: '2026-08-09' })])]));
      const [bar] = grid.lanes[0].blocks;

      // 4 dias de deslocamento (01→05) e 5 dias de duração (05..09, inclusivo).
      expect(bar.offsetPercent).toBeCloseTo(4 * DAY, 6);
      expect(bar.widthPercent).toBeCloseTo(5 * DAY, 6);
      expect(bar.visibleDays).toBe(5);
      expect(bar.totalDays).toBe(5);
    });

    it('bloco de um único dia ocupa 1/31 e não some da grade', () => {
      // Manutenção ocupa UM dia: a V19 só tem data de serviço, sem término.
      const grid = buildGrid(
        response([
          vehicle([
            block({ kind: 'MAINTENANCE', sourceId: 'mnt-1', status: 'SCHEDULED', start: '2026-08-14', end: '2026-08-14', label: 'Revisão' }),
          ]),
        ]),
      );
      const [bar] = grid.lanes[0].blocks;

      expect(bar.kind).toBe('MAINTENANCE');
      expect(bar.visibleDays).toBe(1);
      expect(bar.widthPercent).toBeCloseTo(DAY, 6);
      expect(bar.continuesBefore).toBe(false);
      expect(bar.continuesAfter).toBe(false);
    });

    it('bloco que cobre a janela inteira vai de 0 a 100%', () => {
      const grid = buildGrid(response([vehicle([block({ start: FROM, end: TO })])]));
      const [bar] = grid.lanes[0].blocks;
      expect(bar.offsetPercent).toBe(0);
      expect(bar.widthPercent).toBe(100);
    });

    it('descarta bloco que não intersecta a janela em vez de desenhá-lo fora', () => {
      const grid = buildGrid(
        response([vehicle([block({ start: '2026-06-01', end: '2026-06-10' })])]),
      );
      expect(grid.lanes[0].blocks).toEqual([]);
      expect(grid.blockCount).toBe(0);
    });

    it('gera régua com no máximo 6 marcas, começando no primeiro dia', () => {
      const grid = buildGrid(response([vehicle([])]));
      expect(grid.ticks.length).toBeGreaterThan(0);
      expect(grid.ticks.length).toBeLessThanOrEqual(6);
      expect(grid.ticks[0]).toMatchObject({ date: FROM, label: '01/08', offsetPercent: 0 });
    });
  });

  // ------------------------------------------------------ extravasa janela

  describe('bloco que extravasa a janela', () => {
    it('preserva a data REAL de início e marca que entra pela esquerda', () => {
      const grid = buildGrid(
        response([vehicle([block({ start: '2026-07-20', end: '2026-08-04' })])]),
      );
      const [bar] = grid.lanes[0].blocks;

      // A barra é recortada só para DESENHO — a data original continua exposta,
      // senão a tela fingiria que o aluguel começou no primeiro dia da janela.
      expect(bar.start).toBe('2026-07-20');
      expect(bar.continuesBefore).toBe(true);
      expect(bar.continuesAfter).toBe(false);
      expect(bar.offsetPercent).toBe(0);
      expect(bar.visibleDays).toBe(4);
      expect(bar.totalDays).toBe(16);
      expect(bar.widthPercent).toBeCloseTo(4 * DAY, 6);
    });

    it('preserva a data REAL de fim e marca que sai pela direita', () => {
      const grid = buildGrid(
        response([vehicle([block({ start: '2026-08-28', end: '2026-09-15' })])]),
      );
      const [bar] = grid.lanes[0].blocks;

      expect(bar.end).toBe('2026-09-15');
      expect(bar.continuesAfter).toBe(true);
      expect(bar.continuesBefore).toBe(false);
      expect(bar.visibleDays).toBe(4);
      expect(bar.offsetPercent).toBeCloseTo(27 * DAY, 6);
      // Nunca ultrapassa a borda direita da faixa.
      expect(bar.offsetPercent + bar.widthPercent).toBeCloseTo(100, 6);
    });

    it('bloco que atravessa a janela inteira é contínuo nas DUAS pontas', () => {
      const grid = buildGrid(
        response([vehicle([block({ start: '2026-05-01', end: '2026-12-31' })])]),
      );
      const [bar] = grid.lanes[0].blocks;

      expect(bar.continuesBefore).toBe(true);
      expect(bar.continuesAfter).toBe(true);
      expect(bar.offsetPercent).toBe(0);
      expect(bar.widthPercent).toBe(100);
      expect(bar.visibleDays).toBe(31);
      expect(bar.totalDays).toBeGreaterThan(31);
    });
  });

  // ---------------------------------------------------------- sobreposição

  describe('sobreposição', () => {
    it('empilha blocos sobrepostos em sub-faixas em vez de fundi-los', () => {
      // Aluguel concluído antes do prazo convivendo com o próximo já reservado:
      // fundir esconderia justamente o conflito que a tela existe para revelar.
      const grid = buildGrid(
        response([
          vehicle([
            block({ sourceId: 'r-1', status: 'COMPLETED', start: '2026-08-05', end: '2026-08-12' }),
            block({ sourceId: 'r-2', status: 'RESERVED', start: '2026-08-10', end: '2026-08-18' }),
          ]),
        ]),
      );
      const lane = grid.lanes[0];

      expect(lane.blocks).toHaveLength(2);
      expect(lane.blocks.map((b) => b.sourceId)).toEqual(['r-1', 'r-2']);
      expect(lane.blocks.map((b) => b.lane)).toEqual([0, 1]);
      expect(lane.laneCount).toBe(2);
      expect(lane.hasOverlap).toBe(true);
      expect(grid.overlapVehicleCount).toBe(1);
    });

    it('blocos que só encostam (fim de um = início do outro) SÃO sobreposição', () => {
      // Intervalos fechados nas duas pontas: 08 pertence aos dois registros.
      const grid = buildGrid(
        response([
          vehicle([
            block({ sourceId: 'r-1', start: '2026-08-05', end: '2026-08-08' }),
            block({ sourceId: 'r-2', start: '2026-08-08', end: '2026-08-12' }),
          ]),
        ]),
      );
      expect(grid.lanes[0].laneCount).toBe(2);
    });

    it('blocos consecutivos sem dia em comum ficam na MESMA sub-faixa', () => {
      const grid = buildGrid(
        response([
          vehicle([
            block({ sourceId: 'r-1', start: '2026-08-05', end: '2026-08-08' }),
            block({ sourceId: 'r-2', start: '2026-08-09', end: '2026-08-12' }),
          ]),
        ]),
      );
      const lane = grid.lanes[0];
      expect(lane.blocks.map((b) => b.lane)).toEqual([0, 0]);
      expect(lane.hasOverlap).toBe(false);
      expect(grid.overlapVehicleCount).toBe(0);
    });

    it('manutenção sobre aluguel também empilha — origens distintas, mesmo dia', () => {
      const grid = buildGrid(
        response([
          vehicle([
            block({ sourceId: 'r-1', start: '2026-08-05', end: '2026-08-20' }),
            block({ kind: 'MAINTENANCE', sourceId: 'm-1', status: 'DONE', start: '2026-08-10', end: '2026-08-10' }),
          ]),
        ]),
      );
      const lane = grid.lanes[0];
      expect(lane.laneCount).toBe(2);
      expect(lane.blocks.map((b) => b.kind)).toEqual(['RENTAL', 'MAINTENANCE']);
    });

    it('três blocos mutuamente sobrepostos abrem três sub-faixas', () => {
      const grid = buildGrid(
        response([
          vehicle([
            block({ sourceId: 'a', start: '2026-08-05', end: '2026-08-20' }),
            block({ sourceId: 'b', start: '2026-08-06', end: '2026-08-21' }),
            block({ sourceId: 'c', start: '2026-08-07', end: '2026-08-22' }),
          ]),
        ]),
      );
      expect(grid.lanes[0].blocks.map((b) => b.lane)).toEqual([0, 1, 2]);
      expect(grid.lanes[0].laneCount).toBe(3);
    });

    it('reaproveita a sub-faixa 0 quando ela já vagou', () => {
      const grid = buildGrid(
        response([
          vehicle([
            block({ sourceId: 'a', start: '2026-08-01', end: '2026-08-05' }),
            block({ sourceId: 'b', start: '2026-08-04', end: '2026-08-08' }),
            block({ sourceId: 'c', start: '2026-08-10', end: '2026-08-12' }),
          ]),
        ]),
      );
      expect(grid.lanes[0].blocks.map((b) => b.lane)).toEqual([0, 1, 0]);
      expect(grid.lanes[0].laneCount).toBe(2);
    });
  });

  // -------------------------------------------------------------- ociosidade

  describe('ociosidade', () => {
    it('veículo sem nenhum bloco fica parado a janela inteira', () => {
      const grid = buildGrid(response([vehicle([])]));
      const idle = grid.lanes[0].idle;

      expect(idle.totalDays).toBe(31);
      expect(idle.longestRun).toBe(31);
      expect(idle.longestFrom).toBe(FROM);
      expect(idle.longestTo).toBe(TO);
      expect(idle.flagged).toBe(true);
      expect(grid.idleVehicleCount).toBe(1);
    });

    it('mede a maior corrida livre e onde ela começa', () => {
      const grid = buildGrid(
        response([
          vehicle([
            block({ sourceId: 'a', start: '2026-08-01', end: '2026-08-05' }),
            block({ sourceId: 'b', start: '2026-08-20', end: '2026-08-31' }),
          ]),
        ]),
      );
      const idle = grid.lanes[0].idle;

      expect(idle.longestRun).toBe(14); // 06..19
      expect(idle.longestFrom).toBe('2026-08-06');
      expect(idle.longestTo).toBe('2026-08-19');
      expect(idle.totalDays).toBe(14);
    });

    it('conta as pontas da janela como ociosas', () => {
      const grid = buildGrid(
        response([vehicle([block({ start: '2026-08-15', end: '2026-08-16' })])]),
      );
      const idle = grid.lanes[0].idle;
      expect(idle.totalDays).toBe(29); // 01..14 (14) + 17..31 (15)
      expect(idle.longestRun).toBe(15);
      expect(idle.longestFrom).toBe('2026-08-17');
    });

    it('bloco que extravasa a janela não gera ociosidade fantasma antes dele', () => {
      const grid = buildGrid(
        response([vehicle([block({ start: '2026-07-10', end: '2026-08-31' })])]),
      );
      expect(grid.lanes[0].idle.totalDays).toBe(0);
      expect(grid.lanes[0].idle.longestRun).toBe(0);
      expect(grid.lanes[0].idle.flagged).toBe(false);
    });

    it('só sinaliza a partir de 4 dias livres — "gap > 3 dias"', () => {
      const threeDays = buildGrid(
        response([
          vehicle([
            block({ sourceId: 'a', start: '2026-08-01', end: '2026-08-14' }),
            block({ sourceId: 'b', start: '2026-08-18', end: '2026-08-31' }),
          ]),
        ]),
      );
      expect(threeDays.lanes[0].idle.longestRun).toBe(3); // 15,16,17
      expect(threeDays.lanes[0].idle.flagged).toBe(false);
      expect(threeDays.idleVehicleCount).toBe(0);

      const fourDays = buildGrid(
        response([
          vehicle([
            block({ sourceId: 'a', start: '2026-08-01', end: '2026-08-14' }),
            block({ sourceId: 'b', start: '2026-08-19', end: '2026-08-31' }),
          ]),
        ]),
      );
      expect(fourDays.lanes[0].idle.longestRun).toBe(IDLE_THRESHOLD_DAYS);
      expect(fourDays.lanes[0].idle.flagged).toBe(true);
    });

    it('blocos sobrepostos não contam o mesmo dia livre duas vezes', () => {
      const grid = buildGrid(
        response([
          vehicle([
            block({ sourceId: 'a', start: '2026-08-01', end: '2026-08-20' }),
            block({ sourceId: 'b', start: '2026-08-10', end: '2026-08-31' }),
          ]),
        ]),
      );
      expect(grid.lanes[0].idle.totalDays).toBe(0);
    });
  });

  // ------------------------------------------------------------ período vazio

  describe('período sem dado', () => {
    it('frota inteira livre devolve as faixas mas blockCount 0', () => {
      const grid = buildGrid(
        response([
          vehicle([], { vehicleId: 'v-1' }),
          vehicle([], { vehicleId: 'v-2', plate: 'XYZ9K88' }),
        ]),
      );
      expect(grid.lanes).toHaveLength(2);
      expect(grid.blockCount).toBe(0);
      expect(grid.idleVehicleCount).toBe(2);
    });

    it('frota vazia devolve grade sem faixas — nada a desenhar', () => {
      const grid = buildGrid(response([]));
      expect(grid.lanes).toEqual([]);
      expect(grid.blockCount).toBe(0);
      expect(grid.idleVehicleCount).toBe(0);
    });
  });

  // ------------------------------------------------------------ discriminador

  describe('kind', () => {
    it('normaliza os dois valores conhecidos e aceita minúsculas', () => {
      expect(normalizeKind('RENTAL')).toBe('RENTAL');
      expect(normalizeKind('maintenance')).toBe('MAINTENANCE');
    });

    it('kind desconhecido vira OTHER e continua desenhado', () => {
      // Discriminador aberto: uma origem nova de indisponibilidade não pode
      // sumir da grade só porque o front ainda não a conhece.
      const grid = buildGrid(
        response([vehicle([block({ kind: 'INSPECTION', sourceId: 'i-1' })])]),
      );
      expect(grid.lanes[0].blocks[0].kind).toBe('OTHER');
      expect(grid.blockCount).toBe(1);
    });
  });
});
