import { HttpErrorResponse } from '@angular/common/http';

import { RentalBillingFrequency } from '../../../types/rental.types';
import { RENEWAL_CODES, RenewalPreviewDto, RenewalUnit } from '../../../types/rental-renewal.types';
import { INTERVAL_UNIT_OPTIONS, brDate, brl, isIsoDay, intervalLabel } from '../charges-flex/charges-flex';
import { apiErrorCode } from '../charges-flex/flex-errors';
import { dShort, periodWords, plural, weekdayLong } from '../rental-wizard/wizard-format';
import { PreviewModel } from '../rental-create/cards/preview-sheet';

/**
 * Renovação do aluguel (pranchas RenR1–R6 / RenD1), em funções puras: o detalhe, a folha e os
 * specs leem a mesma resposta. Mês = 30 dias, semana = 7 (a regra do backend).
 */

export const RENEWAL_AMOUNT_MAX = 1000;
/** O aviso "Termina em N dias" aparece a partir de 7 dias antes do fim (decisão 4 do dono). */
export const ENDING_NOTICE_DAYS = 7;

const UNIT_DAYS: Readonly<Record<RenewalUnit, number>> = { DAYS: 1, WEEKS: 7, MONTHS: 30 };

export function unitDays(unit: RenewalUnit): number {
  return UNIT_DAYS[unit];
}

/** "semana" / "semanas" (a lista da unidade fala no número escolhido). */
export function unitWord(unit: RenewalUnit, amount: number): string {
  const o = INTERVAL_UNIT_OPTIONS.find((u) => u.value === unit) ?? INTERVAL_UNIT_OPTIONS[0];
  return amount === 1 ? o.singular : o.plural;
}

/**
 * As unidades que fecham períodos INTEIROS do aluguel (decisão da revisão; o backend recusa as
 * outras com 400 `RENEWAL_UNIT_MISALIGNED`): semanal só semanas, mensal só meses, diário as três.
 */
export function allowedUnits(freq: RentalBillingFrequency): readonly RenewalUnit[] {
  if (freq === 'WEEKLY') return ['WEEKS'];
  if (freq === 'MONTHLY') return ['MONTHS'];
  return ['DAYS', 'WEEKS', 'MONTHS'];
}

/** A unidade natural da frequência do aluguel (semanal → semanas). */
export function defaultUnit(freq: RentalBillingFrequency): RenewalUnit {
  return freq === 'DAILY' ? 'DAYS' : freq === 'MONTHLY' ? 'MONTHS' : 'WEEKS';
}

/** Quanto a mais vem preenchido: o tempo mínimo na unidade, quando cabe inteiro; senão 1. */
export function defaultAmount(minimumTermDays: number | null | undefined, unit: RenewalUnit): number {
  const days = minimumTermDays ?? 0;
  const per = unitDays(unit);
  if (days > 0 && days % per === 0) return Math.min(RENEWAL_AMOUNT_MAX, days / per);
  return 1;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

// ------------------------------------------------------------------ detalhe do aluguel
export interface RentalNotice {
  tone: 'orange' | 'green';
  title: string;
  text: string;
}

const ENDING_TEXT = 'Renove para continuar cobrando, ou encerre quando ele devolver o carro.';

/**
 * RenR1: "Termina em 7 dias, em 22/12" quando faltam até {@link ENDING_NOTICE_DAYS} dias; o
 * mesmo aviso dizendo que passou, quando o fim já foi e o aluguel segue ativo. `null` fora disso.
 */
export function endingNotice(endDate: string | null | undefined, today: string): RentalNotice | null {
  if (!isIsoDay(endDate) || !isIsoDay(today)) return null;
  const left = daysBetween(today, endDate);
  if (left > ENDING_NOTICE_DAYS) return null;
  // Em outro ano, a data leva o ano (um fim que passou há mais de um ano não fica ambíguo).
  const day = endDate.slice(0, 4) === today.slice(0, 4) ? dShort(endDate) : brDate(endDate);
  const title =
    left > 0
      ? `Termina em ${plural(left, 'dia', 'dias')}, em ${day}`
      : left === 0
        ? `Termina hoje, em ${day}`
        : `Terminou em ${day} e continua ativo`;
  return { tone: 'orange', title, text: ENDING_TEXT };
}

export interface RenewalSync {
  requested: number;
  created: number;
  failed: number;
  local: number;
}

/**
 * RenR6: o aviso depois de renovar, sempre a partir do `chargeSync` da RESPOSTA (o que de fato
 * aconteceu), nunca da prévia. Verde só quando nenhuma cobrança falhou. Com falha (ou sem
 * `chargeSync` numa renovação que ia ao Asaas: a emissão lançou), laranja: renovado, e as
 * cobranças que não foram a gente tenta de novo sozinho. A prancha diz "por e-mail e no app";
 * o motorista não tem feed (o backend só manda o e-mail), então a frase fica no e-mail.
 *
 * @param expectedGateway quantas a prévia mandaria ao Asaas (só para o caso sem `chargeSync`)
 */
export function renewedNotice(newEndDate: string, sync: RenewalSync | null | undefined, expectedGateway: number): RentalNotice {
  const title = `Aluguel renovado até ${brDate(newEndDate)}`;
  const driver = 'O motorista é avisado por e-mail, se tiver e-mail cadastrado.';
  const failed = sync ? sync.failed : expectedGateway;
  if (failed > 0) {
    const what =
      failed === 1
        ? '1 cobrança não foi para a sua conta Asaas.'
        : `${failed} cobranças não foram para a sua conta Asaas.`;
    return { tone: 'orange', title, text: `${what} A gente tenta de novo sozinho.` };
  }
  const created = sync?.created ?? 0;
  const local = sync?.local ?? 0;
  const parts: string[] = [];
  if (created > 0) parts.push(`${plural(created, 'cobrança nova', 'cobranças novas')} na sua conta Asaas`);
  if (local > 0) parts.push(`${plural(local, 'cobrança nova anotada', 'cobranças novas anotadas')} no aluguel`);
  const what = parts.length ? `${parts.join(' e ')}. ` : '';
  return { tone: 'green', title, text: `${what}${driver}` };
}

/** "Tempo mínimo": "4 semanas" (semanal, múltiplo de 7), "3 meses" (mensal, de 30), senão dias. */
export function minimumTermLabel(days: number | null | undefined, freq: RentalBillingFrequency): string | null {
  if (!days || days <= 0) return null;
  if (freq === 'WEEKLY' && days % 7 === 0) return plural(days / 7, 'semana', 'semanas');
  if (freq === 'MONTHLY' && days % 30 === 0) return plural(days / 30, 'mês', 'meses');
  return plural(days, 'dia', 'dias');
}

export function renewalsLabel(count: number | null | undefined): string {
  return count && count > 0 ? String(count) : 'Nenhuma';
}

// ------------------------------------------------------------------ folha "Renovar aluguel"
/** "(4 semanas depois de 22/12)." — depois do "Novo fim: <b>19/01/2027</b>". */
export function newEndTail(previousEnd: string, amount: number, unit: RenewalUnit): string {
  return `(${intervalLabel(amount, unit)} depois de ${dShort(previousEnd)}).`;
}

/** "Hoje é R$ 600,00. O valor novo vale só para as semanas novas." */
export function rateHint(currentRateCents: number, freq: RentalBillingFrequency): string {
  const w = periodWords(freq);
  const theNew = w.fem ? `as ${w.lowerMany} novas` : `os ${w.lowerMany} novos`;
  return `Hoje é ${brl(currentRateCents)}. O valor novo vale só para ${theNew}.`;
}

function cadence(freq: RentalBillingFrequency, firstDue: string): string {
  if (freq === 'MONTHLY') return 'a cada 30 dias';
  if (freq === 'DAILY') return 'todo dia';
  const day = weekdayLong(firstDue);
  return `${day === 'sábado' || day === 'domingo' ? 'todo' : 'toda'} ${day}`;
}

/** "4 cobranças novas, toda terça, de 22/12 a 12/01" (vencimentos da primeira à última). */
export function totalCaption(preview: RenewalPreviewDto, freq: RentalBillingFrequency): string {
  const p = preview.periods;
  if (!p.length) return '';
  const first = p[0].dueDate;
  const last = p[p.length - 1].dueDate;
  if (p.length === 1) return `1 cobrança nova, em ${dShort(first)}`;
  return `${p.length} cobranças novas, ${cadence(freq, first)}, de ${dShort(first)} a ${dShort(last)}`;
}

/** RenR3 — "Cobranças da renovação": a folha de prévia do Novo aluguel, com as linhas novas. */
export function chargesModel(preview: RenewalPreviewDto, freq: RentalBillingFrequency): PreviewModel {
  const w = periodWords(freq);
  return {
    tone: 'orange',
    label: 'Renovação',
    total: brl(preview.addedTotalCents),
    caption: `${plural(preview.periods.length, w.lower, w.lowerMany)}, de ${dShort(preview.previousEndDate)} a ${dShort(preview.newEndDate)}`,
    rows: preview.periods.map((p) => ({
      key: `r${p.index}`,
      day: dShort(p.dueDate),
      weekday: weekdayLong(p.dueDate),
      title: `${w.one} ${p.index + 1}`,
      sub: `até ${dShort(p.endDate)}`,
      amount: brl(p.amountCents),
      discount: null,
    })),
    note: 'Sem desconto e sem parcelas. A caução continua a mesma.',
  };
}

export interface LeadText {
  lead: string;
  rest: string;
}

/** RenR4 — "Ele tem 1 cobrança atrasada. Ela continua como está. A renovação só cria as novas." */
export function overdueText(count: number): LeadText | null {
  if (count <= 0) return null;
  return count === 1
    ? { lead: 'Ele tem 1 cobrança atrasada.', rest: 'Ela continua como está. A renovação só cria as novas.' }
    : {
        lead: `Ele tem ${count} cobranças atrasadas.`,
        rest: 'Elas continuam como estão. A renovação só cria as novas.',
      };
}

export interface SayText {
  before: string;
  bold: string;
  after: string;
}

/** "Ao renovar, as <b>4 cobranças</b> vão para a sua conta Asaas agora, e o motorista …". */
export function sayText(preview: RenewalPreviewDto): SayText | null {
  const n = preview.periods.length;
  if (!n) return null;
  const notice = 'o motorista recebe um aviso com o novo fim.';
  const bold = plural(n, 'cobrança', 'cobranças');
  const the = n === 1 ? 'a' : 'as';
  if (preview.gatewayCount > 0 && preview.localCount === 0) {
    return { before: `Ao renovar, ${the} `, bold, after: ` ${n === 1 ? 'vai' : 'vão'} para a sua conta Asaas agora, e ${notice}` };
  }
  if (preview.gatewayCount === 0) {
    return { before: `Ao renovar, ${the} `, bold, after: ` ${n === 1 ? 'fica anotada' : 'ficam anotadas'} no aluguel, e ${notice}` };
  }
  // Misto: as que vencem antes de hoje nunca vão ao gateway (regra do planner).
  const gw = preview.gatewayCount;
  const local = preview.localCount;
  return {
    before: 'Ao renovar, ',
    bold: plural(gw, 'cobrança', 'cobranças'),
    after: ` ${gw === 1 ? 'vai' : 'vão'} para a sua conta Asaas agora e ${local} ${local === 1 ? 'fica anotada' : 'ficam anotadas'} no aluguel, e ${notice}`,
  };
}

/**
 * Quanto cabe até a próxima reserva do carro, em períodos inteiros: na unidade escolhida, senão
 * em dias quando a frequência permite. É um palpite; quem confirma é a prévia do servidor.
 */
export function fitToMax(
  previousEnd: string,
  maxEnd: string,
  unit: RenewalUnit,
  allowed: readonly RenewalUnit[] = ['DAYS', 'WEEKS', 'MONTHS'],
): { amount: number; unit: RenewalUnit } | null {
  if (!isIsoDay(previousEnd) || !isIsoDay(maxEnd)) return null;
  const days = daysBetween(previousEnd, maxEnd);
  if (days <= 0) return null;
  const n = Math.floor(days / unitDays(unit));
  if (n >= 1) return { amount: n, unit };
  return allowed.includes('DAYS') ? { amount: days, unit: 'DAYS' } : null;
}

/** RenR5 — "O carro tem outra reserva a partir de 05/01. Dá para renovar até 05/01 (2 semanas)." */
export function vehicleTakenText(
  maxEnd: string,
  fit: { amount: number; unit: RenewalUnit } | null,
): LeadText {
  const lead = `O carro tem outra reserva a partir de ${dShort(maxEnd)}.`;
  if (!fit) return { lead, rest: 'Não dá para renovar agora.' };
  return { lead, rest: `Dá para renovar até ${dShort(maxEnd)} (${intervalLabel(fit.amount, fit.unit)}).` };
}

// ------------------------------------------------------------------ erros do renew
const MESSAGES: Readonly<Record<string, string>> = {
  [RENEWAL_CODES.STALE]: 'O fim do aluguel mudou enquanto você renovava. Confira o novo fim e renove de novo.',
  [RENEWAL_CODES.NOT_ACTIVE]: 'Só dá para renovar um aluguel ativo.',
  [RENEWAL_CODES.INTEGRATION_NOT_CONNECTED]:
    'Sua conta Asaas não está conectada. Conecte para renovar com cobranças automáticas.',
};

/** O texto da recusa do `renew` (409/403/400/rede), na língua da locadora. */
export function renewErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Sem conexão. Confira a internet e tente de novo.';
    if (err.status === 403) return 'Você não tem permissão para renovar este aluguel.';
    const code = apiErrorCode(err);
    if (code === RENEWAL_CODES.NOT_ACTIVE) {
      const own = (err.error as { message?: unknown } | null)?.message;
      return typeof own === 'string' && own.trim() ? own.trim() : MESSAGES[code];
    }
    if (code && MESSAGES[code]) return MESSAGES[code];
    const own = (err.error as { message?: unknown } | null)?.message;
    if (typeof own === 'string' && own.trim()) return own.trim();
  }
  return 'Não foi possível renovar. Tente de novo.';
}

/**
 * O texto de uma prévia que voltou com erro HTTP: a frase do servidor num 400 (ex.:
 * `RENEWAL_UNIT_MISALIGNED`), senão a genérica (o link "Tentar de novo" vem junto).
 */
export function previewErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse && err.status === 400) {
    const own = (err.error as { message?: unknown } | null)?.message;
    if (typeof own === 'string' && own.trim()) return own.trim();
  }
  if (err instanceof HttpErrorResponse && err.status === 403) return 'Você não tem permissão para renovar este aluguel.';
  return 'Não deu para calcular a renovação.';
}

/** O `maxEndDate` de um 409 `VEHICLE_PERIOD_TAKEN` (o backend o manda em `reason`). */
export function takenMaxEnd(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse) || apiErrorCode(err) !== RENEWAL_CODES.VEHICLE_PERIOD_TAKEN) return null;
  const reason = (err.error as { reason?: unknown } | null)?.reason;
  return isIsoDay(typeof reason === 'string' ? reason : null) ? (reason as string) : null;
}
