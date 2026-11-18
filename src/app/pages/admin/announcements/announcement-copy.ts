import { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import {
  AdminAnnouncement,
  AnnouncementAudience,
  AnnouncementStatus,
} from '../../../types/announcement.types';
import { BUSINESS_TIME_ZONE } from '../../../utils/business-clock';
import { formatFullDate, formatTime, parseServerTime } from '../../../utils/server-time';

/** `yyyy-MM-dd` → `dd/MM/yyyy` sem passar por `Date` (nada de fuso mexendo no dia). */
export function formatIsoDay(iso: string | null | undefined, withYear = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  return withYear ? `${m[3]}/${m[2]}/${m[1]}` : `${m[3]}/${m[2]}`;
}

/** Hoje no fuso do negócio, `yyyy-MM-dd` (o mesmo que o servidor usa). */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export const STATUS_LABEL: Record<AnnouncementStatus, string> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicada',
  EXPIRED: 'Encerrada',
};

export interface StatusChipStyle {
  tone: StatusChipTone;
  colorClass: string | null;
}

/** Cor só no chip: publicada verde, rascunho neutro forte, encerrada neutro apagado. */
export function statusChip(status: AnnouncementStatus): StatusChipStyle {
  if (status === 'PUBLISHED') return { tone: 'green', colorClass: null };
  if (status === 'DRAFT') return { tone: 'neutral', colorClass: 'bg-surface-strong text-fg-soft' };
  return { tone: 'neutral', colorClass: null };
}

export function audienceLabel(audiences: readonly AnnouncementAudience[]): { main: string; sub: string } {
  const loc = audiences.includes('LOCADORA');
  const mot = audiences.includes('MOTORISTA');
  if (loc && mot) return { main: 'Locadoras e motoristas', sub: 'dono, gerente e motorista' };
  if (loc) return { main: 'Locadoras', sub: 'dono e gerente' };
  if (mot) return { main: 'Motoristas', sub: 'área do motorista' };
  return { main: 'Sem público', sub: 'escolha ao publicar' };
}

/**
 * Período pedido, sempre com o ano dos dois lados ("12/11/2026 a 30/11/2026"), igual ao
 * intervalo do seletor de período (auditoria 18/11, §4).
 */
export function periodLabel(a: Pick<AdminAnnouncement, 'startsOn' | 'endsOn'>): string {
  const start = formatIsoDay(a.startsOn);
  const end = formatIsoDay(a.endsOn);
  if (start && end) return `${start} a ${end}`;
  if (start) return `A partir de ${start}`;
  if (end) return `Até ${end}`;
  return 'Sem data';
}

/**
 * Dia `yyyy-MM-dd` de um instante do servidor no fuso do negócio. `LocalDateTime` da API vem
 * em UTC sem sufixo: cortar os 10 primeiros caracteres daria o dia seguinte depois das 21h de
 * Brasília. `parseServerTime` lê como UTC e o `en-CA` devolve o dia certo.
 */
export function businessDayOf(value: string | null | undefined): string | null {
  const date = parseServerTime(value);
  return date ? todayIso(date) : null;
}

/** Data e hora exatas de um instante do servidor: "18/11/2026 às 14:32" (fuso do negócio). */
export function exactDateTime(value: string | null | undefined): string | null {
  const date = parseServerTime(value);
  return date ? `${formatFullDate(date)} às ${formatTime(date)}` : null;
}

/** Linha de apoio do período: o que acontece com ela agora, com a data completa. */
export function periodSub(a: AdminAnnouncement, today: string): string {
  if (a.status === 'EXPIRED') {
    // Encerrada à mão antes do fim: vale o dia em que foi encerrada, não o fim planejado.
    const end = businessDayOf(a.endedAt) ?? a.endsOn;
    return end ? `encerrou em ${formatIsoDay(end)}` : 'encerrada';
  }
  if (a.status === 'PUBLISHED') {
    if (a.startsOn && a.startsOn > today) return `começa em ${formatIsoDay(a.startsOn)}`;
    const since = a.startsOn ?? businessDayOf(a.publishedAt);
    return since ? `no ar desde ${formatIsoDay(since)}` : 'no ar';
  }
  return a.startsOn ? `começa em ${formatIsoDay(a.startsOn)}` : 'defina ao publicar';
}

/** Linha de apoio do título: quantos leram (no ar/encerrada) ou quando foi editada (rascunho). */
export function titleSub(a: AdminAnnouncement): string {
  if (a.status === 'DRAFT') {
    const when = formatIsoDay(businessDayOf(a.modifyDate ?? a.createdDate));
    return when ? `editada em ${when}` : 'rascunho';
  }
  const n = a.readCount ?? 0;
  return n === 1 ? 'lida por 1 pessoa' : `lida por ${n} pessoas`;
}

/** Instante exato mais útil da linha, para o balão do mouse do período. */
export function periodExact(a: AdminAnnouncement): string | null {
  if (a.status === 'EXPIRED' && a.endedAt) {
    const at = exactDateTime(a.endedAt);
    return at ? `Encerrada em ${at}` : null;
  }
  if (a.status === 'PUBLISHED' && a.publishedAt) {
    const at = exactDateTime(a.publishedAt);
    return at ? `Publicada em ${at}` : null;
  }
  const at = exactDateTime(a.modifyDate ?? a.createdDate);
  return at ? `Editada em ${at}` : null;
}
