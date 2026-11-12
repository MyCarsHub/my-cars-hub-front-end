import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { StatusChipTone } from '../components/core/status-chip/status-chip';
import {
  ADJUSTMENT_MAX_AMOUNT_CENTS,
  ADJUSTMENT_MAX_DUE_DAYS_AHEAD,
  AdjustmentHistoryEntry,
} from '../types/adjustment.types';
import { ptBrMoneyCents, ptBrMoneyValidator } from './validators/ptbr-money.validator';

/** O que o chip diz e se a cobrança ainda espera pagamento (para o Pix e o cartão laranja). */
export interface AdjustmentStatusMeta {
  readonly key: string;
  readonly label: string;
  readonly tone: StatusChipTone;
  /** Ainda pode ser paga pelo Pix: pendente ou atrasada. */
  readonly open: boolean;
}

const META: Record<string, Omit<AdjustmentStatusMeta, 'key'>> = {
  ISSUING: { label: 'Emitindo', tone: 'blue', open: false },
  ISSUE_FAILED: { label: 'Não emitida', tone: 'red', open: false },
  PENDING: { label: 'Pendente', tone: 'amber', open: true },
  PAST_DUE: { label: 'Atrasada', tone: 'red', open: true },
  PAID: { label: 'Paga', tone: 'green', open: false },
  CANCELED: { label: 'Cancelada', tone: 'neutral', open: false },
  FAILED: { label: 'Com falha', tone: 'red', open: false },
  REFUNDED: { label: 'Estornada', tone: 'neutral', open: false },
  DISPUTED: { label: 'Em contestação', tone: 'amber', open: false },
};

/**
 * O status como a tela o mostra. PENDING já vencida conta como atrasada, a mesma derivação do
 * resto do app (`effectiveChargeStatus`), para as duas telas nunca discordarem. `today` vem de
 * fora: uma tela, um relógio.
 */
export function adjustmentStatusMeta(status: string, dueDate: string, today: string): AdjustmentStatusMeta {
  const key = status === 'PENDING' && dueDate < today ? 'PAST_DUE' : status;
  const meta = META[key] ?? { label: 'Em análise', tone: 'neutral' as const, open: false };
  return { key, ...meta };
}

/** `yyyy-MM-dd` + `days`, em dias de calendário (sem fuso: a data já é do negócio). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Último vencimento aceito: hoje + `ADJUSTMENT_MAX_DUE_DAYS_AHEAD` (o teto do back-end). */
export function lastAdjustmentDueDate(today: string): string {
  return addDaysIso(today, ADJUSTMENT_MAX_DUE_DAYS_AHEAD);
}

/** Vencimento de hoje até o teto, inclusive nas duas pontas. Vazio é `required`. */
export function dueWindowValidator(min: string, max: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const v = control.value;
    if (typeof v !== 'string' || v.trim() === '') return { required: true };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { dateFormat: true };
    if (v < min) return { minDate: true };
    if (v > max) return { maxDate: true };
    return null;
  };
}

/**
 * Valor do ajuste: o controle guarda TEXTO pt-BR mascarado ("1.234,56"); quem lê é a mesma
 * gramática que converte no envio (`ptBrMoneyCents`). Maior que zero e até o teto do back-end.
 */
export function adjustmentAmountValidator(): ValidatorFn {
  const base = ptBrMoneyValidator({ minCents: 1 });
  return (control: AbstractControl): ValidationErrors | null => {
    const baseError = base(control);
    if (baseError) return baseError;
    const cents = ptBrMoneyCents(control.value as string);
    if (cents !== null && cents > ADJUSTMENT_MAX_AMOUNT_CENTS) return { max: true };
    return null;
  };
}

/** Duas iniciais do nome ("Carlos Mendes" → "CM"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

/** `yyyy-MM-dd` → `dd/MM/yyyy`. */
export function brDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10).split('-').reverse().join('/');
}

/** `LocalDateTime` → `dd/MM/yyyy HH:mm` (a hora como veio: o back-end não manda fuso). */
export function brDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const time = /T(\d{2}:\d{2})/.exec(iso)?.[1];
  return time ? `${brDate(iso)} ${time}` : brDate(iso);
}

/** Linha do "Histórico". OVERDUE é só o dia (o back-end põe meio-dia como hora). */
export function historyRow(entry: AdjustmentHistoryEntry): { label: string; when: string } {
  const actor = entry.actorName ? ` por ${entry.actorName}` : '';
  switch (entry.type) {
    case 'CREATED':
      return { label: `Criado${actor}`, when: brDateTime(entry.at) };
    case 'PIX_ISSUED':
      return { label: 'Pix gerado para o motorista', when: brDateTime(entry.at) };
    case 'OVERDUE':
      return { label: 'Venceu sem pagamento', when: brDate(entry.at) };
    case 'PAID':
      return { label: 'Paga por Pix', when: brDateTime(entry.at) };
    case 'CANCELED':
      return { label: `Cancelada${actor}`, when: brDateTime(entry.at) };
    case 'ISSUE_FAILED':
      return { label: 'Emissão não concluída. Nada foi cobrado.', when: brDateTime(entry.at) };
    default:
      return { label: 'Atualização', when: brDateTime(entry.at) };
  }
}

/**
 * Chave de idempotência de UM envio do formulário. Tentar de novo o MESMO corpo (rede caiu,
 * 5xx, duplo clique) reaproveita a chave, e o back-end devolve o ajuste já criado em vez de
 * emitir um segundo Pix. Corpo diferente é envio novo, com chave nova: reaproveitar a chave
 * com outro corpo daria 409.
 */
export class IdempotencyKeyKeeper {
  private current: { key: string; fingerprint: string } | null = null;

  constructor(private readonly newKey: () => string = defaultKey) {}

  keyFor(fingerprint: string): string {
    if (this.current?.fingerprint !== fingerprint) {
      this.current = { key: this.newKey(), fingerprint };
    }
    return this.current.key;
  }

  /** O envio terminou (criado): a próxima submissão é outra. */
  reset(): void {
    this.current = null;
  }
}

function defaultKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback sem `randomUUID` (navegador antigo): 128 bits aleatórios em hex.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
