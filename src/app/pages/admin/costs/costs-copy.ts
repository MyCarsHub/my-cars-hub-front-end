import { HttpErrorResponse } from '@angular/common/http';

import type { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { formatBrl } from '../../../pipes/brl.pipe';
import {
  VENDOR_CATEGORY_LABEL,
  type PlatformCost,
  type PlatformCostKind,
  type PlatformCostSchedule,
  type PlatformVendor,
  type PlatformVendorCategory,
} from '../../../types/admin-finance.types';
import { todayInBusinessTz } from '../../../utils/business-clock';
import { monthName, monthTitle, shiftMonth } from '../../../utils/expenses-view';

/**
 * Textos e contas puras da página de Custos (Dinheiro › Custos). Mês `yyyy-MM`, data `yyyy-MM-dd`:
 * ambos são dias de parede de São Paulo, então são lidos como texto, nunca por `new Date` (que
 * leria a data no fuso do navegador).
 */

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Mês corrente em São Paulo, `yyyy-MM`. */
export function currentMonth(now: Date = new Date()): string {
  return todayInBusinessTz(now).slice(0, 7);
}

/** `2026-11` + 1 = `2026-12` (o mesmo cálculo do seletor de mês de Gastos). */
export const addMonths = shiftMonth;

/** `2026-11` -> `novembro de 2026` / `Novembro de 2026`. */
export { monthName, monthTitle };

/** `2026-11` -> `novembro`. */
export function monthOnly(month: string): string {
  return monthName(month).replace(/ de \d{4}$/, '');
}

/** `2026-11` -> `11/2026`. */
export function monthNumeric(month: string): string {
  const m = MONTH_RE.exec(month);
  return m ? `${m[2]}/${m[1]}` : month;
}

/** `2026-11-05` -> `05/11`. */
export function dayMonth(date: string | null): string {
  const m = date ? DATE_RE.exec(date) : null;
  return m ? `${m[3]}/${m[2]}` : '—';
}

/** Último dia do mês, `yyyy-MM-dd` (o limite do campo "Vence em"). */
export function lastDayOf(month: string): string {
  const m = MONTH_RE.exec(month);
  if (!m) return '';
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

export function vendorCategoryText(category: PlatformVendorCategory, label: string | null = null): string {
  return label || VENDOR_CATEGORY_LABEL[category] || category;
}

export function vendorOptionLabel(v: PlatformVendor): string {
  return `${v.name} · ${vendorCategoryText(v.category, v.categoryLabel)}`;
}

export const brl = (cents: number | null | undefined): string => formatBrl(cents ?? null);

export interface ChipView {
  readonly label: string;
  readonly tone: StatusChipTone;
}

// ---------------------------------------------------------------- custos fixos

/** Uma linha de "Custos fixos": a cadeia de preço de um serviço, mostrada pelo último custo fixo. */
export interface FixedRow {
  /** O último da cadeia: é nele que editar, mudar valor e encerrar agem. */
  readonly schedule: PlatformCostSchedule;
  readonly title: string;
  readonly category: string;
  /** O valor que vale no mês corrente (antes de uma mudança agendada, o do antecessor). */
  readonly amountCents: number;
  readonly amountText: string;
  /** "R$ 120,00 a partir de 12/2026" quando há mudança agendada. */
  readonly pendingText: string | null;
  readonly dayText: string;
  readonly periodText: string;
  readonly chip: ChipView;
  /** Roda no mês corrente: entra em "Fixos ativos". */
  readonly running: boolean;
  readonly ended: boolean;
  readonly startMonth: string;
}

/** Custos fixos, um por cadeia, na ordem do servidor (ativos primeiro). */
export function fixedRows(schedules: readonly PlatformCostSchedule[]): FixedRow[] {
  const byId = new Map(schedules.map((s) => [s.id, s]));
  const chainStart = (s: PlatformCostSchedule): string => {
    let cur = s;
    const seen = new Set<string>();
    while (cur.previousScheduleId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const prev = byId.get(cur.previousScheduleId);
      if (!prev) break;
      cur = prev;
    }
    return cur.startMonth;
  };
  return schedules
    .filter((s) => s.latest)
    .map((s) => {
      const prev = s.previousScheduleId ? byId.get(s.previousScheduleId) : undefined;
      // Mudança de valor agendada: o novo começa no futuro e o antecessor ainda roda hoje.
      const pending = s.status === 'SCHEDULED' && prev?.status === 'ACTIVE' ? prev : null;
      const amountCents = pending ? pending.amountCents : s.amountCents;
      const start = chainStart(s);
      const status = pending ? 'ACTIVE' : s.status;
      return {
        schedule: s,
        title: `${s.vendorName} · ${s.service}`,
        category: vendorCategoryText(s.vendorCategory),
        amountCents,
        amountText: brl(amountCents),
        pendingText: pending ? `${brl(s.amountCents)} a partir de ${monthNumeric(s.startMonth)}` : null,
        dayText: `dia ${s.billingDay}`,
        periodText: periodText(start, s.endMonth),
        chip: scheduleChip(status, s.startMonth, s.endMonth),
        running: status === 'ACTIVE',
        ended: status === 'ENDED',
        startMonth: start,
      };
    });
}

export function periodText(start: string, end: string | null): string {
  return end ? `de ${monthNumeric(start)} até ${monthNumeric(end)}` : `desde ${monthNumeric(start)}, sem fim`;
}

export function scheduleChip(
  status: PlatformCostSchedule['status'],
  startMonth: string,
  endMonth: string | null,
): ChipView {
  if (status === 'ENDED') return { label: 'Encerrado', tone: 'neutral' };
  if (status === 'SCHEDULED') return { label: `Começa em ${monthNumeric(startMonth)}`, tone: 'blue' };
  if (endMonth) return { label: `Termina em ${monthNumeric(endMonth)}`, tone: 'amber' };
  return { label: 'Ativo', tone: 'green' };
}

/** Quanto os fixos que rodam no mês corrente somam por mês. */
export function runningFixed(rows: readonly FixedRow[]): { count: number; cents: number } {
  const running = rows.filter((r) => r.running);
  return { count: running.length, cents: running.reduce((sum, r) => sum + r.amountCents, 0) };
}

// ---------------------------------------------------------------- lançamentos do mês

export const KIND_LABEL: Record<PlatformCostKind, string> = {
  FIXED: 'Fixo',
  ONE_OFF: 'Avulso',
  LEGACY: 'Lançado antes',
};

/** Uma linha de "Lançamentos do mês". */
export interface EntryRow {
  readonly cost: PlatformCost;
  readonly title: string;
  readonly kind: string;
  readonly fixed: boolean;
  readonly edited: boolean;
  readonly amountText: string;
  /** "fixo: R$ 140,00" quando a linha foi editada só neste mês. */
  readonly fixedText: string | null;
  readonly dueText: string;
  readonly note: string;
}

export function entryRows(rows: readonly PlatformCost[]): EntryRow[] {
  return rows.map((cost) => {
    const fixed = cost.kind === 'FIXED';
    const edited = fixed && cost.overridden;
    return {
      cost,
      title: cost.description ? `${cost.vendorName} · ${cost.description}` : cost.vendorName,
      kind: KIND_LABEL[cost.kind] ?? cost.kind,
      fixed,
      edited,
      amountText: brl(cost.amountCents),
      fixedText: edited && cost.scheduleAmountCents !== null ? `fixo: ${brl(cost.scheduleAmountCents)}` : null,
      dueText: dayMonth(cost.dueDate),
      note: cost.note || '—',
    };
  });
}

/** Quanto do mês veio dos fixos e quanto foi avulso (o legado conta como avulso). */
export function monthSplit(rows: readonly PlatformCost[]): { fixedCents: number; oneOffCents: number } {
  let fixedCents = 0;
  let oneOffCents = 0;
  for (const r of rows) {
    if (r.kind === 'FIXED') fixedCents += r.amountCents;
    else oneOffCents += r.amountCents;
  }
  return { fixedCents, oneOffCents };
}

// ---------------------------------------------------------------- erros

/** Mensagem de uma escrita recusada: o código do servidor diz o que fazer. */
export function costErrorMessage(err: unknown, fallback = 'Não foi possível salvar. Tente de novo.'): string {
  if (!(err instanceof HttpErrorResponse)) return fallback;
  const body = (err.error ?? null) as {
    message?: unknown;
    code?: unknown;
    fieldErrors?: Record<string, unknown> | null;
  } | null;
  const code = typeof body?.code === 'string' ? body.code : null;
  const message = typeof body?.message === 'string' && body.message ? body.message : null;
  if (err.status === 403) return 'Só o Dono da plataforma mexe nos custos.';
  if (code === 'VENDOR_INACTIVE') return 'Esse fornecedor está desativado. Ative-o em Fornecedores para lançar.';
  // O servidor diz QUAL mudança posterior já existe ("R$ 120,00 a partir de 12/2026"): a frase
  // dele vai inteira para a folha; o texto daqui só cobre um servidor que não mande mensagem.
  if (code === 'SCHEDULE_NOT_LATEST') {
    return message ?? 'Esse custo fixo mudou enquanto a tela estava aberta. A lista foi recarregada.';
  }
  if (code === 'VENDOR_HAS_RUNNING_FIXED_COSTS') {
    return 'Este fornecedor tem custo fixo rodando. Encerre os custos fixos dele antes de desativar.';
  }
  if (err.status === 404) return 'Este registro não existe mais. A lista foi recarregada.';
  // 409 (LEGACY_COST_OVERLAP nomeia fornecedor e mês; COST_ROW_CHANGED pede recarregar): a frase do
  // servidor é a explicação. 400: a mensagem do campo é a mais precisa.
  const field = body?.fieldErrors ? Object.values(body.fieldErrors).find((v) => typeof v === 'string') : null;
  const fieldMessage = typeof field === 'string' && field ? field : null;
  if (err.status === 409) return message ?? fieldMessage ?? fallback;
  if (err.status === 400) return fieldMessage ?? message ?? fallback;
  return fallback;
}

/**
 * A tela ficou velha (o registro sumiu, o custo fixo ganhou mudança posterior ou o lançamento saiu
 * do fixo antes do "Voltar ao fixo"): a página recarrega as listas.
 */
export function isStale(err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse)) return false;
  const code = (err.error as { code?: unknown } | null)?.code;
  return err.status === 404 || code === 'SCHEDULE_NOT_LATEST' || code === 'COST_ROW_CHANGED';
}

/** O último custo fixo da cadeia de `scheduleId` (é nele que "mudar daqui para frente" age). */
export function latestOfChain(
  schedules: readonly PlatformCostSchedule[],
  scheduleId: string,
): PlatformCostSchedule | null {
  const next = new Map<string, PlatformCostSchedule>();
  for (const s of schedules) if (s.previousScheduleId) next.set(s.previousScheduleId, s);
  let cur = schedules.find((s) => s.id === scheduleId) ?? null;
  const seen = new Set<string>();
  while (cur && !cur.latest && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = next.get(cur.id) ?? null;
  }
  return cur?.latest ? cur : null;
}
