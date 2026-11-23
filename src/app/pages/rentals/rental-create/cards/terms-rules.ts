import { RentalBillingFrequency, RentalLateFineType } from '../../../../types/rental.types';
import { ptBrMoneyCents } from '../../../../utils/validators/ptbr-money.validator';
import { INTEREST_MAX_PERCENT } from '../../rental-wizard/wizard-math';
import {
  FUEL_OPTIONS,
  FUEL_OTHER,
  brl,
  decimalOf,
  dShort,
  intOf,
  weekdayLong,
} from '../../rental-wizard/wizard-format';
import { CardCompleteness } from '../create-summary';

/**
 * Regras dos cards 5 a 8 do Novo aluguel (Condições de pagamento, Contrato, Cobrança e
 * Observações), as mesmas do passo a passo (`rental-wizard.ts`, `errs`, passos 3, 4 e 7), em
 * funções puras: os cards, a barra de etapas e os specs leem a mesma resposta.
 */

/** O combustível: a lista única de `wizard-format.ts` (o texto vai no corpo). */
export { FUEL_OPTIONS, FUEL_OTHER };
/** "Qual regra?": o mesmo limite do passo a passo. */
export const CUSTOM_FUEL_MAX = 60;
export const NOTES_MAX = 1000;
/** A partir daqui o contador fica laranja e diz quantos faltam. */
export const NOTES_WARN_AT = 950;

// ================================================================== card 5 · Condições de pagamento
export interface TermsValue {
  endDate: string;
  firstPaymentDate: string;
  lateFineType: RentalLateFineType;
  lateFineValue: string;
  lateInterestPercent: string;
  initialKm: string;
  hasKmLimit: boolean;
  franchiseKm: string;
  extraKmPriceReais: string;
  fuel: string;
  customFuel: string;
}

export interface TermsContext {
  /** Valor de cada cobrança (o menor, quando o desconto baixa algumas), em centavos; 0 = ainda sem valor. */
  chargeCents: number;
}

const blank = (text: string | null | undefined): boolean => (text ?? '').trim() === '';

export function termsErrors(v: TermsValue, ctx: TermsContext): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.firstPaymentDate) e['firstPaymentDate'] = 'Escolha o vencimento da primeira cobrança.';
  else if (v.endDate && v.firstPaymentDate > v.endDate) {
    e['firstPaymentDate'] = 'A 1ª cobrança não pode vencer depois da devolução.';
  }

  if (v.lateFineType === 'FIXED') {
    const f = ptBrMoneyCents(v.lateFineValue);
    if (f === null) e['lateFineValue'] = 'Digite um valor válido, por exemplo 50,00. Ou 0 se não cobra.';
    else if (ctx.chargeCents > 0 && f >= ctx.chargeCents) {
      e['lateFineValue'] = `A multa precisa ser menor que ${brl(ctx.chargeCents)}, o valor da menor cobrança.`;
    }
  } else if (blank(v.lateFineValue)) {
    // A prancha marca a multa como obrigatória: vazio não vira 0 calado.
    e['lateFineValue'] = 'Digite a multa, por exemplo 2. Ou 0 se não cobra.';
  } else {
    const f = decimalOf(v.lateFineValue);
    if (f === null || f >= 100) e['lateFineValue'] = 'Digite um percentual de 0 a 99, por exemplo 2.';
  }

  // Juros é opcional, como hoje: vazio = a chave nem vai no corpo.
  const j = blank(v.lateInterestPercent) ? 0 : ptBrMoneyCents(v.lateInterestPercent);
  if (j === null || j > INTEREST_MAX_PERCENT * 100) {
    e['lateInterestPercent'] = `Os juros vão de 0% a ${INTEREST_MAX_PERCENT}% ao mês.`;
  }

  if (intOf(v.initialKm) === null) {
    e['initialKm'] = 'Digite os km do painel, só números. Sem isso o contrato fica incompleto.';
  }
  if (v.hasKmLimit) {
    const k = intOf(v.franchiseKm);
    if (!k || k < 1) e['franchiseKm'] = 'Digite quantos km por dia.';
    if (!blank(v.extraKmPriceReais) && ptBrMoneyCents(v.extraKmPriceReais) === null) {
      e['extraKmPriceReais'] = 'Digite um valor válido, por exemplo 0,50.';
    }
  }
  if (v.fuel === FUEL_OTHER && blank(v.customFuel)) e['customFuel'] = 'Escreva a regra do combustível.';
  return e;
}

/** Pronto: vencimento, multa e km preenchidos, e nada com erro. */
export function isCard5Complete(v: TermsValue, ctx: TermsContext): boolean {
  if (!v.firstPaymentDate || blank(v.lateFineValue) || blank(v.initialKm)) return false;
  return Object.keys(termsErrors(v, ctx)).length === 0;
}

/**
 * Card 5 para o "Faltam N coisas" e a barra de etapas: o que falta em palavras simples
 * ("Informe o km do carro na retirada."), na ordem do card; preenchido e errado, o erro.
 */
export function card5Status(v: TermsValue, ctx: TermsContext): CardCompleteness {
  const e = termsErrors(v, ctx);
  const missing = !v.firstPaymentDate
    ? 'Escolha o vencimento da primeira cobrança.'
    : blank(v.lateFineValue)
      ? 'Informe a multa por atraso. Ou 0 se não cobra.'
      : blank(v.initialKm)
        ? 'Informe o km do carro na retirada.'
        : null;
  const first = missing ?? Object.values(e)[0] ?? null;
  return { complete: first === null && isCard5Complete(v, ctx), firstMissing: first };
}

/** "a cada 7 dias" / "todo dia" / "a cada 30 dias": de quanto em quanto as outras vencem. */
export function dueStep(freq: RentalBillingFrequency): string {
  if (freq === 'DAILY') return 'todo dia';
  if (freq === 'MONTHLY') return 'a cada 30 dias';
  return 'a cada 7 dias';
}

/** "Terça. As próximas vencem toda terça." — `''` sem data. */
export function firstDueHint(iso: string, freq: RentalBillingFrequency): string {
  const day = weekdayLong(iso);
  if (!day) return '';
  const title = day[0].toUpperCase() + day.slice(1);
  if (freq === 'DAILY') return `${title}. As próximas vencem todo dia.`;
  if (freq === 'MONTHLY') return `${title}. As próximas vencem a cada 30 dias.`;
  const every = day === 'sábado' || day === 'domingo' ? 'todo' : 'toda';
  return `${title}. As próximas vencem ${every} ${day}.`;
}

/** "terça, 24/11" — o rodapé do calendário. */
export function dueFooter(iso: string): string {
  const day = weekdayLong(iso);
  return day ? `${day}, ${dShort(iso)}` : '';
}

/** "R$ 12,00 em cada cobrança atrasada." (%) / "Menor que R$ 600,00 (valor de cada cobrança)." (R$). */
export function fineHint(type: RentalLateFineType, value: string, chargeCents: number): string {
  if (type === 'FIXED') {
    return chargeCents > 0
      ? `Menor que ${brl(chargeCents)} (valor da menor cobrança, parcelas incluídas).`
      : 'Menor que o valor de cada cobrança.';
  }
  const pct = decimalOf(value);
  if (pct === null || pct <= 0 || pct >= 100 || chargeCents <= 0) {
    return 'Percentual sobre o valor de cada cobrança atrasada.';
  }
  return `${brl(Math.round((chargeCents * pct) / 100))} em cada cobrança atrasada.`;
}

/** Juros de um dia de atraso, em centavos (o mês conta 30 dias); `null` sem juros ou sem valor. */
export function interestPerDayCents(value: string, chargeCents: number): number | null {
  const bps = ptBrMoneyCents(value);
  if (bps === null || bps <= 0 || bps > INTEREST_MAX_PERCENT * 100 || chargeCents <= 0) return null;
  return Math.max(1, Math.round((chargeCents * bps) / 10000 / 30));
}

/** "Cerca de R$ 0,30 por dia de atraso. De 0% a 11%." */
export function interestHint(value: string, chargeCents: number): string {
  const range = `De 0% a ${INTEREST_MAX_PERCENT}%.`;
  const day = interestPerDayCents(value, chargeCents);
  return day === null ? range : `Cerca de ${brl(day)} por dia de atraso. ${range}`;
}

/** "Até 150 km por dia. Acima disso, R$ 0,50 por km." — `''` sem km por dia. */
export function kmLimitHint(franchiseKm: string, extraKmPriceReais: string): string {
  const km = intOf(franchiseKm);
  if (!km || km < 1) return '';
  const head = `Até ${km.toLocaleString('pt-BR')} km por dia.`;
  const price = ptBrMoneyCents(extraKmPriceReais);
  return price && price > 0 ? `${head} Acima disso, ${brl(price)} por km.` : head;
}

/**
 * Máscara do km: só dígitos (até 7), com ponto de milhar ("45820" → "45.820"). O cursor fica
 * depois do mesmo dígito em que estava.
 */
export function maskKm(raw: string, caret: number): { value: string; caret: number } {
  const digitsBefore = raw.slice(0, caret).replace(/\D/g, '').length;
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7);
  const value = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  let seen = 0;
  let pos = 0;
  while (pos < value.length && seen < Math.min(digitsBefore, digits.length)) {
    if (/\d/.test(value[pos])) seen++;
    pos++;
  }
  return { value, caret: pos };
}

// ================================================================== card 6 · Contrato
/** O contrato não tem campo obrigatório: ligado ou desligado, o card está pronto. */
export function isCard6Complete(): boolean {
  return true;
}

// ================================================================== card 7 · Cobrança
export interface BillingContext {
  asaasConnected: boolean;
  isOwner: boolean;
}

export function billingErrors(v: { automaticCharge: boolean }, ctx: BillingContext): Record<string, string> {
  const e: Record<string, string> = {};
  if (v.automaticCharge && !ctx.asaasConnected) {
    e['automaticCharge'] = ctx.isOwner
      ? 'Sua conta Asaas ainda não está conectada. Conecte ou escolha "Eu recebo por fora".'
      : 'A conta Asaas ainda não está conectada. Peça ao dono da conta para conectar, ou escolha "Eu recebo por fora".';
  }
  return e;
}

export function isCard7Complete(v: { automaticCharge: boolean }, ctx: BillingContext): boolean {
  return Object.keys(billingErrors(v, ctx)).length === 0;
}

export function card7Status(v: { automaticCharge: boolean }, ctx: BillingContext): CardCompleteness {
  const first = Object.values(billingErrors(v, ctx))[0] ?? null;
  return { complete: first === null, firstMissing: first };
}

/** Cards 6 e 8 não têm campo obrigatório: sempre prontos. */
export const ALWAYS_COMPLETE: CardCompleteness = { complete: true, firstMissing: null };

// ================================================================== card 8 · Observações
export interface NotesCounter {
  count: number;
  /** "135 / 1000" */
  text: string;
  /** Perto do limite: o contador fica laranja. */
  warn: boolean;
  /** A frase da esquerda: o lembrete, ou quantos caracteres faltam. */
  note: string;
}

export function notesCounter(text: string): NotesCounter {
  const count = Math.min((text ?? '').length, NOTES_MAX);
  const left = NOTES_MAX - count;
  const warn = count >= NOTES_WARN_AT;
  const note = !warn
    ? 'Só para você e sua equipe.'
    : left === 0
      ? 'Você chegou ao limite.'
      : left === 1
        ? 'Falta 1 caractere.'
        : `Faltam ${left} caracteres.`;
  return { count, text: `${count} / ${NOTES_MAX}`, warn, note };
}

/** Observações é opcional: o card está sempre pronto. */
export function isCard8Complete(): boolean {
  return true;
}
