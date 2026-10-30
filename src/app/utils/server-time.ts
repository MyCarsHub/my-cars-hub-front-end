import { BUSINESS_TIME_ZONE } from './business-clock';

/**
 * Lê um instante do backend. Os `LocalDateTime` da API são UTC SEM sufixo de
 * zona (Render e Supabase rodam em UTC); `new Date('2026-10-31T21:34:00')`
 * leria isso como hora LOCAL do navegador e erraria o prazo em 3 horas no
 * Brasil. Com sufixo (`Z` / `+hh:mm`) a string é respeitada como veio.
 */
export function parseServerTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const date = new Date(hasZone ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
});
const DATE = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const TIME = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

/** "31/10" no fuso do negócio. */
export function formatDayMonth(date: Date | null): string {
  return date ? DAY_MONTH.format(date) : '—';
}

/** "31/10/2026" no fuso do negócio. */
export function formatFullDate(date: Date | null): string {
  return date ? DATE.format(date) : '—';
}

/** "21:34" no fuso do negócio. */
export function formatTime(date: Date | null): string {
  return date ? TIME.format(date) : '—';
}

/** "31/10, 21:34" no fuso do negócio. */
export function formatDayMonthTime(date: Date | null): string {
  return date ? `${DAY_MONTH.format(date)}, ${TIME.format(date)}` : '—';
}

/** "Faltam 2 dias" / "Faltam 5 horas" / "Prazo encerrado". */
export function remainingLabel(until: Date | null, now: Date): string {
  if (!until) return '';
  const ms = until.getTime() - now.getTime();
  if (ms <= 0) return 'Prazo encerrado';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return days === 1 ? 'Falta 1 dia' : `Faltam ${days} dias`;
  const hours = Math.ceil(ms / 3_600_000);
  return hours === 1 ? 'Falta 1 hora' : `Faltam ${hours} horas`;
}
