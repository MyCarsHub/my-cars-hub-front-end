import { DraftDecision, SuggestionView } from './ai/contract-ai.types';
import { MASK_TOKEN, hiddenLabel, isKnownField } from './contract-fields';
import { ContractBaseClause } from './base/contract-base.types';

/**
 * O contrato ao vivo da esteira é montado AQUI, como dados, e só desenhado pelo
 * `ContractPaper`. Nada vira HTML: cada pedaço é texto interpolado (escapado) ou um campo.
 */
export type PaperSegment =
  | { kind: 'text'; text: string; bold?: boolean }
  /** Campo do app: aparece como exemplo ou como `{{campo}}`. `doubt` = pergunta em aberto. */
  | { kind: 'field'; field: string; tone: 'ok' | 'doubt'; focus?: boolean }
  /** Dado pessoal mascarado antes da IA («CPF escondido»). */
  | { kind: 'hidden'; label: string }
  /** Trecho que a pessoa decidiu deixar sempre igual. */
  | { kind: 'kept'; text: string; focus?: boolean };

export interface PaperParagraph {
  id: string;
  role: 'title' | 'body';
  segments: PaperSegment[];
  /** Cláusula em foco (montar do zero): fundo e contorno laranja claros. */
  focus?: boolean;
}

export interface PaperDocument {
  paragraphs: PaperParagraph[];
  /** Campos distintos que o contrato usa. */
  fields: string[];
  /** Cláusulas numeradas («CLÁUSULA 1ª…»). */
  clauses: number;
}

const FIELD_OR_BOLD = /(\{\{\s*[A-Za-z0-9_]+\s*\}\}|\*\*[^*]+\*\*)/;
/** `{{campo}}` no texto do contrato enviado. */
const FIELD_TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
/** Qualquer coisa entre chaves duplas: mesmo critério do backend para o que não se toca. */
const ANY_TOKEN = /\{\{[^{}]*\}\}/g;

/** Texto de uma linha: `{{campo}}` vira campo e `**negrito**` vira texto em negrito. */
export function parseInline(text: string): PaperSegment[] {
  const out: PaperSegment[] = [];
  for (const part of text.split(FIELD_OR_BOLD)) {
    if (!part) continue;
    const field = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/.exec(part);
    if (field) {
      out.push({ kind: 'field', field: field[1], tone: 'ok' });
    } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      out.push({ kind: 'text', text: part.slice(2, -2), bold: true });
    } else {
      out.push({ kind: 'text', text: part });
    }
  }
  return out;
}

interface MdBlock {
  kind: 'title' | 'heading' | 'paragraph';
  text: string;
}

/** Markdown simples: `# ` título, `## ` cabeçalho de cláusula, linha em branco separa parágrafos. */
function markdownBlocks(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) blocks.push({ kind: 'paragraph', text: para.join(' ') });
    para = [];
  };
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line === '---') {
      flush();
    } else if (line.startsWith('# ')) {
      flush();
      blocks.push({ kind: 'title', text: line.slice(2).trim() });
    } else if (line.startsWith('## ')) {
      flush();
      blocks.push({ kind: 'heading', text: line.slice(3).trim() });
    } else {
      para.push(line.replace(/^[-*]\s+/, '• '));
    }
  }
  flush();
  return blocks;
}

function collectFields(paragraphs: PaperParagraph[]): string[] {
  const seen = new Set<string>();
  for (const p of paragraphs) {
    for (const s of p.segments) if (s.kind === 'field') seen.add(s.field);
  }
  return [...seen];
}

/**
 * «Montar do zero»: as cláusulas escolhidas, na ordem do backend, com a numeração refeita a
 * cada mudança. Um `## TÍTULO` no texto da cláusula vira «CLÁUSULA Nª — TÍTULO.» no começo
 * do parágrafo seguinte; cláusula sem `##` (partes, veículo, local e data) não é numerada.
 */
export function buildBaseDocument(
  clauses: readonly ContractBaseClause[],
  selected: ReadonlySet<string>,
  focusId: string | null,
): PaperDocument {
  const paragraphs: PaperParagraph[] = [];
  let n = 0;
  for (const clause of clauses) {
    if (!clause.fixed && !selected.has(clause.id)) continue;
    const focus = clause.id === focusId;
    let heading: string | null = null;
    markdownBlocks(clause.text).forEach((block, i) => {
      const id = `${clause.id}-${i}`;
      if (block.kind === 'title') {
        paragraphs.push({ id, role: 'title', segments: parseInline(block.text) });
      } else if (block.kind === 'heading') {
        n += 1;
        heading = `CLÁUSULA ${n}ª — ${block.text.replace(/\.$/, '')}. `;
      } else {
        const segments = parseInline(block.text);
        if (heading) segments.unshift({ kind: 'text', text: heading, bold: true });
        heading = null;
        paragraphs.push({ id, role: 'body', segments, focus });
      }
    });
    if (heading) {
      paragraphs.push({
        id: `${clause.id}-h`,
        role: 'body',
        segments: [{ kind: 'text', text: heading, bold: true }],
        focus,
      });
    }
  }
  return { paragraphs, fields: collectFields(paragraphs), clauses: n };
}

const CLAUSE_LINE = /^\s*(\*\*)?\s*CL[ÁA]USULA\b/i;

/** Markdown já pronto (contrato exemplo do backend): sem renumerar. */
export function buildMarkdownDocument(md: string): PaperDocument {
  const paragraphs: PaperParagraph[] = markdownBlocks(md).map((block, i) => ({
    id: `md-${i}`,
    role: block.kind === 'title' ? 'title' : 'body',
    segments:
      block.kind === 'heading'
        ? [{ kind: 'text', text: block.text, bold: true }]
        : parseInline(block.text),
  }));
  const clauses = markdownBlocks(md).filter(
    (b) => b.kind === 'heading' && CLAUSE_LINE.test(b.text),
  ).length;
  return { paragraphs, fields: collectFields(paragraphs), clauses };
}

/** Parágrafos sem campos (o arquivo como foi enviado). */
export function buildPlainDocument(lines: readonly string[]): PaperDocument {
  const paragraphs: PaperParagraph[] = lines.map((text, i) => ({
    id: `plain-${i}`,
    role: i === 0 && looksLikeTitle(text) ? 'title' : 'body',
    segments: [{ kind: 'text', text }],
  }));
  return {
    paragraphs,
    fields: [],
    clauses: lines.filter((l) => CLAUSE_LINE.test(l)).length,
  };
}

function looksLikeTitle(text: string): boolean {
  return text.length <= 90 && text === text.toUpperCase() && /[A-ZÀ-Ú]/.test(text);
}

/** Troca as marcas `[CPF_1]` por rótulos amigáveis em cinza. */
function withHidden(text: string): PaperSegment[] {
  const out: PaperSegment[] = [];
  let at = 0;
  for (const m of text.matchAll(MASK_TOKEN)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ kind: 'text', text: text.slice(at, i) });
    out.push({ kind: 'hidden', label: hiddenLabel(m[1]) });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

/**
 * O texto do contrato com os `{{campo}}` que ele já trazia virando campo, igual a uma sugestão
 * aceita. Token fora da lista fica como texto: não é verde porque o salvar vai recusá-lo.
 */
function withFields(text: string): PaperSegment[] {
  const out: PaperSegment[] = [];
  let at = 0;
  for (const m of text.matchAll(FIELD_TOKEN)) {
    if (!isKnownField(m[1])) continue;
    const i = m.index ?? 0;
    if (i > at) out.push(...withHidden(text.slice(at, i)));
    out.push({ kind: 'field', field: m[1], tone: 'ok' });
    at = i + m[0].length;
  }
  if (at < text.length) out.push(...withHidden(text.slice(at)));
  return out;
}

/** Primeira ocorrência do trecho fora dos tokens («Km» não pode cair em `{{initialKm}}`). */
function excerptAt(text: string, excerpt: string, from = 0): number {
  const tokens = [...text.matchAll(ANY_TOKEN)].map((m) => {
    const from = m.index ?? 0;
    return { from, to: from + m[0].length };
  });
  let at = text.indexOf(excerpt, from);
  while (at >= 0) {
    const end = at + excerpt.length;
    if (!tokens.some((t) => at < t.to && end > t.from)) return at;
    at = text.indexOf(excerpt, at + 1);
  }
  return -1;
}

/** Quanto do contrato a pergunta cita de cada lado do trecho. */
const QUOTE_REACH = 70;

function tokenAround(text: string, position: number): { from: number; to: number } | null {
  for (const m of text.matchAll(ANY_TOKEN)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (position > from && position < to) return { from, to };
  }
  return null;
}

export interface QuoteParts {
  before: PaperSegment[];
  hit: string;
  after: PaperSegment[];
}

/**
 * O trecho citado na pergunta, com a mesma leitura da folha: acha o trecho fora dos tokens e mostra
 * os `{{campo}}` vizinhos como campo. O corte da citação nunca parte um token ao meio.
 */
export function quoteOf(context: string, hit: string): QuoteParts {
  const at = hit ? excerptAt(context, hit) : -1;
  if (at < 0) return { before: [], hit, after: [] };
  const wantedStart = at - QUOTE_REACH;
  const start = wantedStart <= 0 ? 0 : (tokenAround(context, wantedStart)?.to ?? wantedStart);
  const end = at + hit.length;
  const wantedEnd = end + QUOTE_REACH;
  const stop = wantedEnd >= context.length ? context.length : (tokenAround(context, wantedEnd)?.from ?? wantedEnd);
  const before = withFields(context.slice(start, at));
  const after = withFields(context.slice(end, stop));
  if (start > 0) before.unshift({ kind: 'text', text: '…' });
  if (stop < context.length) after.push({ kind: 'text', text: '…' });
  return { before, hit, after };
}

/** Texto mascarado com as marcas trocadas por rótulos, para frases fora do contrato. */
export function humanizeMasked(text: string): string {
  return text.replace(MASK_TOKEN, (_m, kind: string) => hiddenLabel(kind));
}

export interface MaskedStage {
  /** `consent`: só o texto mascarado. `fields`: dúvidas em aberto em âmbar. `review`: final. */
  stage: 'consent' | 'fields' | 'review';
  suggestions?: readonly SuggestionView[];
  doubtIds?: ReadonlySet<string>;
  decisions?: Readonly<Record<string, DraftDecision>>;
  focusId?: string | null;
}

/**
 * «Ajustar o meu contrato»: o texto mascarado que a IA leu, com cada sugestão trocada pelo
 * campo que a pessoa aceitou. Sugestão recusada fica com o texto original; dúvida ainda sem
 * resposta aparece em âmbar até ser respondida. No consentimento o texto fica intacto, chaves
 * inclusive: ali ele é o que vai à IA.
 */
export function buildMaskedDocument(
  paragraphs: readonly { id: string; text: string }[],
  opts: MaskedStage,
): PaperDocument {
  const out: PaperParagraph[] = paragraphs.map((p, index) => {
    const role: PaperParagraph['role'] = index === 0 && looksLikeTitle(p.text) ? 'title' : 'body';
    if (opts.stage === 'consent') return { id: p.id, role, segments: withHidden(p.text) };
    // O backend faz uma sugestão por ocorrência: cada uma continua de onde a anterior parou.
    const resumeAt = new Map<string, number>();
    const hits = (opts.suggestions ?? [])
      .filter((s) => s.paragraphId === p.id && s.excerpt)
      .map((s) => {
        const at = excerptAt(p.text, s.excerpt, resumeAt.get(s.excerpt) ?? 0);
        if (at >= 0) resumeAt.set(s.excerpt, at + s.excerpt.length);
        return { s, at };
      })
      .filter((h) => h.at >= 0)
      .sort((a, b) => a.at - b.at);
    const segments: PaperSegment[] = [];
    let cursor = 0;
    for (const { s, at } of hits) {
      if (at < cursor) continue; // sobreposta a outra sugestão: a primeira vence
      if (at > cursor) segments.push(...withFields(p.text.slice(cursor, at)));
      const decision = opts.decisions?.[s.id];
      const isDoubt = opts.doubtIds?.has(s.id) ?? false;
      const focus = s.id === opts.focusId;
      // Pergunta de quem é o dado: sem resposta o texto fica fixo, então a folha não presume o campo.
      if ((decision && !decision.accept) || (!decision && s.askParty)) {
        const kept = humanizeMasked(s.excerpt);
        segments.push({ kind: 'kept', text: kept, focus });
      } else {
        const open = isDoubt && !decision && opts.stage === 'fields';
        segments.push({
          kind: 'field',
          field: decision?.field ?? s.field,
          tone: open ? 'doubt' : 'ok',
          focus,
        });
      }
      cursor = at + s.excerpt.length;
    }
    if (cursor < p.text.length) segments.push(...withFields(p.text.slice(cursor)));
    return { id: p.id, role, segments };
  });
  return {
    paragraphs: out,
    fields: collectFields(out),
    clauses: paragraphs.filter((p) => CLAUSE_LINE.test(p.text)).length,
  };
}
