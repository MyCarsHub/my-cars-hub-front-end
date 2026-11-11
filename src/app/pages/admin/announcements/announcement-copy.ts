import { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import {
  AdminAnnouncement,
  AnnouncementAudience,
  AnnouncementStatus,
} from '../../../types/announcement.types';

/** `yyyy-MM-dd` → `dd/MM/yyyy` sem passar por `Date` (nada de fuso mexendo no dia). */
export function formatIsoDay(iso: string | null | undefined, withYear = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  return withYear ? `${m[3]}/${m[2]}/${m[1]}` : `${m[3]}/${m[2]}`;
}

/** Hoje no fuso do negócio, `yyyy-MM-dd` (o mesmo que o servidor usa). */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
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

export function periodLabel(a: Pick<AdminAnnouncement, 'startsOn' | 'endsOn'>): string {
  const start = formatIsoDay(a.startsOn);
  const end = formatIsoDay(a.endsOn);
  if (start && end) {
    const sameYear = a.startsOn!.slice(0, 4) === a.endsOn!.slice(0, 4);
    return `${sameYear ? formatIsoDay(a.startsOn, false) : start} a ${end}`;
  }
  if (start) return `A partir de ${start}`;
  if (end) return `Até ${end}`;
  return 'Sem data';
}

export function periodSub(a: AdminAnnouncement, today: string): string {
  if (a.status === 'EXPIRED') {
    const end = a.endsOn ?? (a.endedAt ? a.endedAt.slice(0, 10) : null);
    return end ? `encerrou em ${formatIsoDay(end, false)}` : 'encerrada';
  }
  if (a.status === 'PUBLISHED') {
    return a.startsOn && a.startsOn > today ? `começa em ${formatIsoDay(a.startsOn, false)}` : 'no ar';
  }
  return a.startsOn ? `começa em ${formatIsoDay(a.startsOn, false)}` : 'defina ao publicar';
}

/** Linha de apoio do título: quantos leram (no ar/encerrada) ou quando foi editada (rascunho). */
export function titleSub(a: AdminAnnouncement): string {
  if (a.status === 'DRAFT') {
    const when = formatIsoDay((a.modifyDate ?? a.createdDate ?? '').slice(0, 10));
    return when ? `editada em ${when}` : 'rascunho';
  }
  const n = a.readCount ?? 0;
  return n === 1 ? 'lida por 1 pessoa' : `lida por ${n} pessoas`;
}
