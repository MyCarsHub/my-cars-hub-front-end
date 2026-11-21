import { describe, expect, it } from 'vitest';

import { CREATE_CARDS, createProgress, progressDone } from './create-progress';

const none = (): boolean[] => CREATE_CARDS.map(() => false);

describe('createProgress — a barra de etapas do Novo aluguel', () => {
  it('nada pronto: Etapa 1 de 8, 0%, o primeiro segmento é o atual', () => {
    const p = createProgress(none());
    expect(p).toMatchObject({ done: 0, total: 8, step: 1, percent: 0 });
    expect(p.segments).toEqual(['current', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo']);
  });

  it('card 1 pronto: Etapa 2 de 8, 12% (arredonda para baixo, como a prancha D4)', () => {
    const cards = none();
    cards[0] = true;
    const p = createProgress(cards);
    expect(p).toMatchObject({ done: 1, step: 2, percent: 12 });
    expect(p.segments.slice(0, 3)).toEqual(['done', 'current', 'todo']);
  });

  it('cards 1 e 2 prontos: Etapa 3 de 8, 25% (prancha F4)', () => {
    const cards = none();
    cards[0] = cards[1] = true;
    expect(createProgress(cards)).toMatchObject({ done: 2, step: 3, percent: 25 });
  });

  it('um card do meio pronto antes de um de cima conta; a etapa é o primeiro que falta', () => {
    const cards = none();
    cards[1] = cards[2] = true;
    const p = createProgress(cards);
    expect(p).toMatchObject({ done: 2, step: 1, percent: 25 });
    expect(p.segments.slice(0, 4)).toEqual(['current', 'done', 'done', 'todo']);
  });

  it('tudo pronto: Etapa 8 de 8, 100%, nenhum segmento atual', () => {
    const p = createProgress(CREATE_CARDS.map(() => true));
    expect(p).toMatchObject({ done: 8, step: 8, percent: 100 });
    expect(p.segments.every((s) => s === 'done')).toBe(true);
  });
});

describe('progressDone — cards sem obrigatório só contam quando os de cima estão prontos', () => {
  it('no início, Contrato, Cobrança e Observações (prontos) não contam: a barra abre em 0%', () => {
    const complete = [false, false, false, false, false, true, true, true];
    expect(createProgress(progressDone(complete))).toMatchObject({ done: 0, step: 1, percent: 0 });
  });

  it('com os cards 1 a 5 prontos, os três contam: 100%', () => {
    expect(createProgress(progressDone(CREATE_CARDS.map(() => true)))).toMatchObject({ done: 8, percent: 100 });
  });

  it('um card obrigatório pronto conta mesmo com um de cima faltando', () => {
    expect(progressDone([false, true, false, false, false, true, true, true])).toEqual([
      false, true, false, false, false, false, false, false,
    ]);
  });
});
