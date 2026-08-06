/**
 * Montagem client-side da grade de ocupação da frota.
 *
 * Funções **puras** sobre a resposta de `GET /v1/fleet/calendar`. Tudo o que a
 * tela precisa decidir — posição/largura de cada barra, empilhamento de blocos
 * sobrepostos, bordas "continua fora da janela" e intervalos ociosos — mora
 * aqui, e não no componente: é o que permite testar a grade sem TestBed e sem
 * alargar a superfície pública do componente.
 *
 * ## Datas
 * As datas do contrato são dias-calendário `YYYY-MM-DD` no fuso de negócio
 * (`America/Sao_Paulo`), nunca instantes. A aritmética usa **dias-epoch em
 * UTC** justamente para não passar por conversão de fuso: `new Date('2026-08-01')`
 * seguido de `getDate()` devolveria 31/07 para quem está a oeste de Greenwich.
 */

import { FleetCalendarBlock, FleetCalendarResponse } from '../../../types/fleet-calendar.types';

const MS_PER_DAY = 86_400_000;

/**
 * Teto de janela aceito pelo backend (`FleetCalendarService.MAX_SPAN_DAYS`),
 * inclusivo nas duas pontas. Acima disso ele recusa com 400 **antes** de
 * consultar — a tela checa antes para não gastar o round-trip.
 */
export const MAX_WINDOW_DAYS = 366;

/**
 * A partir de quantos dias consecutivos livres o veículo é sinalizado como
 * parado. O bloco de FUTURE_FEATURES pede "gaps > 3 dias", logo o menor
 * intervalo sinalizado tem 4 dias.
 */
export const IDLE_THRESHOLD_DAYS = 4;

/** Origem normalizada. `OTHER` cobre um `kind` novo que o backend passe a emitir. */
export type GridBlockKind = 'RENTAL' | 'MAINTENANCE' | 'OTHER';

export interface GridBlock {
  readonly kind: GridBlockKind;
  readonly sourceId: string;
  readonly status: string;
  /** Data real de início do registro — pode ser anterior ao início da janela. */
  readonly start: string;
  /** Data real de fim do registro — pode ser posterior ao fim da janela. */
  readonly end: string;
  readonly label: string;
  /** Borda esquerda da barra, em % da janela. Sempre dentro de `[0, 100]`. */
  readonly offsetPercent: number;
  /** Largura da barra, em % da janela. Só a parte VISÍVEL do bloco. */
  readonly widthPercent: number;
  /** O registro começa antes da janela: a barra entra pela esquerda. */
  readonly continuesBefore: boolean;
  /** O registro termina depois da janela: a barra sai pela direita. */
  readonly continuesAfter: boolean;
  /** Sub-faixa em que o bloco foi empilhado (0 = primeira). */
  readonly lane: number;
  /** Dias do bloco dentro da janela (≥ 1). */
  readonly visibleDays: number;
  /** Duração real do registro em dias, ignorando a janela. */
  readonly totalDays: number;
}

/** Ociosidade do veículo **dentro da janela** — ver {@link computeIdle}. */
export interface IdleSummary {
  /** Soma dos dias livres na janela. */
  readonly totalDays: number;
  /** Maior corrida consecutiva de dias livres. */
  readonly longestRun: number;
  readonly longestFrom: string | null;
  readonly longestTo: string | null;
  /** `longestRun >= IDLE_THRESHOLD_DAYS`. */
  readonly flagged: boolean;
}

export interface GridLane {
  readonly vehicleId: string;
  readonly plate: string;
  readonly label: string;
  readonly vehicleStatus: string;
  readonly blocks: readonly GridBlock[];
  /** Quantas sub-faixas o empilhamento precisou. 1 = nenhuma sobreposição. */
  readonly laneCount: number;
  /** `laneCount > 1` — há pelo menos dois blocos disputando o mesmo dia. */
  readonly hasOverlap: boolean;
  readonly idle: IdleSummary;
}

/** Marca de escala desenhada acima da grade. */
export interface GridTick {
  readonly date: string;
  readonly label: string;
  readonly offsetPercent: number;
}

export interface FleetGrid {
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
  /** Dias da janela, inclusivo nas duas pontas. */
  readonly days: number;
  readonly lanes: readonly GridLane[];
  readonly ticks: readonly GridTick[];
  /** Total de blocos na janela — `0` é o estado "período sem nenhum dado". */
  readonly blockCount: number;
  /** Veículos com pelo menos uma corrida ociosa sinalizada. */
  readonly idleVehicleCount: number;
  /** Veículos com blocos sobrepostos. */
  readonly overlapVehicleCount: number;
}

// ------------------------------------------------------------------ datas

/** `YYYY-MM-DD` → dias desde a epoch, em UTC. `NaN` para entrada inválida. */
export function toEpochDay(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY;
}

/** Dias desde a epoch → `YYYY-MM-DD`. */
export function fromEpochDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Dias da janela `[from, to]`, inclusivo nas duas pontas. `0` se invertida. */
export function windowDays(from: string, to: string): number {
  const span = toEpochDay(to) - toEpochDay(from) + 1;
  return Number.isFinite(span) && span > 0 ? span : 0;
}

/** `true` quando a janela estoura o teto do backend e o request seria recusado. */
export function exceedsWindowLimit(from: string, to: string): boolean {
  return windowDays(from, to) > MAX_WINDOW_DAYS;
}

/** Soma dias a uma data `YYYY-MM-DD` sem passar por fuso local. */
export function addDays(iso: string, days: number): string {
  return fromEpochDay(toEpochDay(iso) + days);
}

/** `YYYY-MM-DD` → `DD/MM` para os rótulos da régua e das barras. */
export function shortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return match ? `${match[3]}/${match[2]}` : '—';
}

/** `YYYY-MM-DD` → `DD/MM/AAAA` para textos acessíveis e tooltips. */
export function longDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

// ------------------------------------------------------------------ grade

/**
 * `kind` é discriminador aberto no backend: um valor desconhecido vira `OTHER`
 * e ainda é desenhado, em vez de sumir da grade.
 */
export function normalizeKind(kind: string): GridBlockKind {
  const upper = (kind ?? '').toUpperCase();
  return upper === 'RENTAL' || upper === 'MAINTENANCE' ? upper : 'OTHER';
}

interface ClampedBlock {
  readonly source: FleetCalendarBlock;
  readonly visibleStart: number;
  readonly visibleEnd: number;
}

/**
 * Recorta o bloco na janela **para desenho**, preservando as datas reais.
 * Devolve `null` quando o bloco não intersecta a janela (não deveria chegar do
 * backend, mas um `vehicleId` reaproveitado entre requisições chegaria).
 */
function clamp(block: FleetCalendarBlock, fromDay: number, toDay: number): ClampedBlock | null {
  const start = toEpochDay(block.start);
  const end = toEpochDay(block.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;

  const visibleStart = Math.max(start, fromDay);
  const visibleEnd = Math.min(end, toDay);
  if (visibleEnd < visibleStart) return null;

  return { source: block, visibleStart, visibleEnd };
}

/**
 * Empilha blocos sobrepostos em sub-faixas (first-fit por ordem de início).
 *
 * Blocos sobrepostos vêm SEPARADOS do backend de propósito — um aluguel
 * concluído antes do prazo convive com o próximo já reservado, e fundir
 * esconderia justamente o conflito que a tela existe para revelar. Empilhar em
 * linhas distintas é o que torna a sobreposição visível em vez de deixar uma
 * barra por cima da outra.
 *
 * @returns o índice de sub-faixa de cada bloco, na mesma ordem da entrada.
 */
function packIntoLanes(blocks: readonly ClampedBlock[]): number[] {
  /** Último dia ocupado de cada sub-faixa. */
  const laneEnds: number[] = [];
  return blocks.map((block) => {
    let lane = laneEnds.findIndex((end) => end < block.visibleStart);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = block.visibleEnd;
    return lane;
  });
}

/**
 * Ociosidade = dias da janela **não cobertos por nenhum bloco**.
 *
 * A medida é estritamente interna à janela: o backend só devolve o que
 * intersecta `[from, to]`, então um aluguel que começa depois de `to` não chega
 * — dizer que o veículo está livre "até sempre" seria inventar informação. Por
 * isso as pontas contam: um veículo sem nenhum bloco tem UMA corrida ociosa do
 * tamanho da janela inteira, e é exatamente essa a leitura útil ("parado o mês
 * todo"). Dias ocupados por qualquer origem — aluguel RESERVED/ACTIVE/COMPLETED
 * ou manutenção — quebram a corrida.
 */
function computeIdle(
  blocks: readonly ClampedBlock[],
  fromDay: number,
  toDay: number,
): IdleSummary {
  const merged: Array<[number, number]> = [];
  for (const block of [...blocks].sort((a, b) => a.visibleStart - b.visibleStart)) {
    const last = merged[merged.length - 1];
    // `<= last[1] + 1`: dias adjacentes não deixam gap entre si.
    if (last && block.visibleStart <= last[1] + 1) {
      last[1] = Math.max(last[1], block.visibleEnd);
    } else {
      merged.push([block.visibleStart, block.visibleEnd]);
    }
  }

  let totalDays = 0;
  let longestRun = 0;
  let longestStart: number | null = null;
  let cursor = fromDay;

  const consider = (start: number, end: number): void => {
    const run = end - start + 1;
    if (run <= 0) return;
    totalDays += run;
    if (run > longestRun) {
      longestRun = run;
      longestStart = start;
    }
  };

  for (const [start, end] of merged) {
    consider(cursor, start - 1);
    cursor = Math.max(cursor, end + 1);
  }
  consider(cursor, toDay);

  return {
    totalDays,
    longestRun,
    longestFrom: longestStart === null ? null : fromEpochDay(longestStart),
    longestTo: longestStart === null ? null : fromEpochDay(longestStart + longestRun - 1),
    flagged: longestRun >= IDLE_THRESHOLD_DAYS,
  };
}

/** Até 6 marcas de escala — o alvo é caber em 375px sem sobrepor rótulos. */
function buildTicks(fromDay: number, days: number, max = 6): GridTick[] {
  if (days <= 0) return [];
  const count = Math.min(max, days);
  const step = Math.max(1, Math.floor(days / count));
  const ticks: GridTick[] = [];
  for (let offset = 0; offset < days; offset += step) {
    // A última marca cairia colada no fim da régua; sai fora para não sobrepor.
    if (days - offset < step / 2 && ticks.length > 0) break;
    const date = fromEpochDay(fromDay + offset);
    ticks.push({ date, label: shortDate(date), offsetPercent: (offset / days) * 100 });
  }
  return ticks;
}

/**
 * Transforma a resposta da API na grade renderizável.
 *
 * A janela é sempre a que o **backend** devolveu (`response.from`/`to`), não a
 * que a tela pediu: sem `from`/`to` o backend aplica o mês corrente em horário
 * de Brasília, e desenhar a régua a partir do palpite local desalinharia as
 * barras do cabeçalho.
 */
export function buildGrid(response: FleetCalendarResponse): FleetGrid {
  const fromDay = toEpochDay(response.from);
  const toDay = toEpochDay(response.to);
  const days = windowDays(response.from, response.to);

  if (days === 0) {
    return {
      from: response.from,
      to: response.to,
      timezone: response.timezone,
      days: 0,
      lanes: [],
      ticks: [],
      blockCount: 0,
      idleVehicleCount: 0,
      overlapVehicleCount: 0,
    };
  }

  let blockCount = 0;
  let idleVehicleCount = 0;
  let overlapVehicleCount = 0;

  const lanes = response.vehicles.map((vehicle): GridLane => {
    const clamped = (vehicle.blocks ?? [])
      .map((block) => clamp(block, fromDay, toDay))
      .filter((block): block is ClampedBlock => block !== null)
      .sort((a, b) => a.visibleStart - b.visibleStart || a.visibleEnd - b.visibleEnd);

    const laneIndexes = packIntoLanes(clamped);

    const blocks = clamped.map((block, index): GridBlock => {
      const startDay = toEpochDay(block.source.start);
      const endDay = toEpochDay(block.source.end);
      const visible = block.visibleEnd - block.visibleStart + 1;
      return {
        kind: normalizeKind(block.source.kind),
        sourceId: block.source.sourceId,
        status: block.source.status,
        start: block.source.start,
        end: block.source.end,
        label: block.source.label?.trim() ? block.source.label.trim() : '',
        offsetPercent: ((block.visibleStart - fromDay) / days) * 100,
        widthPercent: (visible / days) * 100,
        continuesBefore: startDay < fromDay,
        continuesAfter: endDay > toDay,
        lane: laneIndexes[index],
        visibleDays: visible,
        totalDays: endDay - startDay + 1,
      };
    });

    const laneCount = laneIndexes.length === 0 ? 1 : Math.max(...laneIndexes) + 1;
    const idle = computeIdle(clamped, fromDay, toDay);

    blockCount += blocks.length;
    if (idle.flagged) idleVehicleCount += 1;
    if (laneCount > 1) overlapVehicleCount += 1;

    return {
      vehicleId: vehicle.vehicleId,
      plate: vehicle.plate,
      label: vehicle.label,
      vehicleStatus: vehicle.vehicleStatus,
      blocks,
      laneCount,
      hasOverlap: laneCount > 1,
      idle,
    };
  });

  return {
    from: response.from,
    to: response.to,
    timezone: response.timezone,
    days,
    lanes,
    ticks: buildTicks(fromDay, days),
    blockCount,
    idleVehicleCount,
    overlapVehicleCount,
  };
}
