import { describe, expect, it } from 'vitest';

import type { RentalChargePreviewDto, RentalChargePreviewItemDto } from '../../../types/rental.types';
import { blockerCard, controlsOfServerError, readServerIssues } from './create-server';
import {
  completenessFrom,
  confirmModel,
  createdModel,
  missingRows,
  missingTitle,
} from './create-summary';

function item(kind: 'RENTAL_PERIOD' | 'CAUCAO', index: number, dueDate: string, amountCents: number, k = 1, n = 1): RentalChargePreviewItemDto {
  return { kind, index, dueDate, amountCents, destination: 'ASAAS', instalmentIndex: k, instalmentCount: n };
}

/** 4 semanas (2 com R$ 100 de desconto) + caução R$ 1.200 em 2 partes: 6 cobranças. */
const PREVIEW: RentalChargePreviewDto = {
  automaticCharge: true,
  willCreateInGateway: true,
  charges: [
    item('CAUCAO', 0, '2026-11-24', 60_000, 1, 2),
    item('RENTAL_PERIOD', 0, '2026-11-24', 50_000),
    item('RENTAL_PERIOD', 1, '2026-12-01', 50_000),
    item('CAUCAO', 0, '2026-12-08', 60_000, 2, 2),
    item('RENTAL_PERIOD', 2, '2026-12-08', 60_000),
    item('RENTAL_PERIOD', 3, '2026-12-15', 60_000),
  ],
  totalCents: 340_000,
  gatewayCount: 6,
  localCount: 0,
  firstDueDate: '2026-11-24',
  blocker: null,
};

const BASE = {
  preview: PREVIEW,
  frequency: 'WEEKLY' as const,
  periods: 4,
  startDate: '2026-11-24',
  endDate: '2026-12-22',
  firstDue: '2026-11-24',
  driverName: 'João Pedro Alves',
  plate: 'RDC-4A21',
  automatic: true,
  caucaoPaid: false,
  caucaoGrossCents: 120_000,
  useContractTemplate: true,
};

describe('o que falta (prancha FimF2)', () => {
  it('pronto = nenhum erro; o que falta = o primeiro erro do card', () => {
    expect(completenessFrom({})).toEqual({ complete: true, firstMissing: null });
    expect(completenessFrom({ vehicleId: 'Escolha o carro.', x: 'outro' })).toEqual({ complete: false, firstMissing: 'Escolha o carro.' });
    expect(completenessFrom({}, 'Digite o valor da caução.')).toEqual({ complete: false, firstMissing: 'Digite o valor da caução.' });
  });

  it('uma linha por card que falta, com o nome do card', () => {
    const rows = missingRows([
      { complete: false, firstMissing: 'Escolha o carro.' },
      { complete: true, firstMissing: null },
      { complete: true, firstMissing: null },
      { complete: true, firstMissing: null },
      { complete: false, firstMissing: 'Informe o km do carro na retirada.' },
    ]);
    expect(rows).toEqual([
      { card: 0, name: 'Motorista e veículo', text: 'Escolha o carro.' },
      { card: 4, name: 'Condições de pagamento', text: 'Informe o km do carro na retirada.' },
    ]);
    expect(missingTitle(2)).toBe('Faltam 2 coisas para criar');
    expect(missingTitle(1)).toBe('Falta 1 coisa para criar');
  });
});

describe('Confira antes de criar (pranchas FimF3/F4)', () => {
  it('cobranças automáticas: os totais do SERVIDOR, as linhas e a frase', () => {
    const m = confirmModel(BASE);
    expect([m.rentTotal, m.rentCaption]).toEqual(['R$ 2.200,00', '4 semanas, toda terça']);
    expect([m.caucaoTotal, m.caucaoCaption]).toEqual(['R$ 1.200,00', 'Em 2 partes. Volta no fim']);
    expect(m.rows.map((r) => [r.label, r.value, r.card])).toEqual([
      ['Motorista e carro', 'João Pedro Alves · RDC-4A21', 0],
      ['Período', '24/11 a 22/12 · 4 semanas', 1],
      ['1ª cobrança', 'Terça, 24/11', 4],
      ['Contrato', 'Gerado pelo seu modelo', 5],
      ['Cobrança', 'Cobranças automáticas', 6],
    ]);
    expect([m.count, m.countText, m.detail]).toEqual([6, '6 cobranças', '4 semanas e 2 partes da caução']);
    expect(m.lines[0]).toEqual({ key: '0', title: 'Caução, parte 1 de 2', date: 'Terça, 24/11', value: 'R$ 600,00' });
    expect(m.lines[1].title).toBe('Semana 1');
  });

  it('eu recebo por fora, caução recebida por fora, contrato por PDF', () => {
    const m = confirmModel({ ...BASE, automatic: false, caucaoPaid: true, useContractTemplate: false });
    expect(m.automatic).toBe(false);
    expect([m.caucaoTotal, m.caucaoCaption]).toEqual(['R$ 1.200,00', 'Recebida por fora. Volta no fim']);
    expect(m.rows[3].value).toBe('Você envia o PDF');
    expect(m.rows[4].value).toBe('Eu recebo por fora');
  });
});

describe('Aluguel criado (prancha FimF6)', () => {
  it('o subtítulo, quantas cobranças, a 1ª e o contrato; falhas da sincronização', () => {
    const m = createdModel({
      driverName: 'João Pedro Alves',
      plate: 'RDC-4A21',
      startDate: '2026-11-24',
      endDate: '2026-12-22',
      automatic: true,
      preview: PREVIEW,
      useContractTemplate: true,
      sync: { requested: 6, created: 4, failed: 2, local: 0 },
    });
    expect(m.subtitle).toBe('João Pedro Alves · RDC-4A21 · 24/11 a 22/12');
    expect(m.headline).toBe('6 cobranças na sua conta Asaas');
    expect(m.caption).toBe('A primeira vence terça, 24/11. O contrato foi gerado pelo seu modelo.');
    expect(m.syncFailed).toBe(2);
    expect(createdModel({ ...BASEDONE, automatic: false }).headline).toBe('6 cobranças anotadas');
  });
});

const BASEDONE = {
  driverName: 'A',
  plate: 'B',
  startDate: '2026-11-24',
  endDate: '2026-12-22',
  automatic: true,
  preview: PREVIEW,
  useContractTemplate: false,
  sync: null,
};

describe('recusas do servidor', () => {
  it('campo vira erro do campo e motivo com o card; integração sem o nome do provedor e com atalho', () => {
    const r = readServerIssues(
      [
        { field: 'vehicleId', code: 'VEHICLE_BUSY', message: 'O carro já está em outro aluguel.', acceptedValue: null, severity: 'BLOCKING' },
        { field: null, code: 'ASAAS_KEY_REVOKED', message: 'O Asaas recusou a chave.', acceptedValue: null, severity: 'BLOCKING' },
        { field: 'driver.cpf', code: 'DRIVER_CPF_MISSING', message: 'Falta o CPF do motorista.', acceptedValue: null, severity: 'BLOCKING' },
        { field: 'notes', code: 'X', message: 'aviso', acceptedValue: null, severity: 'WARNING' },
      ],
      'drv-1',
    );
    expect(r.fields).toEqual({ vehicleId: 'O carro já está em outro aluguel.' });
    expect(r.reasons.map((x) => [x.card, x.link?.label ?? null])).toEqual([
      [0, null],
      [6, 'Abrir Configurações > Integrações'],
      [0, 'Abrir o cadastro do motorista'],
    ]);
    expect(r.reasons[1].text).not.toMatch(/asaas/i);
  });
});

describe('recusas do servidor: o que as limpa e para onde voltam', () => {
  it('a recusa da caução depende do valor, do desconto, de "Recebi por fora" e das partes', () => {
    expect(controlsOfServerError('caucaoReais')).toEqual(
      expect.arrayContaining(['caucaoReais', 'caucaoDiscount', 'caucaoDescOn', 'caucaoPaid', '$caucaoParts']),
    );
    expect(controlsOfServerError('vehicleId')).toEqual(['vehicleId']);
  });

  it('bloqueio da prévia: o que fala da caução, ou um plano só da caução, volta ao card Caução', () => {
    const caucaoOnly = { discount: null, defaultSplit: null, overrides: [{ target: 'CAUCAO' }] };
    const periods = { discount: { type: 'AMOUNT' }, defaultSplit: null, overrides: [{ target: 'CAUCAO' }] };
    expect(blockerCard({ code: 'X', message: 'As parcelas da caução somam R$ 900,00.' }, periods)).toBe(2);
    expect(blockerCard({ code: 'CHARGE_DUE_DATE_PAST', message: 'As datas das parcelas precisam ser de hoje em diante.' }, caucaoOnly)).toBe(2);
    expect(blockerCard({ code: 'CHARGE_BELOW_MINIMUM', message: 'A parcela 1 ficou abaixo de R$ 5,00.' }, periods)).toBe(3);
    expect(blockerCard({ code: 'X', message: null }, null)).toBe(3);
  });
});
