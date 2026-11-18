import type { KpiDelta } from '../../../components/kpi-card/kpi-card';
import { formatKpiNumber } from '../../../components/kpi-card/kpi-card';
import type { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import type { HeatmapRow } from '../../../components/charts/heatmap/heatmap';
import { buildCsv, type CsvColumn } from '../../../components/lists/data-list/data-list-csv';
import type {
  AdminHome,
  AdminHomeGranularity,
  CompanyHealth,
  CompanyHealthReason,
  HeatCell,
  HomeKpi,
} from '../../../types/admin-home.types';
import { companyRoleLabel } from '../../../utils/role-labels';

/**
 * Regras puras da Visão geral v2: rótulos, variação, texto do "sem dado", mapa de calor e CSV.
 * Tudo aqui recebe o "agora" por parâmetro quando precisa dele, para o spec fixar o relógio.
 */

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** `2026-11-05` -> `05/11/2026`; nulo continua nulo. */
export function dayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : null;
}

/** `2026-11-05` -> `05/11`. */
export function shortDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

/** `2026-11` -> `nov` (ou `nov/26` quando a janela cruza o ano). */
export function monthShort(month: string, withYear = false): string {
  const [y, m] = month.split('-').map(Number);
  const name = MONTHS_PT[(m || 1) - 1] ?? month;
  return withYear ? `${name}/${String(y).slice(-2)}` : name;
}

/** `2026-11` -> `novembro`. */
export function monthLong(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** True quando os rótulos de mês precisam do ano para não confundir janeiro de um ano com o do outro. */
export function spansYears(dates: readonly string[]): boolean {
  return new Set(dates.map((d) => d.slice(0, 4))).size > 1;
}

/** Rótulo de um balde: dia e semana por `dd/MM` (início do balde), mês pelo nome. */
export function bucketLabels(starts: readonly string[], granularity: AdminHomeGranularity): string[] {
  if (granularity === 'MONTH') {
    const withYear = spansYears(starts);
    return starts.map((s) => monthShort(s.slice(0, 7), withYear));
  }
  return starts.map(shortDay);
}

/** Rótulos de meses `YYYY-MM`. */
export function monthLabels(months: readonly string[]): string[] {
  const withYear = spansYears(months);
  return months.map((m) => monthShort(m, withYear));
}

/**
 * Variação de um KPI de dinheiro contra o anterior, em %. Sem anterior, ou anterior zero (não há
 * base para porcentagem), não há chip: a tela não inventa "↗ 100%".
 */
export function percentDelta(kpi: HomeKpi | null | undefined, caption: string, upIsBad = false): KpiDelta | null {
  if (!kpi || kpi.value === null || kpi.previous === null || kpi.previous === 0) return null;
  const change = (kpi.value - kpi.previous) / Math.abs(kpi.previous);
  const pct = Math.round(change * 100);
  const arrow = pct > 0 ? '↗' : pct < 0 ? '↘' : '→';
  const up = pct > 0;
  const tone: KpiDelta['tone'] = pct === 0 ? 'neutral' : up !== upIsBad ? 'good' : 'bad';
  return { chip: `${arrow} ${Math.abs(pct)}%`, text: caption, tone };
}

/** Variação em número absoluto (assinaturas convertidas, usuários novos...). */
export function countDelta(n: number | null | undefined, caption: string): KpiDelta | null {
  if (n === null || n === undefined) return null;
  return { chip: n > 0 ? `↗ ${n}` : `${n}`, text: caption, tone: n > 0 ? 'good' : 'neutral' };
}

/**
 * O que um KPI nulo diz no lugar do número. Nunca "0": cada motivo vira uma frase, e o que não tem
 * motivo conhecido diz desde quando o dado existe.
 */
export function nullText(kpi: HomeKpi | null | undefined, currentMonth: string | null): string {
  if (!kpi) return 'sem dado';
  const month = currentMonth ? monthLong(currentMonth) : 'no mês';
  switch (kpi.nullReason) {
    case 'NO_COSTS':
      return `nenhum custo lançado em ${month}`;
    case 'NO_ACQUISITION_COST':
      return 'informe o gasto com aquisição';
    case 'NO_NEW_PAYING':
      return `nenhum cliente novo pagou em ${month}`;
    case 'NO_PAYING':
      return 'nenhum cliente pagante';
    case 'ZERO_CHURN':
      return 'sem cancelamentos: o LTV não tem divisor';
    case 'NO_DATA_YET': {
      const from = dayLabel(kpi.availableFrom);
      return from ? `calcula a partir de ${from}` : 'histórico ainda curto';
    }
    case 'NO_SNAPSHOT': {
      const since = dayLabel(kpi.since);
      return since ? `sem foto antes de ${since}` : 'sem foto diária';
    }
    default: {
      const since = dayLabel(kpi.since);
      return since ? `sem dado desde ${since}` : 'sem dado';
    }
  }
}

/** "agora", "há 4 min", "há 2 h", "ontem", "há 4 dias" ou a data. */
export function relativeTime(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  // O feed manda LocalDateTime em UTC, às vezes sem o `Z`.
  const at = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(at)) return null;
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(at));
}

// ------------------------------------------------------------------ mapa de calor

/** Segunda primeiro, como o desenho; `dow` do backend é 0 = domingo. */
const WEEK: readonly { dow: number; label: string }[] = [
  { dow: 1, label: 'Seg' },
  { dow: 2, label: 'Ter' },
  { dow: 3, label: 'Qua' },
  { dow: 4, label: 'Qui' },
  { dow: 5, label: 'Sex' },
  { dow: 6, label: 'Sáb' },
  { dow: 0, label: 'Dom' },
];

/** Faixas de 2 horas: `0h-2h` ... `22h-24h`. */
export const HEAT_COLUMNS: readonly string[] = Array.from({ length: 12 }, (_, i) => `${i * 2}h-${i * 2 + 2}h`);

/**
 * Pure: as células esparsas (só as não zero) viram 7 linhas x 12 faixas de 2 h. Célula ausente é
 * zero MEDIDO (o backend só manda as não zero de uma janela que ele mediu inteira).
 */
export function heatRows(cells: readonly HeatCell[]): HeatmapRow[] {
  const grid = new Map<number, number[]>();
  for (const d of WEEK) grid.set(d.dow, Array.from({ length: 12 }, () => 0));
  for (const c of cells) {
    const row = grid.get(c.dow);
    if (!row || c.hour < 0 || c.hour > 23) continue;
    row[Math.floor(c.hour / 2)] += c.count;
  }
  return WEEK.map((d) => ({ key: String(d.dow), label: d.label, values: grid.get(d.dow) ?? [] }));
}

// ------------------------------------------------------------------ papéis, saúde, movimentações

export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Sem papel';
  if (role === 'PLATFORM_ADMIN' || role === 'ADMIN') return 'Admin';
  if (role === 'SYSTEM') return 'Sistema';
  return companyRoleLabel(role);
}

export function roleTone(role: string | null | undefined): StatusChipTone {
  switch (role) {
    case 'OWNER':
      return 'orange';
    case 'MANAGER':
      return 'blue';
    case 'DRIVER':
      return 'green';
    default:
      return 'neutral';
  }
}

export const HEALTH_LABEL: Record<CompanyHealth, string> = {
  HEALTHY: 'Saudável',
  ATTENTION: 'Atenção',
  AT_RISK: 'Em risco',
};

export const HEALTH_TONE: Record<CompanyHealth, StatusChipTone> = {
  HEALTHY: 'green',
  ATTENTION: 'amber',
  AT_RISK: 'red',
};

/** A definição de cada saúde, dita junto do chip (<D-DEFS>). */
export const HEALTH_REASON: Record<CompanyHealthReason, string> = {
  OK: 'paga e acessou nos últimos 7 dias',
  TRIAL: 'em teste grátis',
  ACCESS_7_30D: 'último acesso entre 7 e 30 dias',
  FREE_PLAN: 'ativa num plano grátis',
  PAST_DUE: 'assinatura atrasada',
  NO_ACCESS_30D: 'sem acesso há mais de 30 dias',
  NEVER_ACCESSED: 'nunca acessou',
  NOT_PAYING: 'não paga e não está em teste',
};

const ACTION_LABEL: Record<string, string> = {
  USER_SIGNED_UP: 'Criou a conta',
  COMPANY_CREATED: 'Criou a empresa',
  SUBSCRIPTION_STARTED: 'Começou uma assinatura',
  SUBSCRIPTION_CHANGED: 'Mudou a assinatura',
  PLATFORM_PAYMENT_RECEIVED: 'Pagamento da assinatura confirmado',
  RENTAL_CREATED: 'Criou um aluguel',
  RENTAL_CHARGE_PAID: 'Cobrança de aluguel paga',
  VEHICLE_CREATED: 'Cadastrou um veículo',
  DRIVER_CREATED: 'Cadastrou um motorista',
  INVITE_ACCEPTED: 'Aceitou um convite',
  FINE_CREATED: 'Registrou uma multa',
  // Registro de ações (audit_events): o feed mostra todas, então todas têm nome em português.
  RENTAL_UPDATED: 'Atualizou um aluguel',
  RENTAL_ACTIVATED: 'Ativou um aluguel',
  RENTAL_CANCELED: 'Cancelou um aluguel',
  RENTAL_COMPLETED: 'Concluiu um aluguel',
  RENTAL_DELETED: 'Excluiu um aluguel',
  CHARGE_MARKED_PAID: 'Marcou cobrança como paga',
  CHARGE_UNMARKED_PAID: 'Desfez cobrança paga',
  CAUCAO_CHARGE_CREATED: 'Criou cobrança de caução',
  CAUCAO_MARKED_PAID: 'Marcou caução como paga',
  CAUCAO_UNMARKED_PAID: 'Desfez caução paga',
  CHARGE_CANCELED: 'Cancelou uma cobrança',
  CHARGE_RETRIED: 'Reenviou uma cobrança',
  CHARGE_RECONCILED: 'Cobrança conciliada',
  CHARGE_RECEIVED_OUTSIDE: 'Recebeu cobrança por fora',
  CHARGE_AGREEMENT_CREATED: 'Fez um acordo de cobranças',
  CHARGE_ADJUSTMENT_CREATED: 'Criou um ajuste de cobrança',
  DRIVER_UPDATED: 'Atualizou um motorista',
  DRIVER_STATUS_CHANGED: 'Mudou o status de um motorista',
  DRIVER_PROFILE_UPDATED: 'Atualizou o próprio perfil',
  DRIVER_USER_LINKED: 'Ligou o motorista a uma conta',
  DRIVER_DELETED: 'Excluiu um motorista',
  VEHICLE_UPDATED: 'Atualizou um veículo',
  VEHICLE_STATUS_CHANGED: 'Mudou o status de um veículo',
  VEHICLE_DELETED: 'Excluiu um veículo',
  VEHICLE_FIPE_REFRESHED: 'Atualizou a FIPE de um veículo',
  VEHICLE_SOLD: 'Vendeu um veículo',
  VEHICLE_SALE_UNDONE: 'Desfez a venda de um veículo',
  FINANCING_CREATED: 'Cadastrou um financiamento',
  FINANCING_PAID_OFF: 'Quitou um financiamento',
  FINANCING_DELETED: 'Excluiu um financiamento',
  FINANCING_INSTALLMENT_PAID: 'Pagou parcela de financiamento',
  FINANCING_INSTALLMENT_UNPAID: 'Desfez parcela de financiamento',
  MAINTENANCE_CREATED: 'Registrou uma manutenção',
  MAINTENANCE_UPDATED: 'Atualizou uma manutenção',
  MAINTENANCE_CONCLUDED: 'Concluiu uma manutenção',
  MAINTENANCE_CANCELED: 'Cancelou uma manutenção',
  MAINTENANCE_DELETED: 'Excluiu uma manutenção',
  FINE_UPDATED: 'Atualizou uma multa',
  FINE_PAID: 'Pagou uma multa',
  FINE_DELETED: 'Excluiu uma multa',
  INSURANCE_CREATED: 'Cadastrou um seguro',
  INSURANCE_UPDATED: 'Atualizou um seguro',
  INSURANCE_CANCELED: 'Cancelou um seguro',
  INSURANCE_DELETED: 'Excluiu um seguro',
  INSURANCE_INSTALLMENT_PAID: 'Pagou parcela de seguro',
  IPVA_INSTALLMENT_PAID: 'Pagou parcela de IPVA',
  EXPENSE_CREATED: 'Lançou uma despesa',
  EXPENSE_UPDATED: 'Atualizou uma despesa',
  EXPENSE_DELETED: 'Excluiu uma despesa',
  // Ações do admin (aba Admin).
  IMPERSONATION_STARTED: 'Entrou como cliente',
  IMPERSONATION_ENDED: 'Saiu da sessão de cliente',
  COMPANY_STATUS_CHANGED: 'Mudou o status de uma empresa',
  COMPANY_INTERNAL_FLAG_CHANGED: 'Marcou empresa como de teste',
  COMPANY_TRIAL_EXTENDED: 'Estendeu um teste grátis',
  USER_STATUS_CHANGED: 'Mudou o status de um usuário',
  COUPON_CREATED: 'Criou um cupom',
  COUPON_APPLIED: 'Aplicou um cupom',
  COUPON_DEACTIVATED: 'Desativou um cupom',
  CHARGE_RETRIED_BY_ADMIN: 'Reenviou uma cobrança',
  CHARGE_CANCELED_BY_ADMIN: 'Cancelou uma cobrança',
  PLATFORM_VENDOR_CREATED: 'Cadastrou um fornecedor',
  PLATFORM_VENDOR_UPDATED: 'Atualizou um fornecedor',
  PLATFORM_COST_SET: 'Lançou um custo',
  PLATFORM_COST_DELETED: 'Excluiu um custo',
  ADMIN_ROLE_GRANTED: 'Deu acesso de admin',
  ADMIN_ROLE_CHANGED: 'Mudou o papel de um admin',
  ADMIN_ROLE_REVOKED: 'Tirou acesso de admin',
  // Completa os três enums do backend (AuditAction, AdminAuditAction, PlatformMovementEvent).
  LOGIN_SUCCEEDED: 'Entrou no sistema',
  COMPANY_SWITCHED: 'Trocou de empresa',
  INSURANCE_INSTALLMENTS_GENERATED: 'Gerou parcelas de seguro',
  INSURANCE_INSTALLMENT_UNPAID: 'Desfez parcela de seguro',
  INSURANCE_INSTALLMENTS_DELETED: 'Excluiu parcelas de seguro',
  IPVA_INSTALLMENTS_GENERATED: 'Gerou parcelas de IPVA',
  IPVA_INSTALLMENT_ADDED: 'Adicionou parcela de IPVA',
  IPVA_INSTALLMENT_UPDATED: 'Atualizou parcela de IPVA',
  IPVA_INSTALLMENT_DELETED: 'Excluiu parcela de IPVA',
  IPVA_INSTALLMENT_UNPAID: 'Desfez parcela de IPVA',
  HTTP_MUTATION: 'Alteração registrada',
  USER_SYSTEM_ROLE_CHANGED: 'Mudou o papel de sistema de um usuário',
  USER_REMOVED: 'Removeu um usuário',
  USER_INVITE_RESENT: 'Reenviou um convite',
  COMPANY_MEMBER_REMOVED: 'Removeu alguém da empresa',
  FEEDBACK_TASK_STATUS_CHANGED: 'Mudou o status de um feedback',
  FEEDBACK_TASK_DELETED: 'Excluiu um feedback',
  BLOG_POST_CREATED: 'Criou um post',
  BLOG_POST_UPDATED: 'Editou um post',
  BLOG_POST_PUBLISHED: 'Publicou um post',
  BLOG_POST_UNPUBLISHED: 'Despublicou um post',
  BLOG_POST_DELETED: 'Excluiu um post',
  SUPPORT_TICKET_STATUS_CHANGED: 'Mudou o status de um chamado',
  SUPPORT_TICKET_REPLIED: 'Respondeu um chamado',
  SUPPORT_TICKET_ASSIGNED: 'Assumiu um chamado',
  IMPERSONATED_INVITES_LISTED: 'Viu os convites do cliente',
  ADMIN_COMPANY_ACCESS_GRANTED: 'Liberou acesso de escrita a uma empresa',
  SUPPORT_EDIT_REQUEST: 'Alterou dados no modo edição',
  SUPPORT_EDIT_STARTED: 'Ligou o modo edição',
  SUPPORT_EDIT_EXTENDED: 'Estendeu o modo edição',
  SUPPORT_EDIT_WRITE_CAP_REACHED: 'Atingiu o limite do modo edição',
  SUPPORT_EDIT_SIDE_EFFECT_SUPPRESSED: 'Segurou um envio no modo edição',
  RENTAL_SCHEDULE_REGENERATED: 'Refez o cronograma de um aluguel',
  CONTRACT_TEMPLATE_SAVED: 'Salvou o modelo de contrato',
  CONTRACT_AI_CONSENT_GIVEN: 'Autorizou a IA no contrato',
  CONTRACT_DRAFT_DISCARDED: 'Descartou um rascunho de contrato',
  NOTIFICATION_TEST_DISPATCHED: 'Enviou um teste de notificação',
  CHARGE_EMAIL_RESENT: 'Reenviou o e-mail de uma cobrança',
  USER_CONTACT_REVEALED: 'Viu o contato de um usuário',
  DRIVER_CONTACT_REVEALED: 'Viu o contato de um motorista',
  COMPANY_CONTACT_REVEALED: 'Viu o contato de uma empresa',
  CHARGE_ASAAS_COMPARED: 'Comparou uma cobrança com o Asaas',
  CHARGE_MARKED_RECEIVED_OUTSIDE: 'Marcou cobrança como recebida por fora',
  RENTAL_CHARGES_RENEGOTIATED: 'Renegociou cobranças num acordo',
  RENTAL_CHARGE_RECEIVED_OUTSIDE: 'Recebeu uma cobrança por fora',
  RENTAL_CHARGE_AGREEMENT_NEEDS_ATTENTION: 'Acordo de cobranças precisa de atenção',
  DRIVER_NAME_CORRECTED: 'Corrigiu o nome de um motorista',
  DRIVER_ASAAS_CUSTOMER_SYNCED: 'Atualizou o cliente no Asaas',
  BILLING_REMINDER: 'Lembrete de assinatura atrasada',
  ANNOUNCEMENT_CREATED: 'Criou um aviso',
  ANNOUNCEMENT_UPDATED: 'Editou um aviso',
  ANNOUNCEMENT_PUBLISHED: 'Publicou um aviso',
  ANNOUNCEMENT_UNPUBLISHED: 'Despublicou um aviso',
  ANNOUNCEMENT_DELETED: 'Excluiu um aviso',
  ANNOUNCEMENT_MEDIA_SET: 'Pôs uma imagem num aviso',
  ANNOUNCEMENT_MEDIA_REMOVED: 'Tirou a imagem de um aviso',
};

/** Ação que ainda não tem rótulo: em português, nunca o código cru. */
export const ACTION_FALLBACK = 'Ação registrada';

/** Rotas sem registro específico, pelo template exato (`MÉTODO /v1/...`). */
const ROUTE_LABEL: Record<string, string> = {
  'POST /v1/auth/oauth-exchange': 'Entrou com o Google',
  'POST /v1/announcements/{id}/read': 'Leu um aviso',
  'POST /v1/onboarding/step': 'Avançou no primeiro acesso',
  'POST /v1/onboarding/finish': 'Concluiu o primeiro acesso',
  'POST /v1/support/tickets': 'Abriu um chamado de suporte',
  'POST /v1/users/me/tour-seen': 'Viu o tour do sistema',
  'POST /v1/rentals/preflight': 'Conferiu os dados de um aluguel novo',
  'POST /v1/rentals/charge-preview': 'Simulou as cobranças de um aluguel',
  'POST /v1/rentals/{rentalId}/agreements/preview': 'Simulou um acordo de cobranças',
  'POST /v1/invites': 'Enviou um convite',
  'POST /v1/invite-onboarding/manager': 'Concluiu o cadastro de gerente',
  'POST /v1/vehicles/{vehicleId}/documents': 'Enviou um documento do veículo',
  'PUT /v1/companies/me': 'Atualizou os dados da empresa',
  'POST /v1/driver/ledger': 'Fez um lançamento no caderno do motorista',
  'POST /v1/billing/checkout': 'Abriu o pagamento da assinatura',
};

/** Rota sem template conhecido: a área pelo primeiro trecho depois de `/v1/`. */
const ROUTE_AREA: Record<string, string> = {
  vehicles: 'veículos',
  'vehicle-incidents': 'ocorrências de veículos',
  rentals: 'aluguéis',
  charges: 'cobranças',
  adjustments: 'ajustes de cobrança',
  drivers: 'motoristas',
  driver: 'área do motorista',
  fines: 'multas',
  maintenances: 'manutenções',
  insurances: 'seguros',
  ipva: 'IPVA',
  financings: 'financiamentos',
  expenses: 'despesas',
  inspections: 'vistorias',
  'inspection-schedules': 'agenda de vistorias',
  companies: 'empresa',
  settings: 'configurações',
  users: 'conta',
  invites: 'convites',
  'invite-onboarding': 'convites',
  billing: 'assinatura',
  onboarding: 'primeiro acesso',
  announcements: 'avisos',
  support: 'suporte',
  feedback: 'feedback',
  notifications: 'notificações',
  alerts: 'alertas',
  auth: 'acesso',
};

/**
 * O que a rota diz da alteração. O detalhe vem em dois formatos: `... POST /v1/x` (rede de
 * segurança da trilha, `HTTP_MUTATION`) ou `method=POST ... route=/v1/x` (modo edição).
 */
function routeLabel(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const plain = /\b(POST|PUT|PATCH|DELETE) (\/v1\/\S+)/.exec(detail);
  const method = plain?.[1] ?? /\bmethod=([A-Z]+)/.exec(detail)?.[1];
  const route = plain?.[2] ?? /\broute=(\/v1\/\S+)/.exec(detail)?.[1];
  if (!method || !route) return null;
  const exact = ROUTE_LABEL[`${method} ${route}`];
  if (exact) return exact;
  const area = ROUTE_AREA[route.split('/')[2] ?? ''];
  return area ? `Alteração em ${area}` : null;
}

/**
 * Ação do feed em português. As linhas genéricas (rede de segurança e modo edição) dizem o que
 * mudou pela rota quando o detalhe a traz; ação sem rótulo cai em {@link ACTION_FALLBACK}.
 */
export function actionLabel(action: string | null | undefined, detail?: string | null): string {
  if (!action) return '—';
  if (action === 'HTTP_MUTATION') return routeLabel(detail) ?? ACTION_LABEL[action];
  if (action === 'SUPPORT_EDIT_REQUEST') {
    const what = routeLabel(detail);
    return what ? `Modo edição: ${what.charAt(0).toLowerCase()}${what.slice(1)}` : ACTION_LABEL[action];
  }
  return ACTION_LABEL[action] ?? ACTION_FALLBACK;
}

export const ORIGIN_LABEL: Record<string, string> = {
  APP: 'Painel',
  ADMIN: 'Admin',
  WEBHOOK: 'Webhook',
  JOB: 'Rotina',
  UNKNOWN: 'Desconhecida',
};

export const RESULT_LABEL: Record<string, string> = { SUCCESS: 'Ok', FAILED: 'Falha', REFUSED: 'Recusada' };

export function resultTone(result: string): StatusChipTone {
  return result === 'SUCCESS' ? 'green' : result === 'FAILED' ? 'red' : 'amber';
}

// ------------------------------------------------------------------ cores de dado

/**
 * Cor estável por fornecedor (a ordem da lista de fornecedores). Nunca o laranja da marca: cor de
 * dado não pode parecer botão.
 */
export const VENDOR_COLORS: readonly string[] = [
  '#8b5cf6',
  '#ec4899',
  '#3b82f6',
  '#f59e0b',
  '#14b8a6',
  '#94a3b8',
  '#64748b',
  '#a3e635',
  '#f472b6',
  '#38bdf8',
];

export function vendorColor(index: number): string {
  return VENDOR_COLORS[((index % VENDOR_COLORS.length) + VENDOR_COLORS.length) % VENDOR_COLORS.length];
}

// ------------------------------------------------------------------ CSV

interface CsvKpiRow {
  readonly name: string;
  readonly kpi: HomeKpi;
}

function kpiCsvValue(kpi: HomeKpi, v: number | null): string | number | null {
  if (v === null) return null;
  if (kpi.unit === 'CENTS') return v;
  if (kpi.unit === 'RATIO') return formatKpiNumber('ratio', v);
  return v;
}

/**
 * O que está na tela, num CSV só: indicadores, saúde, séries mensais e o cruzamento por empresa.
 * Seções separadas por uma linha em branco; o BOM fica só no começo do arquivo.
 */
export function buildHomeCsv<T>(
  home: AdminHome,
  companies: { columns: readonly CsvColumn<T>[]; rows: readonly T[] } | null,
): string {
  const k = home.kpis;
  const h = home.health;
  const kpiRows: CsvKpiRow[] = [
    { name: 'MRR real', kpi: k.mrrReal },
    { name: 'Lucro do mês', kpi: k.profitMonth },
    { name: 'MRR estimado', kpi: k.mrrEstimated },
    { name: 'ARR', kpi: k.arr },
    { name: 'Custos do mês', kpi: k.costsMonth },
    { name: 'Assinaturas ativas', kpi: k.activeSubscriptions },
    { name: 'Empresas', kpi: k.companies },
    { name: 'Usuários', kpi: k.users },
    { name: 'Veículos', kpi: k.vehicles },
    { name: 'Valor gerenciado esperado no mês', kpi: k.managedExpected },
    { name: 'Valor gerenciado recebido no mês', kpi: k.managedReceived },
    { name: 'Churn mensal', kpi: h.churnMonthly },
    { name: 'LTV', kpi: h.ltv },
    { name: 'CAC', kpi: h.cac },
    { name: 'Retenção em 90 dias', kpi: h.retention90d },
    { name: 'Receita por cliente', kpi: h.arpa },
    { name: 'Margem', kpi: h.margin },
  ];
  const kpiCols: CsvColumn<CsvKpiRow>[] = [
    { key: 'name', header: 'Indicador', value: (r) => r.name },
    { key: 'value', header: 'Valor', value: (r) => (r.kpi.unit === 'CENTS' ? null : kpiCsvValue(r.kpi, r.kpi.value)) },
    { key: 'valueBrl', header: 'Valor (R$)', kind: 'money-cents', value: (r) => (r.kpi.unit === 'CENTS' ? r.kpi.value : null) },
    { key: 'previous', header: 'Anterior', value: (r) => (r.kpi.unit === 'CENTS' ? null : kpiCsvValue(r.kpi, r.kpi.previous)) },
    { key: 'previousBrl', header: 'Anterior (R$)', kind: 'money-cents', value: (r) => (r.kpi.unit === 'CENTS' ? r.kpi.previous : null) },
    { key: 'asOf', header: 'Anterior em', value: (r) => dayLabel(r.kpi.previousAsOf) },
    { key: 'why', header: 'Sem dado porque', value: (r) => (r.kpi.value === null ? nullText(r.kpi, home.meta.currentMonth) : null) },
    { key: 'definition', header: 'Definição', value: (r) => r.kpi.definition },
  ];

  const months = home.profitByMonth;
  const monthCols: CsvColumn<(typeof months)[number]>[] = [
    { key: 'month', header: 'Mês', value: (m) => m.month },
    { key: 'mrr', header: 'MRR real (R$)', kind: 'money-cents', value: (m) => m.mrrRealCents },
    { key: 'costs', header: 'Custos (R$)', kind: 'money-cents', value: (m) => m.costsCents },
    { key: 'profit', header: 'Lucro (R$)', kind: 'money-cents', value: (m) => m.profitCents },
  ];

  const mrr = home.mrrSeries.points;
  const mrrCols: CsvColumn<(typeof mrr)[number]>[] = [
    { key: 'start', header: 'Início', value: (p) => p.start },
    { key: 'end', header: 'Fim', value: (p) => p.end },
    { key: 'real', header: 'MRR real (R$)', kind: 'money-cents', value: (p) => p.realCents },
    { key: 'est', header: 'MRR estimado (R$)', kind: 'money-cents', value: (p) => p.estimatedCents },
    { key: 'subs', header: 'Assinaturas ativas', kind: 'integer', value: (p) => p.activeSubscriptions },
  ];

  const managed = home.managedSeries.points;
  const managedCols: CsvColumn<(typeof managed)[number]>[] = [
    { key: 'start', header: 'Início', value: (p) => p.start },
    { key: 'end', header: 'Fim', value: (p) => p.end },
    { key: 'expected', header: 'Gerenciado esperado (R$)', kind: 'money-cents', value: (p) => p.expectedCents },
    { key: 'received', header: 'Gerenciado recebido (R$)', kind: 'money-cents', value: (p) => p.receivedCents },
  ];

  const header = `Visão geral MyCarsHub;${dayLabel(home.meta.from)} a ${dayLabel(home.meta.to)};${
    home.meta.scope === 'all' ? 'Com contas internas' : 'Só clientes'
  }\r\n`;
  const sections = [
    buildCsv(kpiCols, kpiRows),
    buildCsv(mrrCols, mrr),
    buildCsv(monthCols, months),
    buildCsv(managedCols, managed),
    companies ? buildCsv(companies.columns, companies.rows) : null,
  ].filter((s): s is string => s !== null);
  const strip = (s: string) => s.replace(/^\uFEFF/, '');
  return '\uFEFF' + header + '\r\n' + sections.map(strip).join('\r\n');
}
