/** A barra de etapas do Novo aluguel: 8 cards, na ordem da página. */
export const CREATE_CARDS = [
  'Motorista e veículo',
  'Período',
  'Caução',
  'Cobranças',
  'Condições de pagamento',
  'Contrato',
  'Cobrança',
  'Observações',
] as const;

export type ProgressSegment = 'done' | 'current' | 'todo';

export interface CreateProgress {
  /** Cards com os campos obrigatórios válidos. */
  done: number;
  total: number;
  /** "Etapa X de 8": o primeiro card ainda não pronto (o último, quando todos estão). */
  step: number;
  /** Inteiro, arredondado para baixo: 1 de 8 = 12%. */
  percent: number;
  segments: ProgressSegment[];
}

/** Cards sem campo obrigatório (Contrato, Cobrança, Observações): prontos desde o início. */
export const OPTIONAL_CARDS: ReadonlySet<number> = new Set([5, 6, 7]);

/**
 * O que a barra conta como feito. Um card sem obrigatório só conta quando todos os de cima
 * estão prontos: senão a barra abriria em 37% sem o usuário ter feito nada (as pranchas abrem
 * em 0%). O "Faltam N coisas" continua lendo o `complete` de cada card.
 */
export function progressDone(complete: readonly boolean[], optional: ReadonlySet<number> = OPTIONAL_CARDS): boolean[] {
  let allAbove = true;
  return complete.map((ok, i) => {
    const done = ok && (!optional.has(i) || allAbove);
    allAbove = allAbove && ok;
    return done;
  });
}

/**
 * `cards[i]` = o card `i` tem tudo o que é obrigatório. Pronto é contado card a card (um card
 * do meio pode estar pronto antes de um de cima); a etapa atual é o primeiro que falta.
 */
export function createProgress(cards: readonly boolean[]): CreateProgress {
  const total = cards.length;
  const done = cards.filter(Boolean).length;
  const current = cards.findIndex((ok) => !ok);
  return {
    done,
    total,
    step: current >= 0 ? current + 1 : total,
    percent: total ? Math.floor((done * 100) / total) : 0,
    segments: cards.map((ok, i) => (ok ? 'done' : i === current ? 'current' : 'todo')),
  };
}
