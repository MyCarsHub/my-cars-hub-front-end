import type { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { todayInBusinessTz } from '../../../utils/business-clock';
import { parseServerTime } from '../../../utils/server-time';
import type {
  ActivityItem,
  CompanyEngagement,
  CompanySegment,
  ContactLogChannel,
  ContactLogResult,
  LastActionKind,
  NextActionKey,
  SegmentReason,
} from '../../../types/admin-segments.types';

/**
 * Texto da tela para os códigos do contrato de segmentos (18/11/2026). Tudo puro e com `now`
 * injetável: a lista, "Hoje, para agir", o detalhe e o Registrar contato leem daqui, então a
 * mesma empresa diz a mesma coisa em todo lugar.
 *
 * Datas: instantes do servidor passam por `parseServerTime` e viram o DIA de Brasília; datas de
 * calendário (`followUpDate`, `hiddenUntil`) já são o dia de Brasília e nunca passam por `Date`
 * local (meia-noite UTC voltaria um dia no Brasil).
 */

export interface ChipStyle {
  label: string;
  tone: StatusChipTone;
}

/** Cor só no chip: verde vai bem, azul implantando, âmbar parado, vermelho esfriando, neutro o resto. */
export const SEGMENT_CHIPS: Record<CompanySegment, ChipStyle> = {
  PAYING_ACTIVE: { label: 'Pagante ativo', tone: 'green' },
  PAYING_ONBOARDING: { label: 'Pagante implantando', tone: 'blue' },
  PAYING_COOLING: { label: 'Pagante esfriando', tone: 'red' },
  TRIAL_ACTIVATING: { label: 'Teste ativando', tone: 'green' },
  TRIAL_STALLED: { label: 'Teste parado', tone: 'amber' },
  TRIAL_EXPIRED_ACTIVATED: { label: 'Teste vencido', tone: 'neutral' },
  NO_ACTIVATION: { label: 'Cadastro sem ativação', tone: 'neutral' },
  EX_CLIENT: { label: 'Ex-cliente', tone: 'neutral' },
};

/**
 * Deep link da lista de Empresas com uma pílula escolhida (`/admin/companies?segmento=CODIGO`).
 * Quem leva para um segmento (o chip da Visão geral, o endereço antigo de "Converter testes")
 * monta o parâmetro por aqui, e a lista lê o mesmo nome.
 */
export const SEGMENT_QUERY_PARAM = 'segmento';

export function segmentQueryParams(segment: CompanySegment): Record<string, string> {
  return { [SEGMENT_QUERY_PARAM]: segment };
}

/**
 * Deep link da lista de Empresas filtrada por "teste que vence em N dias"
 * (`/admin/companies?testeVenceEm=7`). O chip do Painel monta o endereço por aqui; a lista lê o
 * mesmo nome e pede `trialEndsWithinDays=N&sort=trialEndsAt&dir=asc`, a MESMA regra do número do
 * chip no servidor (`TrialEndingSql`), então o total da lista é o número do chip.
 */
export const TRIAL_ENDING_QUERY_PARAM = 'testeVenceEm';
/** Dias do chip do Painel (o servidor manda o número como `trialsEndingIn7Days`). */
export const TRIAL_ENDING_CHIP_DAYS = 7;
/** Limites que o servidor aceita em `trialEndsWithinDays`. */
export const TRIAL_ENDING_MIN_DAYS = 1;
export const TRIAL_ENDING_MAX_DAYS = 90;

export function trialEndingQueryParams(days: number): Record<string, string> {
  return { [TRIAL_ENDING_QUERY_PARAM]: String(days) };
}

/** O valor do endereço, se for um número inteiro dentro dos limites; o resto é ignorado. */
export function parseTrialEndingDays(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw.trim())) return null;
  const days = Number(raw.trim());
  return days >= TRIAL_ENDING_MIN_DAYS && days <= TRIAL_ENDING_MAX_DAYS ? days : null;
}

/** Rótulo do filtro removível: "Testes que vencem em 7 dias" / "em 1 dia". */
export function trialEndingFilterLabel(days: number): string {
  return `Testes que vencem em ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

export function segmentChip(segment: CompanySegment | null | undefined): ChipStyle | null {
  return segment ? (SEGMENT_CHIPS[segment] ?? { label: segment, tone: 'neutral' }) : null;
}

/** Segmentos de teste: onde "Estender teste" (vigente) ou "Reabrir teste" (vencido) faz sentido. */
const LIVE_TRIAL: ReadonlySet<CompanySegment> = new Set(['TRIAL_ACTIVATING', 'TRIAL_STALLED']);
const ENDED_TRIAL: ReadonlySet<CompanySegment> = new Set(['TRIAL_EXPIRED_ACTIVATED', 'NO_ACTIVATION']);

export function isTrialSegment(segment: CompanySegment | null | undefined): boolean {
  return !!segment && (LIVE_TRIAL.has(segment) || ENDED_TRIAL.has(segment));
}

export function trialActionLabel(segment: CompanySegment | null | undefined): string {
  return segment && ENDED_TRIAL.has(segment) ? 'Reabrir teste' : 'Estender teste';
}

export const CHANNEL_LABELS: Record<ContactLogChannel, string> = {
  WHATSAPP: 'WhatsApp',
  PHONE: 'Ligação',
  EMAIL: 'E-mail',
  IN_PERSON: 'Pessoalmente',
};

export const RESULT_LABELS: Record<ContactLogResult, string> = {
  ANSWERED: 'Respondeu',
  NO_ANSWER: 'Sem resposta',
  WILL_SUBSCRIBE: 'Vai assinar',
  NOT_INTERESTED: 'Não tem interesse',
};

const REASON_LABELS: Record<string, string> = {
  NO_RECENT_SIGNAL: 'Nenhuma ação real nem acesso recente',
  PAST_DUE: 'A mensalidade está em atraso',
  CANCEL_AT_PERIOD_END: 'O cancelamento está marcado para o fim do ciclo',
  ACTIVE_RENTALS_DROPPED: 'Os aluguéis ativos caíram nas últimas semanas',
  PAYING_WITHOUT_ACTIVE_RENTAL: 'Paga e não tem aluguel ativo',
  FIRST_RENTAL_PENDING: 'Paga e ainda não fez o 1º aluguel',
  RECENT_SIGNAL: 'Usou o sistema nos últimos dias',
  TRIAL_ENDED_RECENTLY: 'O teste acabou há pouco',
  TRIAL_ENDED_LONG_AGO: 'O teste acabou há bastante tempo',
  STOPPED_PAYING: 'Pagou e parou de pagar',
  OPEN_SUPPORT_TICKETS: 'Tem chamado de suporte aberto',
  TRIAL_ENDING_SOON: 'O teste está acabando',
  FOLLOW_UP_DUE: 'O retorno marcado chegou',
  NOT_INTERESTED: 'Disse que não tem interesse',
};

export function reasonLabel(code: string | null | undefined): string | null {
  if (!code || code === 'NONE') return null;
  return REASON_LABELS[code] ?? null;
}

const REENGAGE_BY_REASON: Partial<Record<SegmentReason, string>> = {
  PAST_DUE: 'Regularizar a mensalidade em atraso',
  CANCEL_AT_PERIOD_END: 'Entender o cancelamento antes do fim do ciclo',
  ACTIVE_RENTALS_DROPPED: 'Perguntar por que os aluguéis caíram',
  PAYING_WITHOUT_ACTIVE_RENTAL: 'Ajudar a voltar a alugar pelo sistema',
  NO_RECENT_SIGNAL: 'Perguntar o que travou: parou de usar',
};

const NEXT_ACTION_TITLES: Record<NextActionKey, string> = {
  NONE: 'Não tem interesse: fora das sugestões',
  ANSWER_SUPPORT: 'Responder os chamados antes de vender',
  OFFER_TRIAL_EXTENSION: 'Oferecer mais dias de teste',
  HELP_FIRST_VEHICLE: 'Ajudar a cadastrar o 1º veículo',
  HELP_FIRST_RENTAL: 'Ajudar a criar o 1º aluguel',
  CONVERT_TO_PAID: 'Já fez aluguel: ajudar a assinar',
  REENGAGE_PAYING: 'Perguntar o que travou',
  CHECK_IN: 'Nada urgente: perguntar como está indo',
  LAST_ATTEMPT_OFFER: 'Última tentativa: chamar de volta',
  REOPEN_TRIAL: 'Oferecer reabrir o teste',
  CAMPAIGN_ONLY: 'Só campanha, sem contato individual',
  ASK_WHY_LEFT: 'Entender por que saiu',
  FOLLOW_UP: 'Retorno marcado: retomar a conversa',
};

/** A frase da próxima ação ("Ajudar a criar o 1º aluguel"). Interna ou sem bloco: nulo. */
export function nextActionTitle(e: CompanyEngagement | null | undefined): string | null {
  const action = e?.nextAction;
  if (!action) return null;
  if (action.key === 'ANSWER_SUPPORT') {
    const n = e.openSupportTickets;
    if (n === 1) return 'Responder o chamado aberto antes de vender';
    if (n > 1) return `Responder os ${n} chamados abertos antes de vender`;
  }
  if (action.key === 'REENGAGE_PAYING') {
    const byReason = REENGAGE_BY_REASON[action.reason as SegmentReason];
    if (byReason) return byReason;
  }
  return NEXT_ACTION_TITLES[action.key] ?? null;
}

/** Os motivos do "Por quê" do cartão Próxima ação: os do segmento e o da ação, sem repetir. */
export function whyLines(e: CompanyEngagement | null | undefined): string[] {
  if (!e) return [];
  const codes = [...(e.segmentReasons ?? []), e.nextAction?.reason ?? null];
  const lines: string[] = [];
  for (const code of codes) {
    const label = reasonLabel(code);
    if (label && !lines.includes(label)) lines.push(label);
  }
  if (e.openSupportTickets > 0 && e.nextAction?.reason !== 'OPEN_SUPPORT_TICKETS') {
    lines.push(e.openSupportTickets === 1 ? '1 chamado de suporte aberto' : `${e.openSupportTickets} chamados de suporte abertos`);
  }
  return lines;
}

// ---- Datas -------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Dia de Brasília (`yyyy-MM-dd`) de um instante do servidor; nulo se não houver. */
export function businessDay(instant: string | null | undefined): string | null {
  const date = parseServerTime(instant);
  return date ? todayInBusinessTz(date) : null;
}

function utcOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

/** Quantos dias de `from` até `to` (datas de calendário). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / DAY_MS);
}

export function addDays(day: string, n: number): string {
  return new Date(utcOf(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * "20/11" a partir de `yyyy-MM-dd`, sem passar por fuso; "22/10/2027" quando o dia NÃO é do ano
 * corrente de Brasília (sem o ano, "Renova em 22/10" de 2027 lê como uma data que já passou).
 */
export function dayMonth(day: string | null | undefined, now: Date = new Date()): string {
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  if (!d || !m) return day;
  return y && y !== todayInBusinessTz(now).slice(0, 4) ? `${d}/${m}/${y}` : `${d}/${m}`;
}

/** "20/11/2026" a partir de `yyyy-MM-dd`. */
export function fullDay(day: string | null | undefined): string {
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  return d && m && y ? `${d}/${m}/${y}` : day;
}

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' });

/** "quinta-feira" para `yyyy-MM-dd`. */
export function weekdayName(day: string): string {
  return WEEKDAY.format(new Date(utcOf(day)));
}

/** "hoje", "ontem", "há 4 dias" ou "em 04/08" ("em 04/08/2025" de outro ano; passado, dia de Brasília). */
export function relativePast(instant: string | null | undefined, now: Date = new Date()): string | null {
  const day = businessDay(instant);
  if (!day) return null;
  const diff = daysBetween(day, todayInBusinessTz(now));
  if (diff <= 0) return 'hoje';
  if (diff === 1) return 'ontem';
  if (diff < 30) return `há ${diff} dias`;
  return `em ${dayMonth(day, now)}`;
}

// ---- Linha da lista ----------------------------------------------------------------------

const ACTION_LABELS: Record<LastActionKind, string> = {
  VEHICLE_CREATED: 'Cadastrou veículo',
  DRIVER_CREATED: 'Cadastrou motorista',
  RENTAL_CREATED: 'Criou aluguel',
  CONTRACT_CREATED: 'Criou contrato',
  INSPECTION_CREATED: 'Fez vistoria',
  MAINTENANCE_CREATED: 'Registrou manutenção',
  RENTAL_STATUS_CHANGED: 'Mudou status de aluguel',
  CHARGE_CANCELED: 'Cancelou cobrança',
  SUPPORT_TICKET_OPENED: 'Abriu chamado',
};

export function actionLabel(kind: string): string {
  return ACTION_LABELS[kind as LastActionKind] ?? 'Ação no sistema';
}

/** "Cadastrou veículo há 4 dias · último acesso 13/11" / "Nenhuma ação real · nunca acessou". */
export function lastSignalText(e: CompanyEngagement | null | undefined, now: Date = new Date()): string {
  if (!e) return '—';
  const parts: string[] = [];
  if (e.lastAction) {
    parts.push(`${actionLabel(e.lastAction.kind)} ${relativePast(e.lastAction.at, now) ?? ''}`.trim());
  } else {
    parts.push('Nenhuma ação real');
  }
  const access = businessDay(e.lastAccessAt);
  if (access) parts.push(`último acesso ${dayMonth(access, now)}`);
  else if (!e.lastAction) parts.push('nunca acessou');
  return parts.join(' · ');
}

/** "Teste acaba amanhã" / "Teste acabou em 25/10" / "Renova em 03/12" / "Renova em 22/10/2027" / "—". */
export function deadlineText(e: CompanyEngagement | null | undefined, now: Date = new Date()): string {
  const deadline = e?.deadline;
  const day = businessDay(deadline?.at);
  if (!deadline || !day) return '—';
  const today = todayInBusinessTz(now);
  const ahead = daysBetween(today, day);
  switch (deadline.kind) {
    case 'TRIAL_ENDS':
      if (ahead <= 0) return 'Teste acaba hoje';
      if (ahead === 1) return 'Teste acaba amanhã';
      return `Teste acaba em ${dayMonth(day, now)}`;
    case 'TRIAL_ENDED':
      if (ahead === 0) return 'Teste acabou hoje';
      if (ahead === -1) return 'Teste acabou ontem';
      return `Teste acabou em ${dayMonth(day, now)}`;
    case 'RENEWAL':
      if (ahead === 0) return 'Renova hoje';
      if (ahead === 1) return 'Renova amanhã';
      return `Renova em ${dayMonth(day, now)}`;
    default:
      return dayMonth(day, now);
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Só cadastro" ou "6 veíc. · 7 mot. · 5 aluguéis". */
export function fleetText(e: CompanyEngagement | null | undefined): string {
  const f = e?.fleet;
  if (!f) return '—';
  if (f.vehicles === 0 && f.drivers === 0 && f.rentals === 0) return 'Só cadastro';
  return `${f.vehicles} veíc. · ${f.drivers} mot. · ${plural(f.rentals, 'aluguel', 'aluguéis')}`;
}

/** "Contato em 13/11, WhatsApp, sem resposta". Sem contato: nulo. */
export function lastContactHead(e: CompanyEngagement | null | undefined, now: Date = new Date()): string | null {
  const c = e?.lastContact;
  if (!c) return null;
  return `Contato em ${dayMonth(businessDay(c.contactedAt), now)}, ${CHANNEL_LABELS[c.channel] ?? c.channel}, ${(
    RESULT_LABELS[c.result] ?? c.result
  ).toLowerCase()}`;
}

/** "Contato em 13/11, WhatsApp, sem resposta · retorno em 20/11". Sem contato: nulo. */
export function lastContactText(e: CompanyEngagement | null | undefined, now: Date = new Date()): string | null {
  const head = lastContactHead(e, now);
  const c = e?.lastContact;
  if (!head || !c) return null;
  const status = e?.today?.status;
  if (status === 'HIDDEN_UNTIL_DATE' && e?.today.hiddenUntil) return `${head} · retorno em ${dayMonth(e.today.hiddenUntil, now)}`;
  if (status === 'HIDDEN_UNTIL_SEGMENT_CHANGES') return `${head} · sem retorno marcado`;
  if (c.followUpDate) return `${head} · retorno em ${dayMonth(c.followUpDate, now)}`;
  return head;
}

// ---- WhatsApp ----------------------------------------------------------------------------

function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * Mensagem pronta do WhatsApp, por próxima ação. Curta, em pt-BR, assinada pela equipe (nunca
 * pelo nome de quem está logado) e sem prometer desconto. "Não tem interesse": nulo, sem mensagem.
 */
export function whatsAppMessage(
  e: CompanyEngagement | null | undefined,
  companyName: string,
  ownerName: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const action = e?.nextAction;
  if (!action || action.key === 'NONE') return null;
  const first = firstName(ownerName);
  const hello = first ? `Olá, ${first}! Aqui é da equipe MyCarsHub.` : 'Olá! Aqui é da equipe MyCarsHub.';
  const deadline = deadlineText(e, now).toLowerCase();
  let body: string;
  switch (action.key) {
    case 'ANSWER_SUPPORT':
      body = 'Vi o seu chamado de suporte. Posso te ajudar agora?';
      break;
    case 'OFFER_TRIAL_EXTENSION':
      body = deadline.startsWith('teste ')
        ? `O teste da ${companyName} ${deadline.slice('teste '.length)}. Se precisar de mais tempo para testar, eu estendo para você.`
        : `O teste da ${companyName} está acabando. Se precisar de mais tempo para testar, eu estendo para você.`;
      break;
    case 'HELP_FIRST_VEHICLE':
      body = 'Posso te mostrar em 5 minutos como cadastrar o primeiro carro?';
      break;
    case 'HELP_FIRST_RENTAL':
      body = 'Falta pouco para o primeiro aluguel. Quer ajuda com o contrato e o cadastro?';
      break;
    case 'CONVERT_TO_PAID':
      body = `Vi que a ${companyName} já fez o primeiro aluguel. Quer ajuda para escolher o plano e deixar a cobrança automática?`;
      break;
    case 'REENGAGE_PAYING':
      if (action.reason === 'PAST_DUE') body = `Vi que a mensalidade da ${companyName} ficou em aberto. Posso te ajudar a regularizar?`;
      else if (action.reason === 'CANCEL_AT_PERIOD_END') body = `Vi que a assinatura da ${companyName} vai ser cancelada no fim do ciclo. Aconteceu alguma coisa? Quero entender e ajudar.`;
      else body = `Notei que a ${companyName} usou pouco o sistema nos últimos dias. Travou em alguma coisa?`;
      break;
    case 'CHECK_IN':
      body = `Como está indo com o MyCarsHub na ${companyName}? Tem algo que eu possa melhorar?`;
      break;
    case 'LAST_ATTEMPT_OFFER':
      body = `O teste da ${companyName} acabou, mas vi que você chegou a usar o sistema. Quer continuar de onde parou?`;
      break;
    case 'REOPEN_TRIAL':
      body = `Vi que você criou a conta da ${companyName} e não chegou a cadastrar os carros. Quer que eu reabra o teste e te ajude a começar?`;
      break;
    case 'CAMPAIGN_ONLY':
      body = 'Muita coisa mudou no sistema desde o seu teste. Quer dar uma nova olhada?';
      break;
    case 'ASK_WHY_LEFT':
      body = `Vi que a ${companyName} deixou de usar o MyCarsHub. Pode me contar o motivo? Sua resposta ajuda muito.`;
      break;
    case 'FOLLOW_UP':
      body = `Passando para retomar a nossa conversa sobre a ${companyName}. Conseguiu ver?`;
      break;
    default:
      return null;
  }
  return `${hello} ${body}`;
}

// ---- Atividade ---------------------------------------------------------------------------

const SUBSCRIPTION_STATUS: Record<string, string> = {
  TRIALING: 'em teste',
  ACTIVE: 'ativa',
  PAST_DUE: 'em atraso',
  CANCELED: 'cancelada',
  EXPIRED: 'expirada',
};

export interface ActivityLine {
  day: string;
  text: string;
  note: string | null;
  chip: ChipStyle;
}

/** Uma linha da linha do tempo: data (dia de Brasília), frase e o chip da categoria. */
export function activityLine(item: ActivityItem, now: Date = new Date()): ActivityLine {
  const day = dayMonth(businessDay(item.at), now);
  switch (item.category) {
    case 'ACCESS':
      return {
        day,
        text: item.count > 1 ? `${item.count} pessoas da empresa entraram no sistema` : 'O dono ou um gerente entrou no sistema',
        note: null,
        chip: { label: 'Acesso', tone: 'neutral' },
      };
    case 'CONTACT': {
      const c = item.contact;
      const who = c?.createdByName?.trim() || 'Alguém da equipe';
      const channel = c ? (CHANNEL_LABELS[c.channel] ?? c.channel) : 'contato';
      const result = c ? (RESULT_LABELS[c.result] ?? c.result).toLowerCase() : '';
      const follow = c?.followUpDate ? ` Retorno marcado para ${dayMonth(c.followUpDate, now)}.` : '';
      return {
        day,
        text: `${who} registrou contato por ${channel}: ${result}.${follow}`,
        note: c?.note?.trim() || null,
        chip: { label: 'Contato', tone: 'blue' },
      };
    }
    case 'SUBSCRIPTION': {
      const s = item.subscription;
      const from = s?.fromStatus ? (SUBSCRIPTION_STATUS[s.fromStatus] ?? s.fromStatus) : null;
      const to = s?.toStatus ? (SUBSCRIPTION_STATUS[s.toStatus] ?? s.toStatus) : null;
      const status = from && to && from !== to ? `passou de ${from} para ${to}` : to ? `ficou ${to}` : 'mudou';
      const plan = s?.fromPlanCode && s?.toPlanCode && s.fromPlanCode !== s.toPlanCode ? ' e trocou de plano' : '';
      return { day, text: `A assinatura ${status}${plan}`, note: null, chip: { label: 'Assinatura', tone: 'amber' } };
    }
    case 'SIGNUP':
      return { day, text: 'Criou a empresa e começou o teste', note: null, chip: { label: 'Cadastro', tone: 'neutral' } };
    default: {
      const times = item.count > 1 ? ` (${item.count} vezes)` : '';
      return { day, text: `${actionLabel(item.kind)}${times}`, note: null, chip: { label: 'Ação real', tone: 'green' } };
    }
  }
}
