import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormGroup } from '@angular/forms';
import { SERVER_ERROR_KEY } from '../../services/validation-messages';
import {
  CreateRentalRequest,
  RentalChargePreviewDto,
  RentalPreflightItem,
  RentalPreflightLimits,
  RentalPreflightRange,
} from '../../types/rental.types';
import { formatPtBrMoney, formatPtBrNumber } from '../../utils/ptbr-number';

/**
 * FIX-0754 — a ponte entre o preflight do backend (FIX-0752) e o formulário.
 *
 * A REGRA mora só no backend: nada aqui decide se um valor é aceito. Este arquivo só
 * (1) diz em qual campo da tela cada problema cai, (2) lê o mesmo corpo vindo do 400 de
 * create/edit e (3) formata os números que o backend mandou em `limits`.
 */

/** Campo do corpo da API -> controle do formulário que o exibe inline. */
const CONTROL_BY_FIELD: Readonly<Record<string, string>> = {
  vehicleId: 'vehicleId',
  driverId: 'driverId',
  startDate: 'startDate',
  endDate: 'endDate',
  billingFrequency: 'billingFrequency',
  periodRate: 'periodRateReais',
  caucaoAmount: 'caucaoReais',
  initialKm: 'initialKm',
  pickupDate: 'pickupDate',
  firstPaymentDate: 'firstPaymentDate',
  // O juros em R$/dia saiu da tela: tudo o que o backend disser sobre ele cai no %.
  dailyInterestAmount: 'lateInterestPercent',
  lateInterestPercentPerMonth: 'lateInterestPercent',
  lateFineType: 'lateFineType',
  lateFineValue: 'lateFineValueInput',
  franchiseKm: 'franchiseKm',
  returnFuelPolicy: 'returnFuelPolicy',
};

/**
 * Controles que existem na tela mas NÃO têm onde mostrar uma mensagem inline
 * (toggles, textarea sem `app-form-field`): o problema vai ao resumo do topo.
 */
const INLINE_CONTROLS: ReadonlySet<string> = new Set(Object.values(CONTROL_BY_FIELD));

/** Códigos de integração: o atalho leva a Configurações > Integrações. */
const INTEGRATION_CODES: ReadonlySet<string> = new Set([
  'AUTOMATIC_CHARGE_NO_INTEGRATION',
  'ASAAS_KEY_REVOKED',
  'ASAAS_WEBHOOK_NOT_REGISTERED',
  'ASAAS_DAILY_QUOTA_INSUFFICIENT',
  'ASAAS_LIMITS_UNAVAILABLE',
]);

/**
 * Obrigatório vazio: o formulário já acusa pelos próprios validadores (e o submit marca
 * tudo como tocado). Mostrar também o do preflight faria a tela nascer cheia de vermelho.
 * Só vale para os campos que o formulário VALIDA localmente (lista abaixo); obrigatório
 * vazio de qualquer outro campo é um problema real e entra na lista.
 */
const REQUIRED_CODE = 'REQUIRED_FIELD';

const LOCALLY_REQUIRED_FIELDS: ReadonlySet<string> = new Set([
  'vehicleId',
  'driverId',
  'startDate',
  'endDate',
  'billingFrequency',
  'periodRate',
  'initialKm',
  'pickupDate',
  'firstPaymentDate',
  'lateFineType',
  'lateFineValue',
]);

/** Mensagem + valor aceito (`acceptedValue`) quando a mensagem ainda não o menciona. */
export function messageWithAccepted(item: RentalPreflightItem): string {
  const accepted = item.acceptedValue?.trim();
  return accepted && !item.message.includes(accepted)
    ? `${item.message} Aceito: ${accepted}`
    : item.message;
}

export type PreflightLink =
  | { kind: 'driver'; label: string; commands: string[] }
  | { kind: 'integrations'; label: string; commands: string[] };

export interface PreflightSummaryItem {
  item: RentalPreflightItem;
  /** Mensagem do backend + o valor aceito quando a mensagem não o traz. */
  text: string;
  link: PreflightLink | null;
}

/** Controle da tela que exibe o problema inline, ou `null` (vai ao resumo). */
export function controlFor(item: RentalPreflightItem): string | null {
  if (!item.field) return null;
  const control = CONTROL_BY_FIELD[item.field];
  return control && INLINE_CONTROLS.has(control) ? control : null;
}

/** Só os que bloqueiam e o usuário precisa agir (obrigatório vazio já é do formulário). */
export function actionableIssues(
  issues: readonly RentalPreflightItem[],
  includeLocalRequired = false,
): RentalPreflightItem[] {
  return issues.filter(
    (i) =>
      i.severity !== 'WARNING' &&
      (includeLocalRequired ||
        i.code !== REQUIRED_CODE ||
        !(i.field !== null && LOCALLY_REQUIRED_FIELDS.has(i.field))),
  );
}

/** Mensagem por controle (a primeira de cada campo). */
export function messagesByControl(issues: readonly RentalPreflightItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of issues) {
    const control = controlFor(item);
    if (control && !(control in out)) out[control] = messageWithAccepted(item);
  }
  return out;
}

/** Atalho do resumo: cadastro do motorista (`driver.*`) ou Integrações. */
export function linkFor(item: RentalPreflightItem, driverId: string | null): PreflightLink | null {
  if (INTEGRATION_CODES.has(item.code)) {
    return { kind: 'integrations', label: 'Abrir Configurações > Integrações', commands: ['/configuracoes/integracoes'] };
  }
  const isDriver = (item.field?.startsWith('driver.') ?? false) || item.code.startsWith('DRIVER_');
  if (isDriver && item.code !== 'DRIVER_NOT_FOUND' && driverId) {
    return { kind: 'driver', label: 'Abrir o cadastro do motorista', commands: ['/motoristas', driverId, 'editar'] };
  }
  return null;
}

/** Problemas bloqueantes que não têm campo na tela, com o atalho de cada um. */
export function summaryItems(
  issues: readonly RentalPreflightItem[],
  driverId: string | null,
  includeLocalRequired = false,
): PreflightSummaryItem[] {
  return actionableIssues(issues, includeLocalRequired)
    .filter((i) => controlFor(i) === null)
    .map((item) => ({ item, text: messageWithAccepted(item), link: linkFor(item, driverId) }));
}

/**
 * Marca cada controle com a mensagem do servidor e retira a marca dos que o último
 * preflight tinha apontado e agora estão limpos.
 *
 * Usa `setErrors` e NÃO `updateValueAndValidity`: o preflight roda a cada mudança do
 * formulário, e revalidar emitiria `valueChanges` de novo — um laço. Mudar o valor do
 * próprio campo já reexecuta os validadores e derruba a marca sozinho.
 *
 * Devolve o conjunto de controles marcados agora, para a chamada seguinte.
 */
export function syncServerMarks(
  form: FormGroup,
  messages: Readonly<Record<string, string>>,
  previous: ReadonlySet<string>,
): Set<string> {
  const marked = new Set<string>();
  for (const [name, message] of Object.entries(messages)) {
    const control = form.get(name);
    if (!control) continue;
    control.setErrors({ ...(control.errors ?? {}), [SERVER_ERROR_KEY]: { message } });
    control.markAsTouched();
    marked.add(name);
  }
  for (const name of previous) {
    if (marked.has(name)) continue;
    clearMark(form.get(name));
  }
  return marked;
}

function clearMark(control: AbstractControl | null): void {
  if (!control?.errors || !(SERVER_ERROR_KEY in control.errors)) return;
  const rest = Object.fromEntries(Object.entries(control.errors).filter(([k]) => k !== SERVER_ERROR_KEY));
  control.setErrors(Object.keys(rest).length > 0 ? rest : null);
}

/** Lista de problemas e limites do 400 de create/edit (o MESMO corpo do preflight). */
export function readPreflightError(
  error: unknown,
): { issues: RentalPreflightItem[]; limits: RentalPreflightLimits | null } | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) return null;
  const body: unknown = error.error;
  if (typeof body !== 'object' || body === null) return null;
  const record = body as { issues?: unknown; limits?: unknown };
  if (!Array.isArray(record.issues) || record.issues.length === 0) return null;
  const issues = (record.issues as Partial<RentalPreflightItem>[])
    .filter((i) => typeof i?.code === 'string' && typeof i?.message === 'string')
    .map((i) => ({
      field: typeof i.field === 'string' ? i.field : null,
      code: i.code as string,
      message: i.message as string,
      acceptedValue: typeof i.acceptedValue === 'string' ? i.acceptedValue : null,
      severity: i.severity === 'WARNING' ? ('WARNING' as const) : ('BLOCKING' as const),
    }));
  return issues.length > 0
    ? { issues, limits: (record.limits as RentalPreflightLimits | null | undefined) ?? null }
    : null;
}

/** O 400 de "aluguel legado sem % ao mês" (contrato novo exige defini-lo antes). */
export const LATE_INTEREST_REQUIRED_CODE = 'LATE_INTEREST_PERCENT_REQUIRED';

export function isLateInterestRequired(error: unknown): boolean {
  return hasRefusalCode(error, LATE_INTEREST_REQUIRED_CODE);
}

/**
 * O 400 de "campo essencial vazio" na geração do contrato do aluguel (CPF do motorista,
 * placa, valores, datas…). A `message` do servidor lista o que falta e onde preencher.
 */
export const CONTRACT_REQUIRED_FIELD_MISSING_CODE = 'CONTRACT_REQUIRED_FIELD_MISSING';

export function isContractRequiredFieldMissing(error: unknown): boolean {
  return hasRefusalCode(error, CONTRACT_REQUIRED_FIELD_MISSING_CODE);
}

/** Campos essenciais que se corrigem na edição do aluguel (os outros: cadastros). */
const RENTAL_EDIT_FIELDS = new Set(['periodRate', 'totalAmount', 'startDate', 'endDate', 'firstPaymentDate']);

/** O 400 de campo essencial aponta um campo da edição do aluguel? (`field` do corpo) */
export function isRequiredFieldFixedInRental(error: unknown): boolean {
  if (!isContractRequiredFieldMissing(error)) return false;
  const body = refusalBody(error);
  return typeof body?.field === 'string' && RENTAL_EDIT_FIELDS.has(body.field);
}

function refusalBody(error: unknown): { code?: unknown; field?: unknown; issues?: { code?: unknown }[] } | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  let body: unknown = error.error;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return typeof body === 'object' && body !== null
    ? (body as { code?: unknown; field?: unknown; issues?: { code?: unknown }[] })
    : null;
}

function hasRefusalCode(error: unknown, code: string): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) return false;
  // Download de contrato vem como Blob/texto: `refusalBody` faz o parse do corpo de erro.
  const record = refusalBody(error);
  if (!record) return false;
  return (
    record.code === code ||
    (Array.isArray(record.issues) && record.issues.some((i) => i?.code === code))
  );
}

// ---------------------------------------------------------------------------
// Formatação dos números que o backend mandou
// ---------------------------------------------------------------------------

/** `2` -> `2%`, `0.5` -> `0,5%`, `1.25` -> `1,25%` (sem zeros à direita). */
export function formatPercent(value: number): string {
  const scaled = Math.round(value * 100);
  return `${formatPtBrNumber(scaled, 2, { trailingZeros: false })}%`;
}

function formatRange(range: RentalPreflightRange): string {
  const min = range.min ?? 0;
  return range.max === null || range.max === undefined
    ? `a partir de ${formatPercent(min)}`
    : `de ${formatPercent(min)} a ${formatPercent(range.max)}`;
}

export function formatBrl(cents: number): string {
  return `R$ ${formatPtBrMoney(cents)}`;
}

/** Ajuda dos juros: a faixa de `limits` + a equivalência aproximada em R$/dia. */
export function interestHelp(
  limits: RentalPreflightLimits | null,
  periodCents: number | null,
  percentHundredths: number | null,
): string {
  const parts: string[] = [];
  const range = limits?.interestPercentPerMonth;
  parts.push(
    range
      ? `Faixa aceita: ${formatRange(range)} ao mês. Deixe vazio ou 0 para não cobrar.`
      : 'Percentual ao mês (ex.: 1,50). Deixe vazio ou 0 para não cobrar.',
  );
  if (periodCents !== null && periodCents > 0 && percentHundredths !== null && percentHundredths > 0) {
    // valor do período x % / 30 = quanto cada dia de atraso custa, aproximadamente.
    const perDay = Math.round((periodCents * percentHundredths) / 300_000);
    parts.push(`Equivale a cerca de ${formatBrl(perDay)} por dia de atraso sobre ${formatBrl(periodCents)}.`);
  }
  return parts.join(' ');
}

/** Ajuda da multa, que muda com o tipo: faixa no %, teto por cobrança no R$. */
export function fineHelp(type: 'PERCENT' | 'FIXED', limits: RentalPreflightLimits | null): string {
  if (type === 'PERCENT') {
    const range = limits?.finePercent;
    return range
      ? `Faixa aceita: ${formatRange(range)} do valor da cobrança.`
      : 'Informe a percentagem (ex.: 2 = 2%).';
  }
  const max = limits?.fixedFineMaxCents;
  // `fixedFineMaxCents` = menor cobrança menos 1 centavo; a ajuda fala da cobrança.
  return typeof max === 'number'
    ? `Menor que ${formatBrl(max + 1)} (valor de cada cobrança).`
    : 'Informe o valor em reais (ex.: 150,00).';
}

// ---------------------------------------------------------------------------
// Prévia de cada cobrança
// ---------------------------------------------------------------------------

export interface ChargeScheduleRow {
  key: string;
  title: string;
  due: string;
  /** Vencimento em ISO (AAAA-MM-DD): é por ele que se ordena, não pela ordem da lista. */
  dueIso: string;
  amount: string;
  /** Nulo na caução, que não carrega encargos. */
  fine: string | null;
  interest: string | null;
  destination: string;
}

function toBrDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

/**
 * Cada cobrança como irá ao Asaas: valor e vencimento vêm da prévia do backend; multa e
 * juros são os do corpo enviado (o backend os repassa sem recalcular).
 */
export function buildChargeSchedule(
  preview: RentalChargePreviewDto,
  payload: Pick<CreateRentalRequest, 'lateFineType' | 'lateFineValue' | 'lateInterestPercentPerMonth'>,
): ChargeScheduleRow[] {
  const fine =
    payload.lateFineType === 'FIXED'
      ? `Multa ${formatBrl(payload.lateFineValue ?? 0)}`
      : `Multa ${formatPercent((payload.lateFineValue ?? 0) / 100)}`;
  const pct = payload.lateInterestPercentPerMonth ?? 0;
  const interest = pct > 0 ? `Juros ${formatPercent(pct)} ao mês` : 'Sem juros';
  return preview.charges.map((c, i) => {
    const isPeriod = c.kind === 'RENTAL_PERIOD';
    return {
      key: `${c.kind}-${c.index}-${i}`,
      title: isPeriod ? `Cobrança ${c.index + 1}` : 'Caução',
      due: toBrDay(c.dueDate),
      dueIso: c.dueDate,
      amount: formatBrl(c.amountCents),
      fine: isPeriod ? fine : null,
      interest: isPeriod ? interest : null,
      destination: c.destination === 'ASAAS' ? 'Vai ao Asaas' : 'Fica só registrada aqui',
    };
  });
}

// ---------------------------------------------------------------------------
// Resumo curto da prévia (FIX-0763)
// ---------------------------------------------------------------------------

export interface ChargeScheduleSummary {
  /** Total de cobranças da lista completa, caução incluída. */
  total: number;
  /** A lista tem algo além do que o resumo já diz (mais de uma cobrança). */
  hasMore: boolean;
  /** Frase de quantidade e valor das cobranças do período. */
  headline: string;
  /** Primeira e última data de vencimento do período. */
  dates: string;
  /** Multa e juros, uma vez só: são iguais para todas as cobranças. */
  charges: string | null;
  /** Caução, quando existe, em uma linha. */
  deposit: string | null;
  /** Uma linha por divergência entre as cobranças do período. Vazio = todas iguais. */
  differences: string[];
}

function mostCommon(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  for (const [v, n] of counts) if (n > (counts.get(best) ?? 0)) best = v;
  return best;
}

/**
 * Condensa a lista de cobranças em poucas linhas. Só reordena o que a lista já tem: os
 * valores e as datas continuam sendo os do backend. `null` quando não há cobrança.
 */
export function summarizeChargeSchedule(rows: readonly ChargeScheduleRow[]): ChargeScheduleSummary | null {
  if (rows.length === 0) return null;
  const period = rows.filter((r) => r.fine !== null);
  const deposit = rows.find((r) => r.fine === null) ?? null;
  const depositLine = deposit ? `Caução de ${deposit.amount}, vence ${deposit.due}.` : null;
  if (period.length === 0) {
    return { total: rows.length, hasMore: false, headline: 'Só a caução', dates: '', charges: null, deposit: depositLine, differences: [] };
  }

  const common = mostCommon(period.map((r) => r.amount));
  const headline =
    period.length === 1
      ? `1 cobrança de ${period[0].amount}`
      : `${period.length} cobranças de ${common}`;
  const byDue = [...period].sort((a, b) => a.dueIso.localeCompare(b.dueIso));
  const first = byDue[0];
  const last = byDue[byDue.length - 1];
  const dates =
    period.length === 1 ? `Vence em ${first.due}` : `Primeira vence em ${first.due}, última em ${last.due}`;

  const differences: string[] = [];
  const oddAmount = period.filter((r) => r.amount !== common);
  if (oddAmount.length > 0 && oddAmount.length <= 2) {
    differences.push(`Valor diferente: ${oddAmount.map((r) => `${r.title} (${r.amount})`).join(', ')}.`);
  } else if (oddAmount.length > 2) {
    differences.push(`${oddAmount.length} cobranças com valor diferente de ${common}.`);
  }
  if (new Set(period.map((r) => r.destination)).size > 1) {
    const dest = mostCommon(period.map((r) => r.destination));
    const n = period.filter((r) => r.destination !== dest).length;
    differences.push(`${n} ${n === 1 ? 'cobrança tem' : 'cobranças têm'} outro destino (veja a lista).`);
  }

  return {
    total: rows.length,
    hasMore: rows.length > 1,
    headline,
    dates,
    charges: first.fine !== null ? `${first.fine} · ${first.interest}` : null,
    deposit: depositLine,
    differences,
  };
}
