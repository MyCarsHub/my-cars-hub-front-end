import { RentalBillingFrequency, RentalChargePreviewDto, RentalChargeSyncDto } from '../../../types/rental.types';
import { brl, dShort, periodWords, plural, weekdayLong } from '../rental-wizard/wizard-format';
import { CREATE_CARDS } from './create-progress';

/**
 * O fim da página (pranchas FimF1–F6 / FimD1–D3): o que falta, o "Confira antes de criar" e o
 * "Aluguel criado", em funções puras. A lista de cobranças vem SEMPRE da prévia do servidor.
 */

// ------------------------------------------------------------------ o que falta
/**
 * O que cada card diz à página: está pronto? se não, a primeira coisa que falta, em palavras
 * simples ("Escolha o carro."). A barra de etapas e o "Faltam N coisas" leem a mesma resposta.
 */
export interface CardCompleteness {
  complete: boolean;
  firstMissing: string | null;
}

/** Pronto = nenhum erro; o que falta = o primeiro erro, na ordem dos campos do card. */
export function completenessFrom(errors: Readonly<Record<string, string>>, extraMissing: string | null = null): CardCompleteness {
  const first = Object.values(errors)[0] ?? extraMissing;
  return { complete: !first, firstMissing: first ?? null };
}

export interface MissingRow {
  card: number;
  name: string;
  text: string;
}

export function missingRows(status: readonly CardCompleteness[]): MissingRow[] {
  return status.flatMap((s, card) =>
    s.complete ? [] : [{ card, name: CREATE_CARDS[card] ?? '', text: s.firstMissing ?? 'Falta preencher.' }],
  );
}

/** "Falta 1 coisa para criar" / "Faltam 2 coisas para criar". */
export function missingTitle(n: number): string {
  return n === 1 ? 'Falta 1 coisa para criar' : `Faltam ${n} coisas para criar`;
}

// ------------------------------------------------------------------ Confira antes de criar
export interface ConfirmInput {
  preview: RentalChargePreviewDto;
  frequency: RentalBillingFrequency;
  periods: number;
  startDate: string;
  endDate: string;
  firstDue: string;
  driverName: string;
  plate: string;
  automatic: boolean;
  caucaoPaid: boolean;
  caucaoGrossCents: number;
  useContractTemplate: boolean;
  /** Tempo mínimo ("Fica pelo menos até uma data"): o fim é o do mínimo e depois ele renova. */
  minimum?: boolean;
}

export interface ConfirmRow {
  label: string;
  value: string;
  /** Card (0-based) que o "Mudar" abre. */
  card: number;
}

export interface ChargeLine {
  key: string;
  title: string;
  date: string;
  value: string;
}

export interface ConfirmModel {
  rentTotal: string;
  rentCaption: string;
  /** Há caução a mostrar (cobrada ou recebida por fora)? Sem ela, o cartão verde some. */
  showCaucao: boolean;
  caucaoTotal: string;
  caucaoCaption: string;
  rows: ConfirmRow[];
  lines: ChargeLine[];
  count: number;
  automatic: boolean;
  /** "6 cobranças" */
  countText: string;
  /** "4 semanas e 2 partes da caução" */
  detail: string;
  /** Frase do automático com a parte em negrito; diz quantas vão ao Asaas e quantas ficam no app. */
  say: SayParts;
}

export interface SayParts {
  before: string;
  bold: string;
  after: string;
}

/**
 * Quantas vão ao Asaas e quantas ficam só no app: vencimento antes de hoje nunca vai ao
 * gateway (regra do servidor), então um aluguel que começou no passado tem cobranças locais.
 */
function gatewaySplit(preview: RentalChargePreviewDto | null): { gw: number; local: number; n: number } {
  const n = preview?.charges.length ?? 0;
  // Prévia calculada como "recebo por fora" não diz o destino no Asaas: sem divisão.
  if (!preview?.automaticCharge) return { gw: n, local: 0, n };
  const gw = preview.gatewayCount ?? n;
  const local = preview.localCount ?? 0;
  return { gw, local, n };
}

function localText(local: number): string {
  return local === 1
    ? '1 cobrança que já venceu fica só anotada no aluguel'
    : `${local} cobranças que já venceram ficam só anotadas no aluguel`;
}

function confirmSay(preview: RentalChargePreviewDto, countText: string, detail: string): SayParts {
  const { gw, local } = gatewaySplit(preview);
  if (local === 0) {
    return { before: 'Ao criar, as ', bold: countText, after: ` (${detail}) vão para a sua conta Asaas agora.` };
  }
  if (gw === 0) {
    return { before: 'As ', bold: countText, after: ' já venceram: ficam só anotadas no aluguel, sem ir para a sua conta Asaas.' };
  }
  return {
    before: 'Ao criar, ',
    bold: plural(gw, 'cobrança', 'cobranças'),
    after: ` ${gw === 1 ? 'vai' : 'vão'} para a sua conta Asaas agora. ${cap(localText(local))}.`,
  };
}

function cap(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function cadence(freq: RentalBillingFrequency, firstDue: string): string {
  if (freq === 'WEEKLY') return `toda ${weekdayLong(firstDue)}`;
  return freq === 'MONTHLY' ? 'a cada 30 dias' : 'todo dia';
}

/** As linhas do "Ver as N cobranças" — as do servidor, como o passo a passo as escreve. */
export function chargeLines(preview: RentalChargePreviewDto, freq: RentalBillingFrequency): ChargeLine[] {
  const w = periodWords(freq);
  return preview.charges.map((c, i) => {
    const count = c.instalmentCount ?? 1;
    const idx = c.instalmentIndex ?? 1;
    const title =
      c.kind === 'CAUCAO'
        ? count > 1 ? `Caução, parte ${idx} de ${count}` : 'Caução'
        : count > 1 ? `${w.one} ${c.index + 1}, parcela ${idx} de ${count}` : `${w.one} ${c.index + 1}`;
    return { key: `${i}`, title, date: `${cap(weekdayLong(c.dueDate))}, ${dShort(c.dueDate)}`, value: brl(c.amountCents) };
  });
}

export function confirmModel(i: ConfirmInput): ConfirmModel {
  const w = periodWords(i.frequency);
  const rent = i.preview.charges.filter((c) => c.kind === 'RENTAL_PERIOD');
  const caucao = i.preview.charges.filter((c) => c.kind === 'CAUCAO');
  const sum = (list: typeof rent): number => list.reduce((a, c) => a + c.amountCents, 0);
  const periodsText = plural(i.periods, w.lower, w.lowerMany);

  let showCaucao = false;
  let caucaoTotal = brl(0);
  let caucaoCaption = '';
  if (i.caucaoPaid && i.caucaoGrossCents > 0) {
    showCaucao = true;
    caucaoTotal = brl(i.caucaoGrossCents);
    caucaoCaption = 'Recebida por fora';
  } else if (caucao.length) {
    showCaucao = true;
    caucaoTotal = brl(sum(caucao));
    caucaoCaption = caucao.length > 1 ? `Em ${caucao.length} partes. Volta no fim` : 'Volta no fim';
  }

  const rentPart = rent.length === i.periods ? periodsText : `${plural(rent.length, 'parcela', 'parcelas')} d${w.fem ? 'as' : 'os'} ${periodsText}`;
  const caucaoPart = caucao.length > 1 ? `${caucao.length} partes da caução` : caucao.length === 1 ? 'a caução' : '';
  const count = i.preview.charges.length;
  return {
    rentTotal: brl(sum(rent)),
    rentCaption: i.minimum
      ? `${periodsText}, ${cadence(i.frequency, i.firstDue)}. Depois você renova.`
      : `${periodsText}, ${cadence(i.frequency, i.firstDue)}`,
    showCaucao,
    caucaoTotal,
    caucaoCaption,
    rows: [
      { label: 'Motorista e carro', value: `${i.driverName} · ${i.plate}`, card: 0 },
      {
        label: 'Período',
        value: i.minimum
          ? `${dShort(i.startDate)} a ${dShort(i.endDate)} · no mínimo ${periodsText}`
          : `${dShort(i.startDate)} a ${dShort(i.endDate)} · ${periodsText}`,
        card: 1,
      },
      { label: '1ª cobrança', value: `${cap(weekdayLong(i.firstDue))}, ${dShort(i.firstDue)}`, card: 4 },
      { label: 'Contrato', value: i.useContractTemplate ? 'Gerado pelo seu modelo' : 'Você envia o PDF', card: 5 },
      { label: 'Cobrança', value: i.automatic ? 'Cobranças automáticas' : 'Eu recebo por fora', card: 6 },
    ],
    lines: chargeLines(i.preview, i.frequency),
    count,
    automatic: i.automatic,
    countText: plural(count, 'cobrança', 'cobranças'),
    detail: [rentPart, caucaoPart].filter(Boolean).join(' e '),
    say: confirmSay(
      i.preview,
      plural(count, 'cobrança', 'cobranças'),
      [rentPart, caucaoPart].filter(Boolean).join(' e '),
    ),
  };
}

// ------------------------------------------------------------------ Aluguel criado
export interface CreatedInput {
  driverName: string;
  plate: string;
  startDate: string;
  endDate: string;
  automatic: boolean;
  preview: RentalChargePreviewDto | null;
  useContractTemplate: boolean;
  sync: RentalChargeSyncDto | null;
  /** Tempo mínimo: o aviso de renovação perto do fim (RenPerF5). */
  minimum?: boolean;
}

export interface CreatedModel {
  subtitle: string;
  headline: string;
  caption: string;
  syncFailed: number;
}

export function createdModel(i: CreatedInput): CreatedModel {
  const n = i.preview?.charges.length ?? 0;
  const first = i.preview?.firstDueDate ?? null;
  const when = first ? `A primeira vence ${weekdayLong(first)}, ${dShort(first)}.` : '';
  const contract = i.useContractTemplate ? 'O contrato foi gerado pelo seu modelo.' : 'Envie o contrato em PDF no aluguel.';
  // Por fora, o servidor só cria as cobranças ao ativar o aluguel (`RentalActivationService` →
  // `RentalScheduleService.materializeIfMissing`): no "Aluguel criado" ainda não há nenhuma.
  const later = i.automatic ? '' : 'Elas ficam anotadas quando o aluguel começar (Marcar como ativo).';
  const renew = i.minimum ? `Perto de ${dShort(i.endDate)} a gente te avisa para renovar.` : '';
  const { gw, local } = gatewaySplit(i.preview);
  let headline = `${plural(n, 'cobrança', 'cobranças')} ao ativar o aluguel`;
  let past = '';
  if (i.automatic && gw > 0) {
    headline = `${plural(gw, 'cobrança', 'cobranças')} na sua conta Asaas`;
    past = local > 0 ? `${cap(localText(local))}.` : '';
  } else if (i.automatic) {
    headline = `${plural(n, 'cobrança anotada', 'cobranças anotadas')} no aluguel`;
    past = n > 0 ? `${n === 1 ? 'Ela já venceu' : 'Elas já venceram'}, então não ${n === 1 ? 'vai' : 'vão'} para a sua conta Asaas.` : '';
  }
  return {
    subtitle: `${i.driverName} · ${i.plate} · ${dShort(i.startDate)} a ${dShort(i.endDate)}`,
    headline,
    caption: [later, past, when, contract, renew].filter(Boolean).join(' '),
    syncFailed: i.sync?.failed ?? 0,
  };
}
