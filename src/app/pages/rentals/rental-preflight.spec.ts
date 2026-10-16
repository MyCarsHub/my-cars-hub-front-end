import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import {
  actionableIssues,
  buildChargeSchedule,
  controlFor,
  fineHelp,
  formatPercent,
  interestHelp,
  isLateInterestRequired,
  linkFor,
  messagesByControl,
  readPreflightError,
  summaryItems,
} from './rental-preflight';
import { RentalPreflightItem, RentalPreflightLimits } from '../../types/rental.types';

const item = (over: Partial<RentalPreflightItem>): RentalPreflightItem => ({
  field: null,
  code: 'INVALID_DATA',
  message: 'm',
  acceptedValue: null,
  severity: 'BLOCKING',
  ...over,
});

const LIMITS: RentalPreflightLimits = {
  interestPercentPerMonth: { min: 0, max: 10 },
  finePercent: { min: 0, max: 2.5 },
  fixedFineMaxCents: 24_999,
  minChargeCents: 500,
};

describe('rental-preflight — onde cada problema aparece', () => {
  it('campo do corpo da API vira o controle do formulário', () => {
    expect(controlFor(item({ field: 'periodRate' }))).toBe('periodRateReais');
    expect(controlFor(item({ field: 'lateFineValue' }))).toBe('lateFineValueInput');
    // O juros em R$/dia saiu da tela: tudo sobre ele cai no campo do %.
    expect(controlFor(item({ field: 'dailyInterestAmount' }))).toBe('lateInterestPercent');
  });

  it('driver.*, sem campo e campo sem controle com mensagem vão ao resumo', () => {
    expect(controlFor(item({ field: 'driver.email' }))).toBeNull();
    expect(controlFor(item({ field: null }))).toBeNull();
    expect(controlFor(item({ field: 'automaticCharge' }))).toBeNull();
  });

  it('obrigatório vazio e WARNING não contam como problema a corrigir', () => {
    const list = [
      item({ code: 'REQUIRED_FIELD', field: 'vehicleId' }),
      item({ severity: 'WARNING', code: 'ASAAS_LIMITS_UNAVAILABLE' }),
      item({ code: 'CHARGE_BELOW_MINIMUM', field: 'periodRate' }),
    ];
    expect(actionableIssues(list).map((i) => i.code)).toEqual(['CHARGE_BELOW_MINIMUM']);
  });

  it('só a primeira mensagem de cada campo é mantida', () => {
    const map = messagesByControl([
      item({ field: 'periodRate', message: 'primeira' }),
      item({ field: 'periodRate', message: 'segunda' }),
    ]);
    expect(map).toEqual({ periodRateReais: 'primeira' });
  });

  it('atalhos: motorista leva ao cadastro; integração, às Integrações; sem motorista escolhido, sem link', () => {
    const driver = item({ field: 'driver.document', code: 'DRIVER_DOCUMENT_MISSING' });
    expect(linkFor(driver, 'd-9')?.commands).toEqual(['/motoristas', 'd-9', 'editar']);
    expect(linkFor(driver, null)).toBeNull();
    const integ = item({ code: 'ASAAS_KEY_REVOKED' });
    expect(linkFor(integ, null)?.commands).toEqual(['/configuracoes/integracoes']);
    expect(linkFor(item({ code: 'DRIVER_NOT_FOUND' }), 'd-9')).toBeNull();
  });

  it('resumo traz só o que não tem campo', () => {
    const list = [
      item({ field: 'periodRate', code: 'CHARGE_BELOW_MINIMUM' }),
      item({ field: 'driver.phone', code: 'DRIVER_PHONE_INVALID' }),
    ];
    expect(summaryItems(list, 'd-1').map((s) => s.item.code)).toEqual(['DRIVER_PHONE_INVALID']);
  });
});

describe('rental-preflight — corpo do 400', () => {
  const bad = (body: unknown, status = 400): HttpErrorResponse =>
    new HttpErrorResponse({ status, error: body });

  it('lê issues e limits do 400', () => {
    const parsed = readPreflightError(
      bad({ issues: [{ field: 'periodRate', code: 'X', message: 'm', severity: 'BLOCKING' }], limits: LIMITS }),
    );
    expect(parsed?.issues[0]).toMatchObject({ field: 'periodRate', code: 'X', severity: 'BLOCKING' });
    expect(parsed?.limits).toEqual(LIMITS);
  });

  it('corpo sem lista, lista vazia ou outro status: não é o corpo do preflight', () => {
    expect(readPreflightError(bad({ message: 'x' }))).toBeNull();
    expect(readPreflightError(bad({ issues: [] }))).toBeNull();
    expect(readPreflightError(bad({ issues: [{ code: 'X', message: 'm' }] }, 409))).toBeNull();
    expect(readPreflightError(new Error('boom'))).toBeNull();
  });

  it('LATE_INTEREST_PERCENT_REQUIRED: no code, em issues ou num corpo de texto', () => {
    expect(isLateInterestRequired(bad({ code: 'LATE_INTEREST_PERCENT_REQUIRED' }))).toBe(true);
    expect(isLateInterestRequired(bad({ issues: [{ code: 'LATE_INTEREST_PERCENT_REQUIRED' }] }))).toBe(true);
    expect(isLateInterestRequired(bad('{"code":"LATE_INTEREST_PERCENT_REQUIRED"}'))).toBe(true);
    expect(isLateInterestRequired(bad({ code: 'OUTRO' }))).toBe(false);
    expect(isLateInterestRequired(bad('texto puro'))).toBe(false);
    expect(isLateInterestRequired(bad({ code: 'LATE_INTEREST_PERCENT_REQUIRED' }, 500))).toBe(false);
  });
});

describe('rental-preflight — textos de ajuda vindos de limits', () => {
  it('formatPercent usa vírgula e não deixa zeros à direita', () => {
    expect(formatPercent(2)).toBe('2%');
    expect(formatPercent(1.5)).toBe('1,5%');
    expect(formatPercent(0.25)).toBe('0,25%');
  });

  it('juros: faixa + equivalência (valor x % / 30); sem % digitado, só a faixa', () => {
    expect(interestHelp(LIMITS, 300_000, null)).toBe(
      'Faixa aceita: de 0% a 10% ao mês. Deixe vazio ou 0 para não cobrar.',
    );
    expect(interestHelp(LIMITS, 300_000, 150)).toContain(
      'Equivale a cerca de R$ 1,50 por dia de atraso sobre R$ 3.000,00.',
    );
  });

  it('juros sem limits ainda explica o formato', () => {
    expect(interestHelp(null, null, null)).toContain('Percentual ao mês');
  });

  it('teto não configurado vira "a partir de"', () => {
    const open: RentalPreflightLimits = { ...LIMITS, interestPercentPerMonth: { min: 0, max: null } };
    expect(interestHelp(open, null, null)).toContain('a partir de 0%');
  });

  it('multa: % mostra a faixa; R$ mostra "menor que" a menor cobrança (teto + 1 centavo)', () => {
    expect(fineHelp('PERCENT', LIMITS)).toBe('Faixa aceita: de 0% a 2,5% do valor da cobrança.');
    expect(fineHelp('FIXED', LIMITS)).toBe('Menor que R$ 250,00 (valor de cada cobrança).');
  });

  it('multa em R$ sem cobrança que carregue encargos (teto nulo) cai no texto neutro', () => {
    expect(fineHelp('FIXED', { ...LIMITS, fixedFineMaxCents: null })).toContain('em reais');
    expect(fineHelp('FIXED', null)).toContain('em reais');
  });
});

describe('rental-preflight — prévia de cada cobrança', () => {
  const preview = {
    automaticCharge: true,
    willCreateInGateway: true,
    charges: [
      { kind: 'RENTAL_PERIOD' as const, index: 0, dueDate: '2026-08-05', amountCents: 250_000, destination: 'ASAAS' as const },
      { kind: 'CAUCAO' as const, index: 0, dueDate: '2026-08-01', amountCents: 80_000, destination: 'LOCAL' as const },
    ],
    totalCents: 330_000,
    gatewayCount: 1,
    localCount: 1,
    firstDueDate: '2026-08-01',
    blocker: null,
  };

  it('multa % e juros saem como foram enviados; caução não leva encargos', () => {
    const rows = buildChargeSchedule(preview, {
      lateFineType: 'PERCENT',
      lateFineValue: 250,
      lateInterestPercentPerMonth: 1.5,
    });
    expect(rows[0]).toMatchObject({
      title: 'Cobrança 1',
      due: '05/08/2026',
      amount: 'R$ 2.500,00',
      fine: 'Multa 2,5%',
      interest: 'Juros 1,5% ao mês',
      destination: 'Vai ao Asaas',
    });
    expect(rows[1]).toMatchObject({
      title: 'Caução',
      fine: null,
      interest: null,
      destination: 'Fica só registrada aqui',
    });
  });

  it('multa fixa em reais e sem juros', () => {
    const rows = buildChargeSchedule(preview, { lateFineType: 'FIXED', lateFineValue: 5_000 });
    expect(rows[0].fine).toBe('Multa R$ 50,00');
    expect(rows[0].interest).toBe('Sem juros');
  });
});
