import { describe, expect, it } from 'vitest';

import {
  FUEL_OTHER,
  TermsValue,
  billingErrors,
  dueStep,
  fineHint,
  firstDueHint,
  interestHint,
  isCard5Complete,
  isCard6Complete,
  isCard7Complete,
  isCard8Complete,
  kmLimitHint,
  maskKm,
  notesCounter,
  termsErrors,
} from './terms-rules';

/** Preenchido como a prancha CondP1: multa 2%, juros 1,50, 45.820 km, sem limite. */
function filled(over: Partial<TermsValue> = {}): TermsValue {
  return {
    endDate: '2026-12-22',
    firstPaymentDate: '2026-11-24',
    lateFineType: 'PERCENT',
    lateFineValue: '2',
    lateInterestPercent: '1,50',
    initialKm: '45.820',
    hasKmLimit: false,
    franchiseKm: '',
    extraKmPriceReais: '',
    fuel: 'Mesmo nível da retirada',
    customFuel: '',
    ...over,
  };
}
const ctx = { chargeCents: 60000 };

describe('terms-rules · card 5 (Condições de pagamento)', () => {
  it('preenchido como a prancha: sem erros e pronto', () => {
    expect(termsErrors(filled(), ctx)).toEqual({});
    expect(isCard5Complete(filled(), ctx)).toBe(true);
  });

  it('vencimento: obrigatório e não depois da devolução', () => {
    expect(termsErrors(filled({ firstPaymentDate: '' }), ctx)['firstPaymentDate']).toBe(
      'Escolha o vencimento da primeira cobrança.',
    );
    expect(termsErrors(filled({ firstPaymentDate: '2026-12-23' }), ctx)['firstPaymentDate']).toBe(
      'A 1ª cobrança não pode vencer depois da devolução.',
    );
    expect(termsErrors(filled({ firstPaymentDate: '2026-12-22' }), ctx)['firstPaymentDate']).toBeUndefined();
  });

  it('multa em %: obrigatória (0 vale) e de 0 a 99', () => {
    expect(termsErrors(filled({ lateFineValue: '' }), ctx)['lateFineValue']).toBe(
      'Digite a multa, por exemplo 2. Ou 0 se não cobra.',
    );
    expect(termsErrors(filled({ lateFineValue: '0' }), ctx)['lateFineValue']).toBeUndefined();
    expect(termsErrors(filled({ lateFineValue: '2,5' }), ctx)['lateFineValue']).toBeUndefined();
    expect(termsErrors(filled({ lateFineValue: '100' }), ctx)['lateFineValue']).toBe(
      'Digite um percentual de 0 a 99, por exemplo 2.',
    );
    expect(termsErrors(filled({ lateFineValue: 'abc' }), ctx)['lateFineValue']).toBeDefined();
  });

  it('multa em R$: valor válido e menor que o valor de cada cobrança', () => {
    const fixed = (v: string) => termsErrors(filled({ lateFineType: 'FIXED', lateFineValue: v }), ctx)['lateFineValue'];
    expect(fixed('15,00')).toBeUndefined();
    expect(fixed('0,00')).toBeUndefined();
    expect(fixed('')).toBe('Digite um valor válido, por exemplo 50,00. Ou 0 se não cobra.');
    expect(fixed('600,00')).toBe('A multa precisa ser menor que R$ 600,00, o valor de cada cobrança.');
    // Sem valor de cobrança ainda, não há teto a comparar.
    expect(termsErrors(filled({ lateFineType: 'FIXED', lateFineValue: '900,00' }), { chargeCents: 0 })).toEqual({});
  });

  it('juros: opcional, de 0% a 11% ao mês', () => {
    expect(termsErrors(filled({ lateInterestPercent: '' }), ctx)['lateInterestPercent']).toBeUndefined();
    expect(termsErrors(filled({ lateInterestPercent: '11,00' }), ctx)['lateInterestPercent']).toBeUndefined();
    expect(termsErrors(filled({ lateInterestPercent: '11,01' }), ctx)['lateInterestPercent']).toBe(
      'Os juros vão de 0% a 11% ao mês.',
    );
  });

  it('km na retirada: obrigatório, só números', () => {
    expect(termsErrors(filled({ initialKm: '' }), ctx)['initialKm']).toBe(
      'Digite os km do painel, só números. Sem isso o contrato fica incompleto.',
    );
    expect(termsErrors(filled({ initialKm: '0' }), ctx)['initialKm']).toBeUndefined();
  });

  it('com limite: km por dia obrigatório; preço do km opcional, mas válido', () => {
    const lim = (o: Partial<TermsValue>) => termsErrors(filled({ hasKmLimit: true, ...o }), ctx);
    expect(lim({ franchiseKm: '' })['franchiseKm']).toBe('Digite quantos km por dia.');
    expect(lim({ franchiseKm: '0' })['franchiseKm']).toBe('Digite quantos km por dia.');
    expect(lim({ franchiseKm: '150', extraKmPriceReais: '' })).toEqual({});
    expect(lim({ franchiseKm: '150', extraKmPriceReais: 'x' })['extraKmPriceReais']).toBe(
      'Digite um valor válido, por exemplo 0,50.',
    );
    // Sem limite, os campos do limite não contam.
    expect(termsErrors(filled({ hasKmLimit: false, franchiseKm: '' }), ctx)).toEqual({});
  });

  it('combustível é opcional; "Outra regra" pede a regra', () => {
    expect(termsErrors(filled({ fuel: '' }), ctx)).toEqual({});
    expect(termsErrors(filled({ fuel: FUEL_OTHER, customFuel: '  ' }), ctx)['customFuel']).toBe(
      'Escreva a regra do combustível.',
    );
    expect(termsErrors(filled({ fuel: FUEL_OTHER, customFuel: 'Devolver com 1/4 do tanque' }), ctx)).toEqual({});
  });

  it('pronto só com vencimento, multa e km preenchidos e sem erro', () => {
    expect(isCard5Complete(filled({ initialKm: '' }), ctx)).toBe(false);
    expect(isCard5Complete(filled({ lateFineValue: '' }), ctx)).toBe(false);
    expect(isCard5Complete(filled({ firstPaymentDate: '' }), ctx)).toBe(false);
    expect(isCard5Complete(filled({ fuel: FUEL_OTHER }), ctx)).toBe(false);
  });
});

describe('terms-rules · frases do card 5', () => {
  it('a 1ª cobrança diz o dia da semana e o ritmo das próximas', () => {
    expect(firstDueHint('2026-11-24', 'WEEKLY')).toBe('Terça. As próximas vencem toda terça.');
    expect(firstDueHint('2026-11-28', 'WEEKLY')).toBe('Sábado. As próximas vencem todo sábado.');
    expect(firstDueHint('2026-11-24', 'DAILY')).toBe('Terça. As próximas vencem todo dia.');
    expect(firstDueHint('2026-11-24', 'MONTHLY')).toBe('Terça. As próximas vencem a cada 30 dias.');
    expect(firstDueHint('', 'WEEKLY')).toBe('');
    expect(dueStep('WEEKLY')).toBe('a cada 7 dias');
  });

  it('multa: o valor em reais (%) ou o teto (R$)', () => {
    expect(fineHint('PERCENT', '2', 60000)).toBe('R$ 12,00 em cada cobrança atrasada.');
    expect(fineHint('PERCENT', '', 60000)).toBe('Percentual sobre o valor de cada cobrança atrasada.');
    expect(fineHint('FIXED', '15,00', 60000)).toBe('Menor que R$ 600,00 (valor de cada cobrança).');
    expect(fineHint('FIXED', '', 0)).toBe('Menor que o valor de cada cobrança.');
  });

  it('juros: quanto dá por dia de atraso', () => {
    expect(interestHint('1,50', 60000)).toBe('Cerca de R$ 0,30 por dia de atraso. De 0% a 11%.');
    expect(interestHint('', 60000)).toBe('De 0% a 11%.');
    expect(interestHint('1,50', 0)).toBe('De 0% a 11%.');
  });

  it('limite de km: a frase com e sem o preço do km', () => {
    expect(kmLimitHint('150', '0,50')).toBe('Até 150 km por dia. Acima disso, R$ 0,50 por km.');
    expect(kmLimitHint('150', '')).toBe('Até 150 km por dia.');
    expect(kmLimitHint('', '0,50')).toBe('');
  });

  it('máscara do km: ponto de milhar, só dígitos, cursor no mesmo dígito', () => {
    expect(maskKm('45820', 5)).toEqual({ value: '45.820', caret: 6 });
    expect(maskKm('4a5', 3)).toEqual({ value: '45', caret: 2 });
    expect(maskKm('1.2345', 1)).toEqual({ value: '12.345', caret: 1 });
    expect(maskKm('99999999', 8).value).toBe('9.999.999');
    expect(maskKm('', 0)).toEqual({ value: '', caret: 0 });
  });
});

describe('terms-rules · cards 6, 7 e 8', () => {
  it('contrato: sempre pronto', () => {
    expect(isCard6Complete()).toBe(true);
  });

  it('cobrança: automática sem Asaas conectado é erro; por fora sempre vale', () => {
    const owner = { asaasConnected: false, isOwner: true };
    expect(billingErrors({ automaticCharge: true }, owner)['automaticCharge']).toContain('Conecte');
    expect(isCard7Complete({ automaticCharge: true }, owner)).toBe(false);
    expect(isCard7Complete({ automaticCharge: false }, owner)).toBe(true);
    expect(isCard7Complete({ automaticCharge: true }, { asaasConnected: true, isOwner: false })).toBe(true);
    expect(billingErrors({ automaticCharge: true }, { asaasConnected: false, isOwner: false })['automaticCharge']).toContain(
      'Peça ao dono da conta',
    );
  });

  it('observações: contador, aviso perto do limite e sempre pronto', () => {
    expect(notesCounter('')).toEqual({ count: 0, text: '0 / 1000', warn: false, note: 'Só para você e sua equipe.' });
    expect(notesCounter('a'.repeat(949)).warn).toBe(false);
    expect(notesCounter('a'.repeat(950))).toMatchObject({ warn: true, note: 'Faltam 50 caracteres.' });
    expect(notesCounter('a'.repeat(988)).note).toBe('Faltam 12 caracteres.');
    expect(notesCounter('a'.repeat(999)).note).toBe('Falta 1 caractere.');
    expect(notesCounter('a'.repeat(1000)).note).toBe('Você chegou ao limite.');
    expect(isCard8Complete()).toBe(true);
  });
});
