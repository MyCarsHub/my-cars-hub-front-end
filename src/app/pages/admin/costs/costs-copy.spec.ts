import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import {
  addMonths,
  costErrorMessage,
  currentMonth,
  dayMonth,
  entryRows,
  fixedRows,
  isStale,
  lastDayOf,
  latestOfChain,
  monthName,
  monthSplit,
  runningFixed,
} from './costs-copy';
import { cost, schedule } from './costs.testing';

const nbsp = (s: string) => s.replace(/\s/g, ' ');

describe('costs-copy — meses e datas', () => {
  it('meses em texto, sem passar pelo fuso do navegador', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthName('2026-11')).toBe('novembro de 2026');
    expect(dayMonth('2026-11-05')).toBe('05/11');
    expect(dayMonth(null)).toBe('—');
    expect(lastDayOf('2026-02')).toBe('2026-02-28');
    expect(lastDayOf('2026-11')).toBe('2026-11-30');
  });

  it('o mês corrente é o de São Paulo (00:30 UTC de 1º/12 ainda é novembro lá)', () => {
    expect(currentMonth(new Date('2026-12-01T00:30:00Z'))).toBe('2026-11');
  });
});

describe('costs-copy — custos fixos', () => {
  it('uma linha por cadeia (só o último), período desde o começo da cadeia', () => {
    const old = schedule({ id: 'old', amountCents: 10_000, endMonth: '2026-07', status: 'ENDED', latest: false, startMonth: '2026-01' });
    const cur = schedule({ id: 'cur', previousScheduleId: 'old', startMonth: '2026-08' });
    const rows = fixedRows([cur, old]);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Vercel · Plano Pro');
    expect(rows[0].periodText).toBe('desde 01/2026, sem fim');
    expect(rows[0].chip).toEqual({ label: 'Ativo', tone: 'green' });
    expect(nbsp(rows[0].amountText)).toBe('R$ 110,00');
  });

  it('mudança agendada mostra o valor de hoje e o novo "a partir de"; continua ativo', () => {
    const now = schedule({ id: 'now', endMonth: '2026-11', latest: false });
    const next = schedule({ id: 'next', previousScheduleId: 'now', amountCents: 12_000, startMonth: '2026-12', status: 'SCHEDULED' });
    const [row] = fixedRows([next, now]);
    expect(row.schedule.id).toBe('next');
    expect(row.amountCents).toBe(11_000);
    expect(nbsp(row.pendingText!)).toBe('R$ 120,00 a partir de 12/2026');
    expect(row.running).toBe(true);
    expect(row.chip.label).toBe('Ativo');
  });

  it('chips: termina, começa e encerrado (cor só no chip)', () => {
    const rows = fixedRows([
      schedule({ id: 'a', endMonth: '2026-12' }),
      schedule({ id: 'b', status: 'SCHEDULED', startMonth: '2027-01' }),
      schedule({ id: 'c', status: 'ENDED', endMonth: '2026-09' }),
    ]);
    expect(rows.map((r) => r.chip)).toEqual([
      { label: 'Termina em 12/2026', tone: 'amber' },
      { label: 'Começa em 01/2027', tone: 'blue' },
      { label: 'Encerrado', tone: 'neutral' },
    ]);
  });

  it('fixos ativos: só os que rodam no mês corrente', () => {
    const rows = fixedRows([
      schedule({ id: 'a', amountCents: 11_000 }),
      schedule({ id: 'b', amountCents: 1_200, service: 'Domínio' }),
      schedule({ id: 'c', status: 'ENDED', amountCents: 3_500 }),
      schedule({ id: 'd', status: 'SCHEDULED', amountCents: 999 }),
    ]);
    expect(runningFixed(rows)).toEqual({ count: 2, cents: 12_200 });
  });

  it('latestOfChain segue a cadeia até o último', () => {
    const list = [
      schedule({ id: 'a', latest: false }),
      schedule({ id: 'b', previousScheduleId: 'a', latest: false }),
      schedule({ id: 'c', previousScheduleId: 'b' }),
    ];
    expect(latestOfChain(list, 'a')?.id).toBe('c');
    expect(latestOfChain(list, 'c')?.id).toBe('c');
    expect(latestOfChain(list, 'zzz')).toBeNull();
  });
});

describe('costs-copy — lançamentos do mês', () => {
  it('fixo editado mostra "editado" e o valor do fixo; avulso não', () => {
    const [fixed, oneOff] = entryRows([
      cost(),
      cost({ id: 'c2', kind: 'ONE_OFF', scheduleId: null, scheduleAmountCents: null, overridden: false, description: 'Upgrade', dueDate: null, note: null }),
    ]);
    expect(fixed.kind).toBe('Fixo');
    expect(fixed.edited).toBe(true);
    expect(nbsp(fixed.fixedText!)).toBe('fixo: R$ 140,00');
    expect(fixed.dueText).toBe('05/11');
    expect(oneOff.kind).toBe('Avulso');
    expect(oneOff.edited).toBe(false);
    expect(oneOff.fixedText).toBeNull();
    expect(oneOff.note).toBe('—');
  });

  it('monthSplit separa fixos de avulsos (legado conta como avulso)', () => {
    expect(
      monthSplit([
        cost({ amountCents: 100 }),
        cost({ kind: 'ONE_OFF', amountCents: 20 }),
        cost({ kind: 'LEGACY', amountCents: 3 }),
      ]),
    ).toEqual({ fixedCents: 100, oneOffCents: 23 });
  });
});

describe('costs-copy — erros', () => {
  const http = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

  it('códigos do servidor viram o que fazer', () => {
    expect(costErrorMessage(http(403, null))).toContain('Dono');
    expect(costErrorMessage(http(409, { code: 'VENDOR_INACTIVE', message: 'x' }))).toContain('desativado');
    expect(costErrorMessage(http(409, { code: 'VENDOR_HAS_RUNNING_FIXED_COSTS' }))).toContain('Encerre');
    expect(costErrorMessage(http(400, { message: 'm', fieldErrors: { amountCents: 'valor alto' } }))).toBe('valor alto');
    expect(costErrorMessage(http(500, null))).toBe('Não foi possível salvar. Tente de novo.');
  });

  it('409 mostra a frase do servidor: a mudança posterior, o custo lançado à mão, o lançamento que mudou', () => {
    const later =
      'Este custo fixo já tem uma mudança de valor depois dele: R$ 120,00 a partir de 12/2026. Edite essa mudança em vez deste valor antigo.';
    expect(costErrorMessage(http(409, { code: 'SCHEDULE_NOT_LATEST', message: later, fieldErrors: { id: later } }))).toBe(
      later,
    );
    const legacy =
      'Já existe um custo lançado à mão para Render em 10/2026; apague-o antes de criar o custo fixo nesse período, senão o gasto conta duas vezes.';
    expect(
      costErrorMessage(http(409, { code: 'LEGACY_COST_OVERLAP', message: legacy, fieldErrors: { startMonth: 'outra' } })),
    ).toBe(legacy);
    expect(costErrorMessage(http(409, { code: 'COST_ROW_CHANGED', message: 'Recarregue a lista.' }))).toBe(
      'Recarregue a lista.',
    );
    // Servidor sem mensagem: o texto daqui.
    expect(costErrorMessage(http(409, { code: 'SCHEDULE_NOT_LATEST' }))).toContain('recarregada');
  });

  it('404, SCHEDULE_NOT_LATEST e COST_ROW_CHANGED pedem recarga; LEGACY_COST_OVERLAP não', () => {
    expect(isStale(http(404, null))).toBe(true);
    expect(isStale(http(409, { code: 'SCHEDULE_NOT_LATEST' }))).toBe(true);
    expect(isStale(http(409, { code: 'COST_ROW_CHANGED' }))).toBe(true);
    expect(isStale(http(409, { code: 'LEGACY_COST_OVERLAP' }))).toBe(false);
    expect(isStale(http(409, { code: 'VENDOR_INACTIVE' }))).toBe(false);
  });
});
