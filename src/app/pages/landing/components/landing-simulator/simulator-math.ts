/**
 * Fórmula do simulador de tempo da landing — pura, determinística, sem DOM.
 *
 * Regras (spec 2026-09-04-simulador-tempo-landing-design.md):
 * - Horas/carro/mês por fonte de perda (método "Planilha + WhatsApp" = 1,0):
 *   cobranças 1,4 · planilha 1,0 · multas 0,6 · CNH/IPVA/manutenção 0,7.
 * - Multiplicadores por método: planilha 1,0 · caderno 1,15 · de cabeça 1,3.
 * - Cada linha é arredondada para inteiro PRIMEIRO e o total exibido é a soma
 *   das linhas arredondadas — nunca exibimos soma inconsistente com as linhas.
 * - Com o MyCarsHub: max(1, round(carros × 0,25)), exibido como "~Nh".
 * - Equivalências: dias de trabalho = round(total / 8); o "por ano" converte
 *   total × 12 horas em meses de trabalho de 176h e devolve uma FAIXA TEXTUAL
 *   (nunca decimal cru).
 */

export type ControlMethod = 'planilha' | 'caderno' | 'cabeca';

export const METHOD_MULTIPLIER: Record<ControlMethod, number> = {
  planilha: 1.0,
  caderno: 1.15,
  cabeca: 1.3,
};

/** Horas por carro por mês de cada fonte de perda (método base). */
export const LOSS_RATES = {
  charges: 1.4,
  spreadsheet: 1.0,
  fines: 0.6,
  documents: 0.7,
} as const;

/** Um mês de trabalho tem 176h (22 dias úteis × 8h); um dia, 8h. */
const HOURS_PER_WORK_DAY = 8;
const HOURS_PER_WORK_MONTH = 176;

export interface SimulatorResult {
  /** Horas/mês por linha, já arredondadas — a soma delas É o total exibido. */
  lines: {
    charges: number;
    spreadsheet: number;
    fines: number;
    documents: number;
  };
  /** Soma das linhas arredondadas (h/mês no manual). */
  totalManual: number;
  /** Horas/mês com o MyCarsHub (mínimo 1). */
  withMyCarsHub: number;
  /** Equivalência: dias de trabalho por mês. */
  workDays: number;
  /** Faixa textual do acumulado no ano ("um mês e meio", "quase dois meses"…). */
  yearlyLabel: string;
}

/**
 * Converte o acumulado anual (total mensal × 12, em horas) numa faixa textual
 * de meses de trabalho de 176h. Faixas, não decimais: a copy fala como gente.
 */
export function yearlyLabel(totalManualPerMonth: number): string {
  const months = (totalManualPerMonth * 12) / HOURS_PER_WORK_MONTH;
  if (months < 0.5) return 'mais de uma semana';
  if (months < 0.85) return 'quase um mês';
  if (months < 1.25) return 'um mês inteiro';
  if (months < 1.85) return 'um mês e meio';
  if (months < 2.5) return 'quase dois meses';
  if (months < 3.5) return 'quase três meses';
  if (months < 4.5) return 'quase quatro meses';
  if (months < 5.5) return 'quase cinco meses';
  if (months < 6.5) return 'quase seis meses';
  return 'mais de meio ano';
}

export function simulate(cars: number, method: ControlMethod): SimulatorResult {
  const mult = METHOD_MULTIPLIER[method];
  const line = (rate: number): number => Math.round(cars * rate * mult);

  const lines = {
    charges: line(LOSS_RATES.charges),
    spreadsheet: line(LOSS_RATES.spreadsheet),
    fines: line(LOSS_RATES.fines),
    documents: line(LOSS_RATES.documents),
  };

  // Linha-primeiro: o total exibido é a soma das linhas já arredondadas.
  const totalManual =
    lines.charges + lines.spreadsheet + lines.fines + lines.documents;

  return {
    lines,
    totalManual,
    withMyCarsHub: Math.max(1, Math.round(cars * 0.25)),
    workDays: Math.round(totalManual / HOURS_PER_WORK_DAY),
    yearlyLabel: yearlyLabel(totalManual),
  };
}
