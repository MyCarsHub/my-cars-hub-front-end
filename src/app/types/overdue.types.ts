import { formatBRL } from './dashboard.types';

/**
 * Multa por devolução em atraso (backend V53).
 *
 * Duas superfícies compartilham estas formas:
 *  - `GET|PUT /v1/companies/current/overdue-settings` — a regra da empresa;
 *  - `GET /v1/rentals/{id}/overdue-preview` e `RentalResponseDto.overdueFee` —
 *    a conta de um aluguel específico.
 *
 * **Fuso**: `dueAt` e `returnedAt` chegam como data-e-hora LOCAL, sem offset
 * (`2026-07-22T23:00:00`). Nada aqui os converte — nem para `Date`, nem para
 * UTC. É a conversão que faz um aluguel que vence às 18h virar "atrasado" às
 * 21h do dia anterior. As funções de formatação abaixo trabalham por recorte de
 * string exatamente por isso.
 */
export interface OverdueSettings {
  /** Multiplicador em vigor, em basis-points: 15000 = 1,5x. */
  multiplierBps: number;
  /** Tolerância em horas contada a partir do fim do prazo. */
  graceHours: number;
  /** `false` quando a empresa nunca configurou — está usando o padrão. */
  customized: boolean;
  defaultMultiplierBps: number;
  defaultGraceHours: number;
  minMultiplierBps: number;
  maxMultiplierBps: number;
  minGraceHours: number;
  maxGraceHours: number;
}

/** Body do PUT — substituição integral, não há edição parcial. */
export interface OverdueSettingsUpdate {
  multiplierBps: number;
  graceHours: number;
}

/**
 * Resumo da multa. Mesma forma no preview (nada gravado, `chargeId` nulo) e no
 * aluguel já concluído (`chargeId` preenchido).
 */
export interface OverdueFeeSummary {
  /** Id da cobrança lançada; `null` no preview. */
  chargeId: string | null;
  /** `true` quando houve atraso cobrável. */
  overdue: boolean;
  overdueDays: number;
  /** Diária derivada do período, em centavos, JÁ arredondada. */
  dailyRate: number;
  multiplierBps: number;
  graceHours: number;
  /** Valor da multa em centavos. */
  amount: number;
  /** Prazo final considerado (fim do aluguel + 1 dia 00:00 + tolerância). */
  dueAt: string;
  /** Devolução efetiva considerada. */
  returnedAt: string;
}

/** Base dos basis-points do backend: 10000 = 1,0x. */
export const BPS_BASE = 10_000;

/**
 * `15000` → `'1,5x'`. Sem casas inúteis: `20000` → `'2x'`.
 *
 * Formata sobre as QUATRO casas dos basis-points, não sobre duas: o backend
 * aceita qualquer inteiro na faixa (`UpdateOverdueSettingsRequestDto`), então
 * `10525` é um multiplicador legítimo — e arredondá-lo para `'1,05x'` mostraria
 * ao operador um número diferente do que vai ser cobrado.
 */
export function multiplierLabel(bps: number): string {
  const text = (bps / BPS_BASE).toFixed(4).replace(/\.?0+$/, '');
  return `${text.replace('.', ',')}x`;
}

/**
 * Entrada do usuário em "x" (`'1,5'` ou `'1.5'`) → basis-points.
 * Devolve `null` quando não é um número — o chamador transforma em erro de
 * validação em vez de mandar `NaN` para o servidor.
 */
export function multiplierBpsFromInput(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const text = String(raw).trim().replace(',', '.');
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * BPS_BASE);
}

/** `15000` → `'1.5'`, o formato que um `<input type="number">` aceita. */
export function multiplierInputValue(bps: number): string {
  return String(bps / BPS_BASE);
}

/** `0` → `'sem tolerância'`; `1` → `'1 hora'`; `3` → `'3 horas'`. */
export function graceHoursLabel(hours: number): string {
  if (hours <= 0) return 'sem tolerância';
  return hours === 1 ? '1 hora' : `${hours} horas`;
}

/** `'2 diárias'` / `'1 diária'`. */
export function overdueDaysLabel(days: number): string {
  return days === 1 ? '1 diária' : `${days} diárias`;
}

/**
 * Data-e-hora local → `dd/MM/yyyy às HH:mm`, por recorte de string.
 *
 * NÃO usa `Date`: `new Date('2026-07-22T23:00:00')` seria interpretado no fuso
 * do navegador e poderia exibir outro dia. O backend já entrega o horário de
 * parede que o operador digitou.
 */
export function formatLocalDateTime(value: string | null | undefined): string {
  if (!value || value.length < 16) return '—';
  const date = `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  return `${date} às ${value.slice(11, 16)}`;
}

/** `'2026-07-22'` + `'23:00'` → `'2026-07-22T23:00:00'` (local, sem offset). */
export function toLocalDateTime(date: string, time: string): string {
  if (!date) return '';
  const hhmm = time && time.length >= 5 ? time.slice(0, 5) : '12:00';
  return `${date}T${hhmm}:00`;
}

/**
 * A conta por extenso — é ela que o motorista vai conferir, não o total.
 *
 * `diárias × valor da diária × multiplicador = total`, e fecha exatamente com
 * `amount` porque o backend arredonda a diária ANTES de multiplicar.
 */
export function overdueFeeFormula(summary: OverdueFeeSummary): string {
  return (
    `${overdueDaysLabel(summary.overdueDays)} × ${formatBRL(summary.dailyRate)}` +
    ` × ${multiplierLabel(summary.multiplierBps)} = ${formatBRL(summary.amount)}`
  );
}

/** Frase da regra em vigor, para quem só pode ler a configuração. */
export function overdueRuleLabel(multiplierBps: number, graceHours: number): string {
  return `${multiplierLabel(multiplierBps)} a diária, com ${graceHoursLabel(graceHours)}`;
}

/** Recorte do exemplo do degrau. Tudo em centavos, como o resto do módulo. */
export interface OverdueGraceExample {
  /** Fim contratual fictício do aluguel, `yyyy-MM-dd`. */
  endDate: string;
  /** Prazo final já com a tolerância — local, sem offset. */
  dueAt: string;
  /** Diária fictícia usada na conta, em centavos. */
  dailyRate: number;
  /** Diárias da PRIMEIRA cobrança possível. Nunca menos que 1. */
  firstChargeDays: number;
  /** Valor dessa primeira cobrança, em centavos. */
  firstChargeAmount: number;
}

const EXAMPLE_END_DATE = '2026-07-20';
const EXAMPLE_DAILY_RATE = 10_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * O DEGRAU da tolerância, em números — para a tela de configuração parar de
 * apresentar tolerância como pura leniência.
 *
 * A regra do backend (`OverdueFeeCalculator`) tem duas metades que a tela
 * precisa mostrar juntas:
 *
 *  - `dueAt = end_date + 1 dia, 00:00 + graceHours` decide **se** cobra;
 *  - `overdueDays = data da devolução − end_date` decide **quanto** — e a
 *    tolerância NÃO é descontada dessa subtração.
 *
 * Consequência: a primeira devolução cobrável é a que cai na data de `dueAt`,
 * ou seja `1 + floor(graceHours / 24)` diárias de uma vez. Subir a tolerância
 * de 0 para 72 horas não suaviza nada — adia a cobrança em três dias e faz a
 * primeira delas custar quatro diárias em vez de uma.
 *
 * A aritmética é feita em UTC de propósito: só interessa a diferença entre
 * instantes fictícios, e UTC não tem horário de verão para encurtar um dia.
 */
export function overdueGraceExample(
  multiplierBps: number,
  graceHours: number,
  dailyRate: number = EXAMPLE_DAILY_RATE,
  endDate: string = EXAMPLE_END_DATE,
): OverdueGraceExample {
  const [year, month, day] = endDate.split('-').map(Number);
  const dueMs = Date.UTC(year, month - 1, day) + DAY_MS + Math.max(0, graceHours) * HOUR_MS;
  const due = new Date(dueMs);

  // Dias de calendário entre `end_date` e a DATA do prazo — que é exatamente a
  // primeira data em que uma devolução já está atrasada.
  const dueDateMs = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const firstChargeDays = Math.round((dueDateMs - Date.UTC(year, month - 1, day)) / DAY_MS);

  return {
    endDate,
    dueAt: formatUtcAsLocalDateTime(due),
    dailyRate,
    firstChargeDays,
    // HALF_UP sobre inteiros positivos, igual ao backend: a diária já vem
    // arredondada e só depois é multiplicada.
    firstChargeAmount: Math.round((firstChargeDays * dailyRate * multiplierBps) / BPS_BASE),
  };
}

/** `Date` (lido em UTC) → `yyyy-MM-ddTHH:mm:ss`, o formato local do módulo. */
function formatUtcAsLocalDateTime(value: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  return `${date}T${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:00`;
}
