import {
  PublicStatus,
  StatusComponent,
  StatusComponentKey,
  StatusDay,
  StatusIncident,
  StatusLevel,
} from '../../types/status.types';

/** Nomes que um leigo entende — nada de «banco», «API» ou «job». */
export const COMPONENT_LABEL: Record<StatusComponentKey, string> = {
  AUTH: 'Entrar no sistema',
  RENTALS: 'Aluguéis e contratos',
  PAYMENTS: 'Cobranças e Pix (Asaas)',
  EMAIL: 'Avisos por e-mail',
  SIGNATURE: 'Assinatura de contratos (Autentique)',
  DRIVER_APP: 'App do motorista',
};

export type Tone = 'ok' | 'slow' | 'down' | 'unknown';

export interface Summary {
  tone: Tone;
  title: string;
  body: string;
}

const TZ = 'America/Sao_Paulo';

function parts(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return { day, time };
}

/** «hoje às 14:02» se for hoje (em Brasília), senão «24/10 às 14:02». */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const { day, time } = parts(iso);
  const today = parts(now.toISOString()).day;
  return day === today ? `hoje às ${time}` : `${day} às ${time}`;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

function namesWhere(status: PublicStatus, level: StatusLevel): string[] {
  return status.components.filter((c) => c.status === level).map((c) => COMPONENT_LABEL[c.key]);
}

/** O resumo grande do topo. `null` = a API não respondeu. */
export function summaryOf(status: PublicStatus | null, now: Date = new Date()): Summary {
  if (!status) {
    return {
      tone: 'unknown',
      title: 'Não conseguimos verificar agora',
      body:
        'Não deu para falar com o nosso servidor. Pode ser a sua internet ou um problema do nosso lado. ' +
        'Tente de novo em instantes.',
    };
  }
  switch (status.overall) {
    case 'OPERATIONAL':
      return {
        tone: 'ok',
        title: 'Tudo funcionando',
        body: 'Todos os serviços do MyCarsHub estão respondendo normalmente.',
      };
    case 'DEGRADED':
      return {
        tone: 'slow',
        title: `Lentidão em ${joinNames(namesWhere(status, 'SLOW'))}`,
        body: 'Está funcionando, mas pode estar mais devagar que o normal. Já estamos de olho.',
      };
    case 'OUTAGE': {
      const down = namesWhere(status, 'DOWN');
      return {
        tone: 'down',
        title: status.since ? `Fora do ar desde ${whenLabel(status.since, now)}` : 'Fora do ar agora',
        body: `Com problema: ${joinNames(down)}. Estamos trabalhando para resolver.`,
      };
    }
    default:
      return {
        tone: 'unknown',
        title: 'Verificando…',
        body: 'Estamos começando a conferir os serviços. Volte em um minuto.',
      };
  }
}

export function levelLabel(level: StatusLevel): string {
  switch (level) {
    case 'OPERATIONAL':
      return 'Funcionando';
    case 'SLOW':
      return 'Lento';
    case 'DOWN':
      return 'Fora do ar';
    default:
      return 'Verificando';
  }
}

export function dayLabel(day: StatusDay): string {
  const [y, m, d] = day.date.split('-');
  const date = `${d}/${m}/${y}`;
  const state =
    day.status === 'OPERATIONAL'
      ? 'funcionou normalmente'
      : day.status === 'SLOW'
        ? 'teve lentidão'
        : day.status === 'DOWN'
          ? 'teve queda'
          : 'sem registro';
  return `${date}: ${state}`;
}

/** «99,9%» ou `null` quando não há nenhum dia medido na janela. */
export function uptimeOf(component: StatusComponent, days: number): string | null {
  const measured = component.days.slice(-days).filter((d) => d.uptime !== null);
  if (measured.length === 0) return null;
  const avg = measured.reduce((sum, d) => sum + (d.uptime as number), 0) / measured.length;
  return `${(Math.floor(avg * 10) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1 })}%`;
}

export interface IncidentView {
  title: string;
  detail: string;
  ongoing: boolean;
  startedAt: string;
}

/** Incidente em português claro. */
export function incidentView(incident: StatusIncident, now: Date = new Date()): IncidentView {
  const names = joinNames(incident.components.map((k) => COMPONENT_LABEL[k]));
  const down = incident.kind === 'DOWN';
  const title = down ? `${names}: ficou fora do ar` : `${names}: ficou mais lento que o normal`;
  const ongoing = incident.resolvedAt === null;
  let detail: string;
  if (ongoing) {
    detail = `Começou ${whenLabel(incident.startedAt, now)} e ainda estamos resolvendo.`;
  } else {
    const minutes = Math.max(
      1,
      Math.round(
        (new Date(incident.resolvedAt as string).getTime() - new Date(incident.startedAt).getTime()) / 60000,
      ),
    );
    const duration =
      minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
    detail =
      `Começou ${whenLabel(incident.startedAt, now)} e durou ${duration}. ` +
      (down ? 'Se você tentou usar nessa hora, tente de novo.' : 'Já voltou ao normal.');
  }
  return { title, detail, ongoing, startedAt: incident.startedAt };
}
