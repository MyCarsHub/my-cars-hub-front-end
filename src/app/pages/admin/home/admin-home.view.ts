import type { KpiDelta } from '../../../components/kpi-card/kpi-card';
import { formatKpiNumber } from '../../../components/kpi-card/kpi-card';
import type { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import type { HeatmapRow } from '../../../components/charts/heatmap/heatmap';
import { buildCsv, type CsvColumn } from '../../../components/lists/data-list/data-list-csv';
import type {
  AdminHome,
  AdminHomeGranularity,
  CompanyHealth,
  CompanyHealthReason,
  HeatCell,
  HomeKpi,
} from '../../../types/admin-home.types';
import { companyRoleLabel } from '../../../utils/role-labels';

/**
 * Regras puras da Visão geral v2: rótulos, variação, texto do "sem dado", mapa de calor e CSV.
 * Tudo aqui recebe o "agora" por parâmetro quando precisa dele, para o spec fixar o relógio.
 */

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** `2026-11-05` -> `05/11/2026`; nulo continua nulo. */
export function dayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : null;
}

/** `2026-11-05` -> `05/11`. */
export function shortDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

/** `2026-11` -> `nov` (ou `nov/26` quando a janela cruza o ano). */
export function monthShort(month: string, withYear = false): string {
  const [y, m] = month.split('-').map(Number);
  const name = MONTHS_PT[(m || 1) - 1] ?? month;
  return withYear ? `${name}/${String(y).slice(-2)}` : name;
}

/** `2026-11` -> `novembro`. */
export function monthLong(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** True quando os rótulos de mês precisam do ano para não confundir janeiro de um ano com o do outro. */
export function spansYears(dates: readonly string[]): boolean {
  return new Set(dates.map((d) => d.slice(0, 4))).size > 1;
}

/** Rótulo de um balde: dia e semana por `dd/MM` (início do balde), mês pelo nome. */
export function bucketLabels(starts: readonly string[], granularity: AdminHomeGranularity): string[] {
  if (granularity === 'MONTH') {
    const withYear = spansYears(starts);
    return starts.map((s) => monthShort(s.slice(0, 7), withYear));
  }
  return starts.map(shortDay);
}

/** Rótulos de meses `YYYY-MM`. */
export function monthLabels(months: readonly string[]): string[] {
  const withYear = spansYears(months);
  return months.map((m) => monthShort(m, withYear));
}

/**
 * Variação de um KPI de dinheiro contra o anterior, em %. Sem anterior, ou anterior zero (não há
 * base para porcentagem), não há chip: a tela não inventa "↗ 100%".
 */
export function percentDelta(kpi: HomeKpi | null | undefined, caption: string, upIsBad = false): KpiDelta | null {
  if (!kpi || kpi.value === null || kpi.previous === null || kpi.previous === 0) return null;
  const change = (kpi.value - kpi.previous) / Math.abs(kpi.previous);
  const pct = Math.round(change * 100);
  const arrow = pct > 0 ? '↗' : pct < 0 ? '↘' : '→';
  const up = pct > 0;
  const tone: KpiDelta['tone'] = pct === 0 ? 'neutral' : up !== upIsBad ? 'good' : 'bad';
  return { chip: `${arrow} ${Math.abs(pct)}%`, text: caption, tone };
}

/** Variação em número absoluto (assinaturas convertidas, usuários novos...). */
export function countDelta(n: number | null | undefined, caption: string): KpiDelta | null {
  if (n === null || n === undefined) return null;
  return { chip: n > 0 ? `↗ ${n}` : `${n}`, text: caption, tone: n > 0 ? 'good' : 'neutral' };
}

/**
 * O que um KPI nulo diz no lugar do número. Nunca "0": cada motivo vira uma frase, e o que não tem
 * motivo conhecido diz desde quando o dado existe.
 */
export function nullText(kpi: HomeKpi | null | undefined, currentMonth: string | null): string {
  if (!kpi) return 'sem dado';
  const month = currentMonth ? monthLong(currentMonth) : 'no mês';
  switch (kpi.nullReason) {
    case 'NO_COSTS':
      return `nenhum custo lançado em ${month}`;
    case 'NO_ACQUISITION_COST':
      return 'informe o gasto com aquisição';
    case 'NO_NEW_PAYING':
      return `nenhum cliente novo pagou em ${month}`;
    case 'NO_PAYING':
      return 'nenhum cliente pagante';
    case 'ZERO_CHURN':
      return 'sem cancelamentos: o LTV não tem divisor';
    case 'NO_DATA_YET': {
      const from = dayLabel(kpi.availableFrom);
      return from ? `calcula a partir de ${from}` : 'histórico ainda curto';
    }
    case 'NO_SNAPSHOT': {
      const since = dayLabel(kpi.since);
      return since ? `sem foto antes de ${since}` : 'sem foto diária';
    }
    default: {
      const since = dayLabel(kpi.since);
      return since ? `sem dado desde ${since}` : 'sem dado';
    }
  }
}

/** "agora", "há 4 min", "há 2 h", "ontem", "há 4 dias" ou a data. */
export function relativeTime(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  // O feed manda LocalDateTime em UTC, às vezes sem o `Z`.
  const at = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(at)) return null;
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(at));
}

// ------------------------------------------------------------------ mapa de calor

/** Segunda primeiro, como o desenho; `dow` do backend é 0 = domingo. */
const WEEK: readonly { dow: number; label: string }[] = [
  { dow: 1, label: 'Seg' },
  { dow: 2, label: 'Ter' },
  { dow: 3, label: 'Qua' },
  { dow: 4, label: 'Qui' },
  { dow: 5, label: 'Sex' },
  { dow: 6, label: 'Sáb' },
  { dow: 0, label: 'Dom' },
];

/** Faixas de 2 horas: `0h-2h` ... `22h-24h`. */
export const HEAT_COLUMNS: readonly string[] = Array.from({ length: 12 }, (_, i) => `${i * 2}h-${i * 2 + 2}h`);

/**
 * Pure: as células esparsas (só as não zero) viram 7 linhas x 12 faixas de 2 h. Célula ausente é
 * zero MEDIDO (o backend só manda as não zero de uma janela que ele mediu inteira).
 */
export function heatRows(cells: readonly HeatCell[]): HeatmapRow[] {
  const grid = new Map<number, number[]>();
  for (const d of WEEK) grid.set(d.dow, Array.from({ length: 12 }, () => 0));
  for (const c of cells) {
    const row = grid.get(c.dow);
    if (!row || c.hour < 0 || c.hour > 23) continue;
    row[Math.floor(c.hour / 2)] += c.count;
  }
  return WEEK.map((d) => ({ key: String(d.dow), label: d.label, values: grid.get(d.dow) ?? [] }));
}

// ------------------------------------------------------------------ papéis, saúde, movimentações

export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Sem papel';
  if (role === 'PLATFORM_ADMIN' || role === 'ADMIN') return 'Admin';
  if (role === 'SYSTEM') return 'Sistema';
  return companyRoleLabel(role);
}

export function roleTone(role: string | null | undefined): StatusChipTone {
  switch (role) {
    case 'OWNER':
      return 'orange';
    case 'MANAGER':
      return 'blue';
    case 'DRIVER':
      return 'green';
    default:
      return 'neutral';
  }
}

export const HEALTH_LABEL: Record<CompanyHealth, string> = {
  HEALTHY: 'Saudável',
  ATTENTION: 'Atenção',
  AT_RISK: 'Em risco',
};

export const HEALTH_TONE: Record<CompanyHealth, StatusChipTone> = {
  HEALTHY: 'green',
  ATTENTION: 'amber',
  AT_RISK: 'red',
};

/** A definição de cada saúde, dita junto do chip (<D-DEFS>). */
export const HEALTH_REASON: Record<CompanyHealthReason, string> = {
  OK: 'paga e acessou nos últimos 7 dias',
  TRIAL: 'em teste grátis',
  ACCESS_7_30D: 'último acesso entre 7 e 30 dias',
  FREE_PLAN: 'ativa num plano grátis',
  PAST_DUE: 'assinatura atrasada',
  NO_ACCESS_30D: 'sem acesso há mais de 30 dias',
  NEVER_ACCESSED: 'nunca acessou',
  NOT_PAYING: 'não paga e não está em teste',
};

const ACTION_LABEL: Record<string, string> = {
  USER_SIGNED_UP: 'Criou a conta',
  COMPANY_CREATED: 'Criou a empresa',
  SUBSCRIPTION_STARTED: 'Começou uma assinatura',
  SUBSCRIPTION_CHANGED: 'Mudou a assinatura',
  PLATFORM_PAYMENT_RECEIVED: 'Pagamento da assinatura confirmado',
  RENTAL_CREATED: 'Criou um aluguel',
  RENTAL_CHARGE_PAID: 'Cobrança de aluguel paga',
  VEHICLE_CREATED: 'Cadastrou um veículo',
  DRIVER_CREATED: 'Cadastrou um motorista',
  INVITE_ACCEPTED: 'Aceitou um convite',
  FINE_CREATED: 'Registrou uma multa',
};

/** Ação do feed em português; desconhecida vira a própria sigla legível, nunca some. */
export function actionLabel(action: string | null | undefined): string {
  if (!action) return '—';
  const known = ACTION_LABEL[action];
  if (known) return known;
  const words = action.toLowerCase().split('_').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const ORIGIN_LABEL: Record<string, string> = {
  APP: 'Painel',
  ADMIN: 'Admin',
  WEBHOOK: 'Webhook',
  JOB: 'Rotina',
  UNKNOWN: 'Desconhecida',
};

export const RESULT_LABEL: Record<string, string> = { SUCCESS: 'Ok', FAILED: 'Falha', REFUSED: 'Recusada' };

export function resultTone(result: string): StatusChipTone {
  return result === 'SUCCESS' ? 'green' : result === 'FAILED' ? 'red' : 'amber';
}

// ------------------------------------------------------------------ cores de dado

/**
 * Cor estável por fornecedor (a ordem da lista de fornecedores). Nunca o laranja da marca: cor de
 * dado não pode parecer botão.
 */
export const VENDOR_COLORS: readonly string[] = [
  '#8b5cf6',
  '#ec4899',
  '#3b82f6',
  '#f59e0b',
  '#14b8a6',
  '#94a3b8',
  '#64748b',
  '#a3e635',
  '#f472b6',
  '#38bdf8',
];

export function vendorColor(index: number): string {
  return VENDOR_COLORS[((index % VENDOR_COLORS.length) + VENDOR_COLORS.length) % VENDOR_COLORS.length];
}

// ------------------------------------------------------------------ CSV

interface CsvKpiRow {
  readonly name: string;
  readonly kpi: HomeKpi;
}

function kpiCsvValue(kpi: HomeKpi, v: number | null): string | number | null {
  if (v === null) return null;
  if (kpi.unit === 'CENTS') return v;
  if (kpi.unit === 'RATIO') return formatKpiNumber('ratio', v);
  return v;
}

/**
 * O que está na tela, num CSV só: indicadores, saúde, séries mensais e o cruzamento por empresa.
 * Seções separadas por uma linha em branco; o BOM fica só no começo do arquivo.
 */
export function buildHomeCsv<T>(
  home: AdminHome,
  companies: { columns: readonly CsvColumn<T>[]; rows: readonly T[] } | null,
): string {
  const k = home.kpis;
  const h = home.health;
  const kpiRows: CsvKpiRow[] = [
    { name: 'MRR real', kpi: k.mrrReal },
    { name: 'Lucro do mês', kpi: k.profitMonth },
    { name: 'MRR estimado', kpi: k.mrrEstimated },
    { name: 'ARR', kpi: k.arr },
    { name: 'Custos do mês', kpi: k.costsMonth },
    { name: 'Assinaturas ativas', kpi: k.activeSubscriptions },
    { name: 'Empresas', kpi: k.companies },
    { name: 'Usuários', kpi: k.users },
    { name: 'Veículos', kpi: k.vehicles },
    { name: 'Valor gerenciado esperado no mês', kpi: k.managedExpected },
    { name: 'Valor gerenciado recebido no mês', kpi: k.managedReceived },
    { name: 'Churn mensal', kpi: h.churnMonthly },
    { name: 'LTV', kpi: h.ltv },
    { name: 'CAC', kpi: h.cac },
    { name: 'Retenção em 90 dias', kpi: h.retention90d },
    { name: 'Receita por cliente', kpi: h.arpa },
    { name: 'Margem', kpi: h.margin },
  ];
  const kpiCols: CsvColumn<CsvKpiRow>[] = [
    { key: 'name', header: 'Indicador', value: (r) => r.name },
    { key: 'value', header: 'Valor', value: (r) => (r.kpi.unit === 'CENTS' ? null : kpiCsvValue(r.kpi, r.kpi.value)) },
    { key: 'valueBrl', header: 'Valor (R$)', kind: 'money-cents', value: (r) => (r.kpi.unit === 'CENTS' ? r.kpi.value : null) },
    { key: 'previous', header: 'Anterior', value: (r) => (r.kpi.unit === 'CENTS' ? null : kpiCsvValue(r.kpi, r.kpi.previous)) },
    { key: 'previousBrl', header: 'Anterior (R$)', kind: 'money-cents', value: (r) => (r.kpi.unit === 'CENTS' ? r.kpi.previous : null) },
    { key: 'asOf', header: 'Anterior em', value: (r) => dayLabel(r.kpi.previousAsOf) },
    { key: 'why', header: 'Sem dado porque', value: (r) => (r.kpi.value === null ? nullText(r.kpi, home.meta.currentMonth) : null) },
    { key: 'definition', header: 'Definição', value: (r) => r.kpi.definition },
  ];

  const months = home.profitByMonth;
  const monthCols: CsvColumn<(typeof months)[number]>[] = [
    { key: 'month', header: 'Mês', value: (m) => m.month },
    { key: 'mrr', header: 'MRR real (R$)', kind: 'money-cents', value: (m) => m.mrrRealCents },
    { key: 'costs', header: 'Custos (R$)', kind: 'money-cents', value: (m) => m.costsCents },
    { key: 'profit', header: 'Lucro (R$)', kind: 'money-cents', value: (m) => m.profitCents },
  ];

  const mrr = home.mrrSeries.points;
  const mrrCols: CsvColumn<(typeof mrr)[number]>[] = [
    { key: 'start', header: 'Início', value: (p) => p.start },
    { key: 'end', header: 'Fim', value: (p) => p.end },
    { key: 'real', header: 'MRR real (R$)', kind: 'money-cents', value: (p) => p.realCents },
    { key: 'est', header: 'MRR estimado (R$)', kind: 'money-cents', value: (p) => p.estimatedCents },
    { key: 'subs', header: 'Assinaturas ativas', kind: 'integer', value: (p) => p.activeSubscriptions },
  ];

  const managed = home.managedSeries.points;
  const managedCols: CsvColumn<(typeof managed)[number]>[] = [
    { key: 'start', header: 'Início', value: (p) => p.start },
    { key: 'end', header: 'Fim', value: (p) => p.end },
    { key: 'expected', header: 'Gerenciado esperado (R$)', kind: 'money-cents', value: (p) => p.expectedCents },
    { key: 'received', header: 'Gerenciado recebido (R$)', kind: 'money-cents', value: (p) => p.receivedCents },
  ];

  const header = `Visão geral MyCarsHub;${dayLabel(home.meta.from)} a ${dayLabel(home.meta.to)};${
    home.meta.scope === 'all' ? 'Com contas internas' : 'Só clientes'
  }\r\n`;
  const sections = [
    buildCsv(kpiCols, kpiRows),
    buildCsv(mrrCols, mrr),
    buildCsv(monthCols, months),
    buildCsv(managedCols, managed),
    companies ? buildCsv(companies.columns, companies.rows) : null,
  ].filter((s): s is string => s !== null);
  const strip = (s: string) => s.replace(/^﻿/, '');
  return '﻿' + header + '\r\n' + sections.map(strip).join('\r\n');
}
