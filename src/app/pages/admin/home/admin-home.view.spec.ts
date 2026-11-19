import { describe, expect, it } from 'vitest';

import { CHART_GREEN, CHART_GREYS, CHART_ORANGE } from '../../../components/charts/chart-tooltip/chart-tooltip';
import type { AdminHome, HomeKpi } from '../../../types/admin-home.types';
import { dueRows } from './home-upcoming';
import { topPeople } from './home-usage';
import {
  ACTION_FALLBACK,
  actionLabel,
  bucketLabels,
  buildHomeCsv,
  PAST_USERS_CLAUSE,
  countDelta,
  heatRows,
  nullText,
  percentDelta,
  ROLE_TONE,
  addDays,
  clampRange,
  movementsWindow,
  relativeTime,
  spanDays,
  valueDelta,
  vendorColors,
} from './admin-home.view';
import { HOME } from './admin-home.testing';

/**
 * Toda ação que o backend pode pôr no feed, copiada dos enums (18/11/2026): `AuditAction`
 * (audit_events), `AdminAuditAction` (admin_audit_log) e `PlatformMovementEvent` (ramos do feed).
 * Ação nova no backend entra aqui junto com o rótulo.
 */
const BACKEND_ACTIONS: readonly string[] = [
  // AuditAction
  'LOGIN_SUCCEEDED', 'COMPANY_SWITCHED', 'INVITE_ACCEPTED', 'RENTAL_CREATED', 'RENTAL_UPDATED',
  'RENTAL_ACTIVATED', 'RENTAL_CANCELED', 'RENTAL_COMPLETED', 'RENTAL_DELETED', 'CHARGE_MARKED_PAID',
  'CHARGE_UNMARKED_PAID', 'CAUCAO_CHARGE_CREATED', 'CAUCAO_MARKED_PAID', 'CAUCAO_UNMARKED_PAID',
  'CHARGE_CANCELED', 'CHARGE_RETRIED', 'CHARGE_RECONCILED', 'CHARGE_RECEIVED_OUTSIDE',
  'CHARGE_AGREEMENT_CREATED', 'CHARGE_ADJUSTMENT_CREATED', 'DRIVER_CREATED', 'DRIVER_UPDATED',
  'DRIVER_STATUS_CHANGED', 'DRIVER_PROFILE_UPDATED', 'DRIVER_USER_LINKED', 'DRIVER_DELETED',
  'VEHICLE_CREATED', 'VEHICLE_UPDATED', 'VEHICLE_STATUS_CHANGED', 'VEHICLE_DELETED',
  'VEHICLE_FIPE_REFRESHED', 'VEHICLE_SOLD', 'VEHICLE_SALE_UNDONE', 'FINANCING_CREATED',
  'FINANCING_PAID_OFF', 'FINANCING_DELETED', 'FINANCING_INSTALLMENT_PAID', 'FINANCING_INSTALLMENT_UNPAID',
  'MAINTENANCE_CREATED', 'MAINTENANCE_UPDATED', 'MAINTENANCE_CONCLUDED', 'MAINTENANCE_CANCELED',
  'MAINTENANCE_DELETED', 'FINE_CREATED', 'FINE_UPDATED', 'FINE_PAID', 'FINE_DELETED', 'INSURANCE_CREATED',
  'INSURANCE_UPDATED', 'INSURANCE_CANCELED', 'INSURANCE_DELETED', 'INSURANCE_INSTALLMENTS_GENERATED',
  'INSURANCE_INSTALLMENT_PAID', 'INSURANCE_INSTALLMENT_UNPAID', 'INSURANCE_INSTALLMENTS_DELETED',
  'IPVA_INSTALLMENTS_GENERATED', 'IPVA_INSTALLMENT_ADDED', 'IPVA_INSTALLMENT_UPDATED',
  'IPVA_INSTALLMENT_DELETED', 'IPVA_INSTALLMENT_PAID', 'IPVA_INSTALLMENT_UNPAID', 'EXPENSE_CREATED',
  'EXPENSE_UPDATED', 'EXPENSE_DELETED', 'HTTP_MUTATION',
  // AdminAuditAction
  'USER_STATUS_CHANGED', 'USER_SYSTEM_ROLE_CHANGED', 'USER_REMOVED', 'USER_INVITE_RESENT',
  'COMPANY_MEMBER_REMOVED', 'COMPANY_STATUS_CHANGED', 'COMPANY_INTERNAL_FLAG_CHANGED',
  'COMPANY_TRIAL_EXTENDED', 'FEEDBACK_TASK_STATUS_CHANGED', 'FEEDBACK_TASK_DELETED', 'BLOG_POST_CREATED',
  'BLOG_POST_UPDATED', 'BLOG_POST_PUBLISHED', 'BLOG_POST_UNPUBLISHED', 'BLOG_POST_DELETED',
  'SUPPORT_TICKET_STATUS_CHANGED', 'SUPPORT_TICKET_REPLIED', 'SUPPORT_TICKET_ASSIGNED',
  'IMPERSONATION_STARTED', 'IMPERSONATION_ENDED', 'IMPERSONATED_INVITES_LISTED',
  'ADMIN_COMPANY_ACCESS_GRANTED', 'SUPPORT_EDIT_REQUEST', 'SUPPORT_EDIT_STARTED', 'SUPPORT_EDIT_EXTENDED',
  'SUPPORT_EDIT_WRITE_CAP_REACHED', 'SUPPORT_EDIT_SIDE_EFFECT_SUPPRESSED', 'RENTAL_SCHEDULE_REGENERATED',
  'CONTRACT_TEMPLATE_SAVED', 'CONTRACT_AI_CONSENT_GIVEN', 'CONTRACT_DRAFT_DISCARDED',
  'NOTIFICATION_TEST_DISPATCHED', 'CHARGE_EMAIL_RESENT', 'USER_CONTACT_REVEALED', 'DRIVER_CONTACT_REVEALED',
  'COMPANY_CONTACT_REVEALED', 'CHARGE_ASAAS_COMPARED', 'CHARGE_MARKED_RECEIVED_OUTSIDE',
  'RENTAL_CHARGES_RENEGOTIATED', 'RENTAL_CHARGE_RECEIVED_OUTSIDE', 'RENTAL_CHARGE_AGREEMENT_NEEDS_ATTENTION',
  'CHARGE_RETRIED_BY_ADMIN', 'CHARGE_CANCELED_BY_ADMIN', 'DRIVER_NAME_CORRECTED',
  'DRIVER_ASAAS_CUSTOMER_SYNCED', 'ADMIN_ROLE_GRANTED', 'COUPON_CREATED', 'COUPON_APPLIED',
  'COUPON_DEACTIVATED', 'ADMIN_ROLE_CHANGED', 'ADMIN_ROLE_REVOKED', 'PLATFORM_VENDOR_CREATED',
  'PLATFORM_VENDOR_UPDATED', 'PLATFORM_COST_SET', 'PLATFORM_COST_DELETED', 'BILLING_REMINDER',
  'ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT_UPDATED', 'ANNOUNCEMENT_PUBLISHED', 'ANNOUNCEMENT_UNPUBLISHED',
  'ANNOUNCEMENT_DELETED', 'ANNOUNCEMENT_MEDIA_SET', 'ANNOUNCEMENT_MEDIA_REMOVED',
  // PlatformMovementEvent
  'USER_SIGNED_UP', 'COMPANY_CREATED', 'SUBSCRIPTION_STARTED', 'SUBSCRIPTION_CHANGED',
  'PLATFORM_PAYMENT_RECEIVED', 'RENTAL_CHARGE_PAID',
];

const kpi = (value: number | null, p: Partial<HomeKpi> = {}): HomeKpi => ({
  value,
  previous: null,
  previousAsOf: null,
  since: null,
  availableFrom: null,
  unit: 'CENTS',
  definition: 'd',
  nullReason: null,
  parts: {},
  ...p,
});

describe('admin-home.view', () => {
  it('percentDelta: sem anterior, ou anterior zero, não inventa porcentagem', () => {
    expect(percentDelta(kpi(100), 'x')).toBeNull();
    expect(percentDelta(kpi(100, { previous: 0 }), 'x')).toBeNull();
    expect(percentDelta(kpi(null, { previous: 10 }), 'x')).toBeNull();
    expect(percentDelta(kpi(118, { previous: 100 }), 'vs mês anterior')).toEqual({
      chip: '↗ 18%',
      text: 'vs mês anterior',
      tone: 'good',
    });
  });

  it('percentDelta: custo que sobe é ruim', () => {
    expect(percentDelta(kpi(110, { previous: 100 }), 'x', true)?.tone).toBe('bad');
    expect(percentDelta(kpi(90, { previous: 100 }), 'x', true)).toEqual({ chip: '↘ 10%', text: 'x', tone: 'good' });
  });

  it('countDelta: zero é neutro, nulo some', () => {
    expect(countDelta(0, 'novos')).toEqual({ chip: '0', text: 'novos', tone: 'neutral' });
    expect(countDelta(null, 'novos')).toBeNull();
  });

  it('nullText: cada motivo vira uma frase, nunca "0"', () => {
    expect(nullText(kpi(null, { nullReason: 'NO_COSTS' }), '2026-11')).toBe('nenhum custo lançado em novembro');
    expect(nullText(kpi(null, { nullReason: 'NO_DATA_YET', availableFrom: '2027-01-27' }), null)).toBe(
      'calcula a partir de 27/01/2027',
    );
    expect(nullText(kpi(null, { nullReason: 'NO_SNAPSHOT', since: '2026-11-05' }), null)).toBe(
      'sem foto antes de 05/11/2026',
    );
    expect(nullText(kpi(null, { since: '2026-10-29' }), null)).toBe('sem dado desde 29/10/2026');
  });

  it('bucketLabels: mês pelo nome (com ano quando cruza o ano), dia e semana por dd/MM', () => {
    expect(bucketLabels(['2026-10-01', '2026-11-01'], 'MONTH')).toEqual(['out', 'nov']);
    expect(bucketLabels(['2025-12-01', '2026-01-01'], 'MONTH')).toEqual(['dez/25', 'jan/26']);
    expect(bucketLabels(['2026-11-03'], 'WEEK')).toEqual(['03/11']);
  });

  it('relativeTime aceita o instante sem Z do feed (UTC)', () => {
    const now = Date.parse('2026-11-17T12:00:00Z');
    expect(relativeTime('2026-11-17T11:56:00', now)).toBe('há 4 min');
    expect(relativeTime('2026-11-17T10:00:00Z', now)).toBe('há 2 h');
    expect(relativeTime('2026-11-16T10:00:00Z', now)).toBe('ontem');
    expect(relativeTime(null, now)).toBeNull();
  });

  it('heatRows: segunda primeiro, faixas de 2 h, célula ausente é zero medido', () => {
    const rows = heatRows([
      { dow: 0, hour: 23, count: 2 },
      { dow: 1, hour: 9, count: 3 },
      { dow: 1, hour: 8, count: 1 },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
    expect(rows[0].values[4]).toBe(4);
    expect(rows[6].values[11]).toBe(2);
    expect(rows[2].values.every((v) => v === 0)).toBe(true);
  });

  it('actionLabel: conhecida em português; desconhecida em português, nunca o código cru', () => {
    expect(actionLabel('VEHICLE_CREATED')).toBe('Cadastrou um veículo');
    expect(actionLabel('PLATFORM_COST_SET')).toBe('Lançou um custo');
    expect(actionLabel('CHARGE_MARKED_PAID')).toBe('Marcou cobrança como paga');
    // Visto em produção (18/11): o feed mostrava o código em inglês.
    expect(actionLabel('SUPPORT_EDIT_STARTED')).toBe('Ligou o modo edição');
    expect(actionLabel('COMPANY_CONTACT_REVEALED')).toBe('Viu o contato de uma empresa');
    expect(actionLabel('CAUCAO_REFUNDED')).toBe(ACTION_FALLBACK);
    expect(actionLabel('')).toBe('—');
  });

  it('actionLabel: toda ação que o backend grava tem rótulo próprio', () => {
    for (const code of BACKEND_ACTIONS) {
      const label = actionLabel(code);
      expect(label, code).not.toBe(ACTION_FALLBACK);
      expect(label, code).not.toContain('_');
      expect(label.toUpperCase().replace(/ /g, '_'), code).not.toBe(code);
    }
  });

  it('actionLabel: "Http mutation" diz o que mudou pela rota, senão "Alteração registrada"', () => {
    const detail = (route: string) => `Ação sem registro específico: ${route}`;
    expect(actionLabel('HTTP_MUTATION', detail('POST /v1/vehicles/{vehicleId}/documents'))).toBe(
      'Enviou um documento do veículo',
    );
    expect(actionLabel('HTTP_MUTATION', detail('PUT /v1/companies/me'))).toBe('Atualizou os dados da empresa');
    expect(actionLabel('HTTP_MUTATION', detail('DELETE /v1/fines/{id}'))).toBe('Alteração em multas');
    expect(actionLabel('HTTP_MUTATION', detail('POST /v1/coisa-nova/{id}'))).toBe('Alteração registrada');
    expect(actionLabel('HTTP_MUTATION', null)).toBe('Alteração registrada');
    // Modo edição grava a rota no payload da trilha do admin.
    expect(
      actionLabel('SUPPORT_EDIT_REQUEST', 'method=POST status=200 durationMs=21 route=/v1/rentals/preflight'),
    ).toBe('Modo edição: conferiu os dados de um aluguel novo');
    expect(actionLabel('SUPPORT_EDIT_REQUEST', null)).toBe('Alterou dados no modo edição');
  });

  it('vendorColors: só cores da marca e cinzas; mais de 4 fornecedores = o maior laranja, o segundo verde', () => {
    const vendor = (id: string) => ({ vendorId: id, name: id, category: 'X', categoryLabel: null, billingDay: null, active: true });
    const home = (ids: string[], amounts: Record<string, number>): AdminHome => ({
      ...HOME,
      costs: {
        vendors: ids.map(vendor),
        months: [{ month: '2026-11', totalCents: null, byVendor: Object.entries(amounts).map(([vendorId, amountCents]) => ({ vendorId, amountCents })) }],
      },
    });
    const five = vendorColors(home(['a', 'b', 'c', 'd', 'e'], { a: 100, b: 900, c: 500, d: 10, e: 1 }));
    expect(five.get('b')).toBe(CHART_ORANGE);
    expect(five.get('c')).toBe(CHART_GREEN);
    for (const id of ['a', 'd', 'e']) expect(CHART_GREYS).toContain(five.get(id));
    // Nenhum hex fora da marca (roxo, rosa, azul...): tudo é token.
    for (const c of five.values()) expect(c.startsWith('var(--color-')).toBe(true);
    const two = vendorColors(home(['a', 'b'], {}));
    expect([two.get('a'), two.get('b')]).toEqual([CHART_ORANGE, CHART_GREEN]);
  });

  it('papel é chip neutro: só situação tem cor', () => {
    expect(ROLE_TONE).toBe('neutral');
  });

  it('clampRange: o fim nunca passa de hoje em São Paulo e a janela cabe no limite do servidor', () => {
    const today = '2026-11-18';
    expect(clampRange({ from: '2026-11-01', to: '2026-11-30' }, today)).toEqual({ from: '2026-11-01', to: '2026-11-18' });
    expect(clampRange({ from: '2026-11-19', to: '2026-11-19' }, today)).toEqual({ from: '2026-11-18', to: '2026-11-18' });
    expect(clampRange({ from: '2026-10-01', to: '2026-10-31' }, today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    const long = clampRange({ from: '2000-01-01', to: today }, today);
    expect(spanDays(long.from, long.to)).toBe(1827);
    expect(long.to).toBe(today);
  });

  it('movementsWindow: o feed segue o período, até 366 dias contados do fim', () => {
    expect(movementsWindow({ from: '2026-11-01', to: '2026-11-18' })).toEqual({ from: '2026-11-01', to: '2026-11-18' });
    const year = movementsWindow({ from: '2024-01-01', to: '2026-11-18' });
    expect(year.to).toBe('2026-11-18');
    expect(spanDays(year.from, year.to)).toBe(366);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('valueDelta: período contra o anterior; sem base não inventa porcentagem', () => {
    expect(valueDelta(150, 100, 'vs período anterior')).toEqual({ chip: '↗ 50%', text: 'vs período anterior', tone: 'good' });
    expect(valueDelta(50, 100, 'x')?.tone).toBe('bad');
    expect(valueDelta(10, 0, 'x')).toBeNull();
    expect(valueDelta(10, null, 'x')).toBeNull();
    expect(valueDelta(null, 10, 'x')).toBeNull();
  });

  it('dueRows: receber e pagar pela data; sem valor diz "sem valor"; interna sai em "Só clientes"', () => {
    const rows = dueRows(
      {
        from: '2026-11-17',
        until: '2026-12-16',
        receivables: [
          { companyId: 'a', companyName: 'Locadora A', internal: false, dueDate: '2026-11-20', planName: 'Pro', amountCents: 14_990, amountSource: 'LIST_PRICE' },
          { companyId: 'b', companyName: 'Interna', internal: true, dueDate: '2026-11-18', planName: 'Pro', amountCents: 14_990, amountSource: 'CHARGED' },
        ],
        payables: [{ vendorId: 'v', vendorName: 'Render', category: 'BACKEND', dueDate: '2026-11-19', amountCents: null, amountMonth: null }],
        vendorsWithoutBillingDay: 0,
        receivablesTotalCents: 14_990,
        payablesTotalCents: null,
      },
      'clients',
    );
    expect(rows.map((r) => r.label)).toEqual(['Pagar: Render', 'Receber: Locadora A · Pro']);
    expect(rows[0].value).toBe('sem valor');
    expect(rows[1].value.replace(/\s/g, ' ')).toBe('+ R$ 149,90');
    expect(rows[1].note).toBe('preço de tabela');
  });

  it('dueRows: dois custos do mesmo fornecedor no mesmo dia viram duas linhas com chaves distintas', () => {
    const payable = (description: string, costId: string | null, scheduleId: string) => ({
      vendorId: 'v-vercel', vendorName: 'Vercel', category: 'FRONTEND', dueDate: '2026-12-12', amountCents: 1_200,
      amountMonth: '2026-12', costId, scheduleId, kind: 'FIXED' as const, description,
    });
    const rows = dueRows(
      {
        from: '2026-11-18',
        until: '2026-12-17',
        receivables: [],
        payables: [payable('Plano Pro', null, 's1'), payable('Domínio', 'c2', 's2')],
        vendorsWithoutBillingDay: 0,
        receivablesTotalCents: 0,
        payablesTotalCents: 2_400,
      },
      'clients',
    );
    expect(rows.map((r) => r.label)).toEqual(['Pagar: Vercel · Plano Pro', 'Pagar: Vercel · Domínio']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(rows[0].note).toBe('previsto pelo custo fixo');
  });

  it('topPeople: sem captura de acessos, o ranking é de ações e diz isso', () => {
    const r = topPeople({
      meta: { period: '30d', scope: 'clients', from: '', to: '', generatedAt: '', actionsSince: '2026-11-16', accessSince: null },
      roles: [],
      owners: { vehiclesPerOwner: null, activeRentals: 0 },
      managers: { managersPerCompany: null, finesRegistered: 0 },
      drivers: { driverRecords: 0, withAppAccess: 0, activeRentals: 0 },
      topByActions: [{ userId: 'u', name: 'Ana', role: 'OWNER', companyId: null, companyName: null, actions: 1 }],
      topByAccess: [],
      actionsHeatmap: [],
      accessHeatmap: [],
      byUf: [],
      withoutUf: 0,
    });
    expect(r.byAccess).toBe(false);
    expect(r.people[0].value).toBe('1 ação');
  });

  it('buildHomeCsv: um BOM só, indicadores com motivo do nulo, dinheiro como número', () => {
    const csv = buildHomeCsv(HOME, null);
    expect(csv.match(/\uFEFF/g)).toHaveLength(1);
    expect(csv).toContain('MRR real;;569,10;;239,70;01/12/2025;;definição');
    expect(csv).toContain('Lucro do mês;;;;;;nenhum custo lançado em novembro;definição');
    expect(csv).toContain('Churn mensal;0%;');
  });

  it('buildHomeCsv: "Usuários" num período que já terminou diz que conta os ativos de hoje', () => {
    const live = buildHomeCsv(HOME, null);
    expect(live).not.toContain(PAST_USERS_CLAUSE);
    const past = buildHomeCsv({ ...HOME, meta: { ...HOME.meta, live: false } }, null);
    expect(past).toContain(`Usuários;69;;;;;;definição ${PAST_USERS_CLAUSE}`);
  });
});
