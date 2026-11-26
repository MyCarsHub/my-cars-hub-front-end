/**
 * Regras puras da página do Asaas: conferência da chave, quem está vendo, e a
 * formatação (dinheiro, datas em horário de Brasília, forma de pagamento).
 * Sem Angular aqui: tudo é testável com uma chamada.
 */
import { todayInBusinessTz } from '../../../utils/business-clock';
import type { AsaasEnvironment, AsaasFees } from './asaas-integration.types';

/* ---------------------------------------------------------- conferir a chave */

export const ASAAS_PROD_PREFIX = '$aact_prod_';
export const ASAAS_TEST_PREFIX = '$aact_hmlg_';
/** Abaixo disto a chave ainda está sendo colada (as reais passam de 100 caracteres). */
export const ASAAS_KEY_MIN_LENGTH = 24;

export interface AsaasKeyCheck {
  tone: 'muted' | 'good' | 'bad';
  text: string;
  /** Pode conectar. */
  ok: boolean;
  /** Ambiente que a chave decide; `null` enquanto não dá para conectar. */
  environment: AsaasEnvironment | null;
}

/**
 * Confere o prefixo na hora. O dono só liga produção: chave de testes é erro. O admin
 * pode guardar a de testes, que fica como Testes (o backend decide se ela vira a ativa).
 */
export function checkAsaasKey(raw: string, canUseTestKey: boolean): AsaasKeyCheck {
  const key = raw.trim();
  if (!key)
    return { tone: 'muted', text: 'A chave começa com $aact_', ok: false, environment: null };
  const longEnough = key.length >= ASAAS_KEY_MIN_LENGTH;
  if (key.startsWith(ASAAS_PROD_PREFIX)) {
    return longEnough
      ? {
          tone: 'good',
          text: 'Chave de produção. Pode conectar.',
          ok: true,
          environment: 'PRODUCTION',
        }
      : { tone: 'muted', text: 'Continue colando: a chave é longa.', ok: false, environment: null };
  }
  if (key.startsWith(ASAAS_TEST_PREFIX)) {
    if (!canUseTestKey) {
      return {
        tone: 'bad',
        text: 'Essa é de testes. Gere a chave na sua conta de verdade.',
        ok: false,
        environment: null,
      };
    }
    return longEnough
      ? {
          tone: 'good',
          text: 'Chave de testes. Fica guardada como Testes.',
          ok: true,
          environment: 'SANDBOX',
        }
      : { tone: 'muted', text: 'Continue colando: a chave é longa.', ok: false, environment: null };
  }
  // Ainda digitando o começo de um dos dois prefixos: não acusa erro cedo demais.
  if (ASAAS_PROD_PREFIX.startsWith(key) || ASAAS_TEST_PREFIX.startsWith(key)) {
    return { tone: 'muted', text: 'A chave começa com $aact_', ok: false, environment: null };
  }
  return { tone: 'bad', text: 'Isso não parece uma chave do Asaas.', ok: false, environment: null };
}

/* ------------------------------------------------------------------ dinheiro */

const BRL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `128450` → `R$ 1.284,50` (espaço comum, para não quebrar a régua de testes). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}R$ ${BRL.format(Math.abs(cents) / 100)}`;
}

/** Partes do número grande do card: `1.284` e `,50`. */
export function centsParts(cents: number): { int: string; dec: string } {
  const text = BRL.format(Math.abs(cents) / 100);
  const comma = text.lastIndexOf(',');
  return { int: (cents < 0 ? '-' : '') + text.slice(0, comma), dec: text.slice(comma) };
}

const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Taxa do cartão: `2,99% + R$ 0,49`; some a parte que o Asaas não informou. */
export function cardFeeLabel(fees: AsaasFees): string | null {
  const pct = fees.cardPercent != null ? `${PCT.format(fees.cardPercent)}%` : null;
  const fixed = fees.cardFixedCents != null ? formatCents(fees.cardFixedCents) : null;
  if (pct && fixed) return `${pct} + ${fixed}`;
  return pct ?? fixed;
}

/* --------------------------------------------------------------------- datas */

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Mês corrente em Brasília, por extenso: `novembro`. */
export function currentMonthName(now: Date = new Date()): string {
  const month = Number(todayInBusinessTz(now).slice(5, 7));
  return MONTHS[month - 1] ?? '';
}

function yesterdayOf(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Dia de calendário (`yyyy-MM-dd…`, horário de parede de Brasília, como o backend manda)
 * comparado com hoje em Brasília: `Hoje`, `Ontem` ou `dd/MM`.
 */
export function dayLabel(isoDay: string, now: Date = new Date()): string {
  const day = isoDay.slice(0, 10);
  const today = todayInBusinessTz(now);
  if (day === today) return 'Hoje';
  if (day === yesterdayOf(today)) return 'Ontem';
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** Só `dd/MM`. */
export function shortDate(isoDay: string): string {
  return `${isoDay.slice(8, 10)}/${isoDay.slice(5, 7)}`;
}

/** `2026-11-26T11:22:00` → `hoje, 11:22` (sem hora quando ela não veio). */
export function noticeLabel(isoDateTime: string, now: Date = new Date()): string {
  const day = dayLabel(isoDateTime, now).toLowerCase();
  const time = isoDateTime.length >= 16 ? isoDateTime.slice(11, 16) : '';
  return time ? `${day}, ${time}` : day;
}
