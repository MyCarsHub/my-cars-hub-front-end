import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { RenewalPreviewDto } from '../../../types/rental-renewal.types';
import {
  chargesModel,
  defaultAmount,
  defaultUnit,
  endingNotice,
  fitToMax,
  minimumTermLabel,
  newEndTail,
  localNewEnd,
  overdueText,
  rateHint,
  renewErrorMessage,
  renewalsLabel,
  renewedNotice,
  sayText,
  takenMaxEnd,
  totalCaption,
  vehicleTakenText,
} from './renewal';

/** A prancha RenR2/R3: 4 semanas a mais depois de 22/12, R$ 600,00 cada, toda terça. */
const PREVIEW: RenewalPreviewDto = {
  previousEndDate: '2026-12-22',
  newEndDate: '2027-01-19',
  additionalDays: 28,
  periodRate: 60_000,
  periods: [
    { index: 4, startDate: '2026-12-22', endDate: '2026-12-28', dueDate: '2026-12-22', amountCents: 60_000, destination: 'ASAAS' },
    { index: 5, startDate: '2026-12-29', endDate: '2027-01-04', dueDate: '2026-12-29', amountCents: 60_000, destination: 'ASAAS' },
    { index: 6, startDate: '2027-01-05', endDate: '2027-01-11', dueDate: '2027-01-05', amountCents: 60_000, destination: 'ASAAS' },
    { index: 7, startDate: '2027-01-12', endDate: '2027-01-18', dueDate: '2027-01-12', amountCents: 60_000, destination: 'ASAAS' },
  ],
  addedTotalCents: 240_000,
  newTotalAmount: 480_000,
  gatewayCount: 4,
  localCount: 0,
  overdueCount: 0,
  blocker: null,
};

function apiError(status: number, body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body });
}

describe('renovação — detalhe do aluguel (RenR1/R6)', () => {
  it('"Termina em 7 dias, em 22/12" de 7 dias antes até o dia; nada antes disso', () => {
    expect(endingNotice('2026-12-22', '2026-12-15')).toEqual({
      tone: 'orange',
      title: 'Termina em 7 dias, em 22/12',
      text: 'Renove para continuar cobrando, ou encerre quando ele devolver o carro.',
    });
    expect(endingNotice('2026-12-22', '2026-12-21')?.title).toBe('Termina em 1 dia, em 22/12');
    expect(endingNotice('2026-12-22', '2026-12-22')?.title).toBe('Termina hoje, em 22/12');
    expect(endingNotice('2026-12-22', '2026-12-14')).toBeNull();
  });

  it('fim que já passou: o mesmo aviso dizendo que passou', () => {
    expect(endingNotice('2026-12-22', '2026-12-23')?.title).toBe('Terminou em 22/12 e continua ativo');
  });

  it('renovado: verde, com o fim novo e para onde foram as cobranças', () => {
    expect(renewedNotice('2027-01-19', 4, 4)).toEqual({
      tone: 'green',
      title: 'Aluguel renovado até 19/01/2027',
      text: '4 cobranças novas na sua conta Asaas. O motorista recebeu um aviso por e-mail.',
    });
    expect(renewedNotice('2027-01-19', 1, 0).text).toBe(
      '1 cobrança nova anotada no aluguel. O motorista recebeu um aviso por e-mail.',
    );
  });

  it('"Tempo mínimo" na unidade do aluguel e "Renovações"', () => {
    expect(minimumTermLabel(28, 'WEEKLY')).toBe('4 semanas');
    expect(minimumTermLabel(90, 'MONTHLY')).toBe('3 meses');
    expect(minimumTermLabel(30, 'WEEKLY')).toBe('30 dias');
    expect(minimumTermLabel(null, 'WEEKLY')).toBeNull();
    expect(renewalsLabel(0)).toBe('Nenhuma');
    expect(renewalsLabel(undefined)).toBe('Nenhuma');
    expect(renewalsLabel(2)).toBe('2');
  });
});

describe('renovação — folha (RenR2–R5)', () => {
  it('padrões: a unidade da frequência e o tempo mínimo nela', () => {
    expect(defaultUnit('WEEKLY')).toBe('WEEKS');
    expect(defaultUnit('DAILY')).toBe('DAYS');
    expect(defaultUnit('MONTHLY')).toBe('MONTHS');
    expect(defaultAmount(28, 'WEEKS')).toBe(4);
    expect(defaultAmount(30, 'WEEKS')).toBe(1);
    expect(defaultAmount(null, 'WEEKS')).toBe(1);
  });

  it('"Novo fim: 19/01/2027 (4 semanas depois de 22/12)." e mês = 30 dias', () => {
    expect(localNewEnd('2026-12-22', 4, 'WEEKS')).toBe('2027-01-19');
    expect(localNewEnd('2026-12-22', 1, 'MONTHS')).toBe('2027-01-21');
    expect(newEndTail('2026-12-22', 4, 'WEEKS')).toBe('(4 semanas depois de 22/12).');
  });

  it('dica do valor e o total pintado', () => {
    expect(rateHint(60_000, 'WEEKLY')).toBe('Hoje é R$ 600,00. O valor novo vale só para as semanas novas.');
    expect(rateHint(10_000, 'DAILY')).toBe('Hoje é R$ 100,00. O valor novo vale só para os dias novos.');
    expect(totalCaption(PREVIEW, 'WEEKLY')).toBe('4 cobranças novas, toda terça, de 22/12 a 12/01');
  });

  it('"Cobranças da renovação" (RenR3)', () => {
    const m = chargesModel(PREVIEW, 'WEEKLY');
    expect(m.label).toBe('Renovação');
    expect(m.total).toBe('R$ 2.400,00');
    expect(m.caption).toBe('4 semanas, de 22/12 a 19/01');
    expect(m.rows.map((r) => [r.day, r.weekday, r.title, r.sub, r.amount])).toEqual([
      ['22/12', 'terça', 'Semana 5', 'até 28/12', 'R$ 600,00'],
      ['29/12', 'terça', 'Semana 6', 'até 04/01', 'R$ 600,00'],
      ['05/01', 'terça', 'Semana 7', 'até 11/01', 'R$ 600,00'],
      ['12/01', 'terça', 'Semana 8', 'até 18/01', 'R$ 600,00'],
    ]);
    expect(m.note).toBe('Sem desconto e sem parcelas. A caução continua a mesma.');
  });

  it('cobrança atrasada (RenR4) e a frase do envio', () => {
    expect(overdueText(0)).toBeNull();
    expect(overdueText(1)).toEqual({
      lead: 'Ele tem 1 cobrança atrasada.',
      rest: 'Ela continua como está. A renovação só cria as novas.',
    });
    expect(overdueText(2)?.lead).toBe('Ele tem 2 cobranças atrasadas.');
    const say = sayText(PREVIEW)!;
    expect(`${say.before}${say.bold}${say.after}`).toBe(
      'Ao renovar, as 4 cobranças vão para a sua conta Asaas agora, e o motorista recebe um aviso com o novo fim.',
    );
    const local = sayText({ ...PREVIEW, gatewayCount: 0, localCount: 4 })!;
    expect(local.after).toContain('ficam anotadas no aluguel');
  });

  it('carro com outra reserva (RenR5): cabe na unidade; senão em dias; sem espaço, não dá', () => {
    expect(fitToMax('2026-12-22', '2027-01-05', 'WEEKS')).toEqual({ amount: 2, unit: 'WEEKS' });
    expect(fitToMax('2026-12-22', '2026-12-25', 'WEEKS')).toEqual({ amount: 3, unit: 'DAYS' });
    expect(fitToMax('2026-12-22', '2026-12-22', 'WEEKS')).toBeNull();
    expect(vehicleTakenText('2026-12-22', '2027-01-05', { amount: 2, unit: 'WEEKS' })).toEqual({
      lead: 'O carro tem outra reserva a partir de 05/01.',
      rest: 'Dá para renovar até 05/01 (2 semanas).',
    });
  });

  it('erros do renew: 409, 403, rede e o maxEndDate do VEHICLE_PERIOD_TAKEN', () => {
    expect(renewErrorMessage(apiError(409, { code: 'RENEWAL_STALE', message: 'x' }))).toContain('O fim do aluguel mudou');
    expect(renewErrorMessage(apiError(409, { code: 'RENEWAL_NOT_ACTIVE', message: 'Este aluguel já foi encerrado.' }))).toBe(
      'Este aluguel já foi encerrado.',
    );
    expect(renewErrorMessage(apiError(403, { code: 'CHARGES_FLEX_DISABLED' }))).toBe(
      'Você não tem permissão para renovar este aluguel.',
    );
    expect(renewErrorMessage(apiError(0, null))).toContain('Sem conexão');
    expect(renewErrorMessage(apiError(400, { code: 'RENEWAL_END_IN_PAST', message: 'O novo fim fica antes de hoje.' }))).toBe(
      'O novo fim fica antes de hoje.',
    );
    expect(takenMaxEnd(apiError(409, { code: 'VEHICLE_PERIOD_TAKEN', reason: '2027-01-05' }))).toBe('2027-01-05');
    expect(takenMaxEnd(apiError(409, { code: 'VEHICLE_PERIOD_TAKEN', reason: null }))).toBeNull();
    expect(takenMaxEnd(apiError(409, { code: 'RENEWAL_STALE' }))).toBeNull();
  });
});
