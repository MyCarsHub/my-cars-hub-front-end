import { BUSINESS_TIME_ZONE } from '../../../utils/business-clock';
import { formatFullDate, formatTime, parseServerTime } from '../../../utils/server-time';

/**
 * Datas do Atendimento (Suporte, Sugestões, Auditoria). Os `LocalDateTime` da API chegam
 * em UTC SEM sufixo; `new Date(iso)` leria como hora local do navegador (3 h adiantado e,
 * depois das 21h de Brasília, o dia seguinte). Tudo aqui passa por `parseServerTime` e é
 * escrito no fuso do negócio.
 */

const LONG_DATE = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const LONG_TIME = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** "18/11/2026 às 14:32" no fuso do negócio; `null` sem data válida. */
export function whenExact(value: string | null | undefined): string | null {
  const date = parseServerTime(value);
  return date ? `${formatFullDate(date)} às ${formatTime(date)}` : null;
}

/** Só o dia, "18/11/2026"; "—" sem data. */
export function whenDay(value: string | null | undefined): string {
  return formatFullDate(parseServerTime(value));
}

/** Só a hora, "14:32"; "—" sem data. */
export function whenTime(value: string | null | undefined): string {
  return formatTime(parseServerTime(value));
}

/**
 * Balão do mouse: "quarta-feira, 18 de novembro de 2026 às 14:32:05 (horário de Brasília)".
 * `null` sem data (o atributo `title` some).
 */
export function whenLong(value: string | null | undefined): string | null {
  const date = parseServerTime(value);
  if (!date) return null;
  return `${LONG_DATE.format(date)} às ${LONG_TIME.format(date)} (horário de Brasília)`;
}

/**
 * "agora", "há 12 min", "há 3 h", "há 1 dia", "há 5 dias"; `null` sem data, no futuro ou
 * depois de 30 dias (aí só a data exata informa). O "agora" entra por parâmetro para o
 * spec fixar o relógio.
 */
export function whenAgo(value: string | null | undefined, now: number): string | null {
  const date = parseServerTime(value);
  if (!date) return null;
  const ms = now - date.getTime();
  if (ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days > 30) return null;
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}
