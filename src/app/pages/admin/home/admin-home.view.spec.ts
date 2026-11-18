import { describe, expect, it } from 'vitest';

import type { HomeKpi } from '../../../types/admin-home.types';
import { dueRows } from './home-upcoming';
import { topPeople } from './home-usage';
import {
  actionLabel,
  bucketLabels,
  buildHomeCsv,
  countDelta,
  heatRows,
  nullText,
  percentDelta,
  relativeTime,
  vendorColor,
} from './admin-home.view';
import { HOME } from './admin-home.testing';

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

  it('actionLabel: conhecida em português; desconhecida legível, nunca vazia', () => {
    expect(actionLabel('VEHICLE_CREATED')).toBe('Cadastrou um veículo');
    expect(actionLabel('PLATFORM_COST_SET')).toBe('Lançou um custo');
    expect(actionLabel('CHARGE_MARKED_PAID')).toBe('Marcou cobrança como paga');
    expect(actionLabel('CAUCAO_REFUNDED')).toBe('Caucao refunded');
  });

  it('vendorColor nunca é o laranja da marca', () => {
    for (let i = 0; i < 20; i++) expect(vendorColor(i).toLowerCase()).not.toBe('#f63b04');
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
    expect(rows[1].value.replace(/\s/g, ' ')).toBe('+ R$ 150');
    expect(rows[1].note).toBe('preço de tabela');
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
    expect(csv.match(/﻿/g)).toHaveLength(1);
    expect(csv).toContain('MRR real;;569,10;;239,70;01/12/2025;;definição');
    expect(csv).toContain('Lucro do mês;;;;;;nenhum custo lançado em novembro;definição');
    expect(csv).toContain('Churn mensal;0%;');
  });
});
