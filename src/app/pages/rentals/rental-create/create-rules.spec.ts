import { describe, expect, it } from 'vitest';

import { periodWords } from '../rental-wizard/wizard-format';
import {
  CaucaoRulesValue,
  ChargesRulesContext,
  ChargesRulesValue,
  PeriodValue,
  caucaoAmounts,
  caucaoErrors,
  chargesErrors,
  discountHint,
  driverVehicleErrors,
  firstNOptions,
  onWeekday,
  partDueOptions,
  periodErrors,
  periodSentence,
  rateHint,
} from './create-rules';

const PERIOD: PeriodValue = {
  startDate: '2026-11-24',
  pickupTime: '09:00',
  pickupOtherDay: false,
  pickupDay: '',
  endDate: '2026-12-22',
};

describe('Card 1 · Motorista e veículo — validação', () => {
  it('sem motorista e sem carro: os dois erros, com a copy do passo a passo', () => {
    expect(driverVehicleErrors({ driverId: '', vehicleId: '' })).toEqual({
      driverId: 'Escolha quem vai levar o carro.',
      vehicleId: 'Escolha o carro.',
    });
  });

  it('os dois escolhidos: nenhum erro', () => {
    expect(driverVehicleErrors({ driverId: 'drv-1', vehicleId: 'veh-1' })).toEqual({});
  });
});

describe('Card 2 · Período — validação', () => {
  it('período completo: nenhum erro', () => {
    expect(periodErrors(PERIOD)).toEqual({});
  });

  it('vazio: pede a retirada e a devolução', () => {
    const e = periodErrors({ ...PERIOD, startDate: '', endDate: '' });
    expect(e['startDate']).toBe('Escolha o dia em que ele pega o carro.');
    expect(e['endDate']).toBe('Escolha o dia da devolução.');
  });

  it('devolução no mesmo dia ou antes da retirada é recusada', () => {
    expect(periodErrors({ ...PERIOD, endDate: '2026-11-24' })['endDate']).toBe(
      'A devolução precisa ser depois da retirada.',
    );
    expect(periodErrors({ ...PERIOD, endDate: '2026-11-20' })['endDate']).toBe(
      'A devolução precisa ser depois da retirada.',
    );
  });

  it('hora fora de horas:minutos é recusada', () => {
    expect(periodErrors({ ...PERIOD, pickupTime: '' })['pickupTime']).toContain('Hora inválida');
    expect(periodErrors({ ...PERIOD, pickupTime: '24:00' })['pickupTime']).toContain('Hora inválida');
  });

  it('retirada em outro dia: precisa do dia, e ele precisa estar dentro do período', () => {
    const on = { ...PERIOD, pickupOtherDay: true };
    expect(periodErrors(on)['pickupDay']).toBe('Escolha o dia da retirada.');
    expect(periodErrors({ ...on, pickupDay: '2026-12-23' })['pickupDay']).toBe(
      'A retirada precisa ser entre 24/11 e 22/12.',
    );
    expect(periodErrors({ ...on, pickupDay: '2026-11-26' })).toEqual({});
    // Desligado, o dia guardado não vale nada.
    expect(periodErrors({ ...PERIOD, pickupDay: '2027-05-01' })).toEqual({});
  });
});

describe('Card 2 · Período — a frase', () => {
  it('"De 24/11 a 22/12. São 4 semanas." (prancha F4)', () => {
    expect(periodSentence('2026-11-24', '2026-12-22', 'WEEKLY')).toEqual({
      range: '24/11 a 22/12',
      endLong: 'terça, 22/12',
      length: '4 semanas',
    });
  });

  it('fração de semana conta a semana inteira, como o servidor; por dia, os dias', () => {
    expect(periodSentence('2026-11-24', '2026-12-23', 'WEEKLY')?.length).toBe('5 semanas');
    expect(periodSentence('2026-11-24', '2026-11-25', 'DAILY')?.length).toBe('1 dia');
  });

  it('sem período válido: sem frase', () => {
    expect(periodSentence('', '2026-12-22', 'WEEKLY')).toBeNull();
    expect(periodSentence('2026-11-24', '2026-11-24', 'WEEKLY')).toBeNull();
  });

  it('"na terça" e "no sábado" no rodapé do calendário', () => {
    expect(onWeekday('2026-11-24')).toEqual({ article: 'na', day: 'terça, 24/11' });
    expect(onWeekday('2026-11-28')).toEqual({ article: 'no', day: 'sábado, 28/11' });
    expect(onWeekday('')).toBeNull();
  });
});

describe('Card 3 · Caução — validação e valor líquido', () => {
  const CAU: CaucaoRulesValue = {
    caucaoReais: '1.200,00',
    caucaoPaid: false,
    caucaoDescOn: false,
    caucaoDiscount: '',
    caucaoSplit: false,
    parts: [],
  };
  const ctx = { today: '2026-11-20', minCents: 1 };

  it('valor cheio sem erro; vazio = sem caução, também sem erro', () => {
    expect(caucaoErrors(CAU, ctx)).toEqual({});
    expect(caucaoErrors({ ...CAU, caucaoReais: '' }, ctx)).toEqual({});
  });

  it('desconto: líquido = valor − desconto; precisa ser maior que zero e menor que o valor', () => {
    const on = { ...CAU, caucaoDescOn: true, caucaoDiscount: '200,00' };
    expect(caucaoAmounts(on)).toEqual({ gross: 120_000, discount: 20_000, net: 100_000 });
    expect(caucaoErrors(on, ctx)).toEqual({});
    expect(caucaoErrors({ ...on, caucaoDiscount: '1.200,00' }, ctx)['caucaoDiscount']).toContain('menor que R$ 1.200,00');
    expect(caucaoErrors({ ...on, caucaoDiscount: '' }, ctx)['caucaoDiscount']).toContain('maior que zero');
  });

  it('"Recebi por fora" ignora desconto e partes: o valor cheio é o anotado', () => {
    const paid = { ...CAU, caucaoPaid: true, caucaoDescOn: true, caucaoDiscount: '5.000,00', caucaoSplit: true };
    expect(caucaoAmounts(paid).net).toBe(120_000);
    expect(caucaoErrors(paid, ctx)).toEqual({});
  });

  it('partes precisam somar a caução LÍQUIDA', () => {
    const split = {
      ...CAU,
      caucaoDescOn: true,
      caucaoDiscount: '200,00',
      caucaoSplit: true,
      parts: [
        { amount: '600,00', due: '2026-11-24' },
        { amount: '600,00', due: '2026-12-08' },
      ],
    };
    expect(caucaoErrors(split, ctx)['caucaoPartsSum']).toBe(
      'As partes somam R$ 1.200,00. Precisam somar R$ 1.000,00, a caução.',
    );
    const ok = {
      ...split,
      parts: [
        { amount: '500,00', due: '2026-11-24' },
        { amount: '500,00', due: '2026-12-08' },
      ],
    };
    expect(caucaoErrors(ok, ctx)).toEqual({});
  });

  it('cada parte: valor, data de hoje em diante e em ordem', () => {
    const e = caucaoErrors(
      {
        ...CAU,
        caucaoSplit: true,
        parts: [
          { amount: '', due: '2026-11-19' },
          { amount: '1.200,00', due: '2026-11-25' },
          { amount: '0,00', due: '2026-11-24' },
        ],
      },
      ctx,
    );
    expect(e['cauPart0']).toBe('Digite o valor desta parte.');
    expect(e['cauDue0']).toBe('A data precisa ser de hoje em diante.');
    expect(e['cauDue2']).toBe('Precisa vencer no mesmo dia ou depois da parte anterior.');
  });
});

describe('Card 4 · Cobranças — validação e frases', () => {
  const V: ChargesRulesValue = {
    periodRateReais: '600,00',
    descOn: false,
    discountN: '1',
    discountValue: '',
    parcOn: false,
    splitScope: 'ALL',
    parts: [],
  };
  const C: ChargesRulesContext = {
    words: periodWords('WEEKLY'),
    periods: 4,
    minCents: 1,
    selected: [],
    stale: [],
    past: [],
    smallestPart: null,
  };
  const TUE_FRI = [
    { amount: '300,00', offset: 0 },
    { amount: '300,00', offset: 3 },
  ];

  it('sem valor: pede quanto ele paga por semana', () => {
    expect(chargesErrors({ ...V, periodRateReais: '' }, C)['periodRateReais']).toBe(
      'Digite quanto ele paga por semana, por exemplo 600,00.',
    );
    expect(chargesErrors(V, C)).toEqual({});
  });

  it('desconto: de 1 ao número de semanas; maior que zero e menor que o valor', () => {
    const d = { ...V, descOn: true, discountN: '2', discountValue: '100,00' };
    expect(chargesErrors(d, C)).toEqual({});
    expect(chargesErrors({ ...d, discountN: '5' }, C)['discountN']).toBe('Escolha de 1 a 4.');
    expect(chargesErrors({ ...d, discountValue: '600,00' }, C)['discountValue']).toContain('menor que R$ 600,00');
  });

  it('partes: precisam somar o valor da semana', () => {
    const p = { ...V, parcOn: true, parts: [TUE_FRI[0], { amount: '200,00', offset: 3 }] };
    expect(chargesErrors(p, C)['periodPartsSum']).toBe(
      'As partes somam R$ 500,00. Precisam somar R$ 600,00, o valor da semana.',
    );
    expect(chargesErrors({ ...p, parts: TUE_FRI }, C)).toEqual({});
  });

  it('partes: em ordem, e cada uma acima do mínimo', () => {
    const p = { ...V, parcOn: true, parts: [TUE_FRI[1], TUE_FRI[0]] };
    expect(chargesErrors(p, C)['perDue1']).toBe('Precisa vencer no mesmo dia ou depois da parte anterior.');
    const ok = { ...p, parts: TUE_FRI };
    expect(chargesErrors(ok, { ...C, minCents: 50_000, smallestPart: 30_000 })['periodPartsSum']).toContain(
      'Cada parte precisa ser de pelo menos R$ 500,00',
    );
  });

  it('"Só algumas": pelo menos uma; semana vencida ou que deixou de existir não fica', () => {
    const p = { ...V, parcOn: true, splitScope: 'SOME' as const, parts: TUE_FRI };
    expect(chargesErrors(p, C)['splitSel']).toBe('Escolha pelo menos uma semana.');
    expect(chargesErrors(p, { ...C, selected: [0], past: [0] })['splitSel']).toBe(
      'A semana 1 já venceu e não pode ser parcelada. Tire da escolha.',
    );
    expect(chargesErrors(p, { ...C, stale: [5] })['splitSel']).toContain('não existe mais');
    expect(chargesErrors(p, { ...C, selected: [1] })).toEqual({});
  });

  it('as frases das pranchas', () => {
    expect(rateHint('WEEKLY', '2026-11-24', 4)).toBe('Vence toda terça, a partir de 24/11. São 4 semanas.');
    expect(discountHint('WEEKLY', 2, 4, 60_000, 10_000)).toBe(
      'As 2 primeiras saem por R$ 500,00. As outras, R$ 600,00.',
    );
    expect(discountHint('DAILY', 1, 10, 10_000, 1_000)).toBe('O primeiro sai por R$ 90,00. Os outros, R$ 100,00.');
    expect(firstNOptions('WEEKLY', 3).map((o) => o.label)).toEqual(['1ª', '2 primeiras', '3 primeiras']);
  });

  it('"Vence na": dia da semana a partir do vencimento; por dia e por mês, dias depois', () => {
    expect(partDueOptions('WEEKLY', '2026-11-24').map((o) => o.label)).toEqual([
      'Terça',
      'Quarta',
      'Quinta',
      'Sexta',
      'Sábado',
      'Domingo',
      'Segunda',
    ]);
    expect(
      partDueOptions('DAILY', '2026-11-24')
        .slice(0, 3)
        .map((o) => o.label),
    ).toEqual(['No vencimento', '1 dia depois', '2 dias depois']);
    expect(partDueOptions('MONTHLY', '2026-11-24')).toHaveLength(30);
  });
});

describe('mínimo por cobrança antes do servidor (Pix: R$ 5,00)', () => {
  const pix = { today: '2026-11-20', minCents: 500 };

  it('caução inteira abaixo do mínimo, com e sem desconto', () => {
    const base = { caucaoReais: '3,00', caucaoPaid: false, caucaoDescOn: false, caucaoDiscount: '', caucaoSplit: false, parts: [] };
    expect(caucaoErrors(base, pix)['caucaoReais']).toBe('A caução precisa ser de pelo menos R$ 5,00. Ou 0 se não cobra.');
    expect(caucaoErrors({ ...base, caucaoReais: '10,00', caucaoDescOn: true, caucaoDiscount: '6,00' }, pix)['caucaoDiscount']).toBe(
      'Com esse desconto a caução ficaria abaixo de R$ 5,00.',
    );
    // Só anotada (1 centavo) ou recebida por fora: sem mínimo.
    expect(caucaoErrors(base, { ...pix, minCents: 1 })).toEqual({});
    expect(caucaoErrors({ ...base, caucaoPaid: true }, pix)).toEqual({});
  });

  it('cada parte da caução e o valor do período', () => {
    const split = {
      caucaoReais: '8,00',
      caucaoPaid: false,
      caucaoDescOn: false,
      caucaoDiscount: '',
      caucaoSplit: true,
      parts: [
        { amount: '4,00', due: '2026-11-24' },
        { amount: '4,00', due: '2026-12-08' },
      ],
    };
    expect(caucaoErrors(split, pix)['cauPart0']).toBe('Cada parte precisa ser de pelo menos R$ 5,00.');
    const V = { periodRateReais: '4,00', descOn: false, discountN: '1', discountValue: '', parcOn: false, splitScope: 'ALL' as const, parts: [] };
    const C = { words: periodWords('WEEKLY'), periods: 4, minCents: 500, selected: [], stale: [], past: [], smallestPart: null };
    expect(chargesErrors(V, C)['periodRateReais']).toBe('Cada cobrança precisa ser de pelo menos R$ 5,00.');
  });
});
