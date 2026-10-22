import { describe, expect, it } from 'vitest';
import { FIELD_LABELS } from './ai/contract-ai.messages';
import { SuggestionView } from './ai/contract-ai.types';
import { ContractBaseClause } from './base/contract-base.types';
import { FIELD_EXAMPLES } from './contract-fields';
import {
  PaperDocument,
  buildBaseDocument,
  buildMarkdownDocument,
  buildMaskedDocument,
  parseInline,
} from './contract-paper.model';

const clause = (
  id: string,
  text: string,
  opts: Partial<ContractBaseClause> = {},
): ContractBaseClause => ({
  id,
  title: id,
  description: '',
  fixed: false,
  defaultOn: true,
  text,
  ...opts,
});

const CLAUSES: ContractBaseClause[] = [
  clause('partes', '# CONTRATO Nº {{rentalId}}\n\nLOCATÁRIO: {{driverName}}.', { fixed: true }),
  clause('prazo', '## DO PRAZO\nComeça em {{startDate}}.', { fixed: true }),
  clause('caucao', '## DA CAUÇÃO\nCaução de {{caucaoAmount}}.'),
  clause('km', '## DA QUILOMETRAGEM\nFranquia de {{franchiseKm}} km.', { defaultOn: false }),
  clause('assinatura', 'São Paulo, {{contractDate}}.', { fixed: true }),
];

function text(doc: PaperDocument): string[] {
  return doc.paragraphs.map((p) =>
    p.segments
      .map((s) => (s.kind === 'field' ? `{${s.field}}` : s.kind === 'hidden' ? `<${s.label}>` : s.text))
      .join(''),
  );
}

describe('catálogo de campos', () => {
  it('todo campo do app (46: + companyCity, extraKmPrice, lateFineTerms, kmTerms) tem valor de exemplo, e nenhum a mais', () => {
    const labels = Object.keys(FIELD_LABELS).sort();
    expect(labels.length).toBe(46);
    expect(Object.keys(FIELD_EXAMPLES).sort()).toEqual(labels);
  });
});

describe('parseInline', () => {
  it('separa texto, campo e negrito', () => {
    expect(parseInline('Placa {{ vehiclePlate }} e **multa**.')).toEqual([
      { kind: 'text', text: 'Placa ' },
      { kind: 'field', field: 'vehiclePlate', tone: 'ok' },
      { kind: 'text', text: ' e ' },
      { kind: 'text', text: 'multa', bold: true },
      { kind: 'text', text: '.' },
    ]);
  });
});

describe('buildBaseDocument', () => {
  it('só as cláusulas escolhidas, numeradas na ordem; fixas sem ## não levam número', () => {
    const doc = buildBaseDocument(CLAUSES, new Set(['caucao']), null);
    expect(text(doc)).toEqual([
      'CONTRATO Nº {rentalId}',
      'LOCATÁRIO: {driverName}.',
      'CLÁUSULA 1ª — DO PRAZO. Começa em {startDate}.',
      'CLÁUSULA 2ª — DA CAUÇÃO. Caução de {caucaoAmount}.',
      'São Paulo, {contractDate}.',
    ]);
    expect(doc.paragraphs[0].role).toBe('title');
    expect(doc.clauses).toBe(2);
    expect(doc.fields).toEqual(['rentalId', 'driverName', 'startDate', 'caucaoAmount', 'contractDate']);
  });

  it('renumera ao desmarcar uma opcional do meio e destaca a cláusula em foco', () => {
    const doc = buildBaseDocument(CLAUSES, new Set(['km']), 'km');
    expect(text(doc)).toContain('CLÁUSULA 2ª — DA QUILOMETRAGEM. Franquia de {franchiseKm} km.');
    expect(text(doc).join('\n')).not.toContain('CAUÇÃO');
    expect(doc.paragraphs.filter((p) => p.focus).map((p) => p.id)).toEqual(['km-1']);
  });
});

describe('buildMarkdownDocument', () => {
  it('título, cabeçalhos em negrito e contagem das cláusulas já numeradas', () => {
    const doc = buildMarkdownDocument('# CONTRATO\n\n## CLÁUSULA 1ª — DO OBJETO\nO carro {{vehiclePlate}}.\n');
    expect(doc.paragraphs[0].role).toBe('title');
    expect(doc.clauses).toBe(1);
    expect(doc.fields).toEqual(['vehiclePlate']);
  });
});

describe('buildMaskedDocument', () => {
  const paragraphs = [
    { id: 'p1', text: 'LOCATÁRIO: [NOME_1], CPF [CPF_1].' },
    { id: 'p2', text: 'CLÁUSULA 2ª. Pagará R$ 650,00 por semana.' },
  ];
  const sug = (id: string, paragraphId: string, excerpt: string, field: string): SuggestionView => ({
    id,
    paragraphId,
    field,
    fieldLabel: '',
    excerpt,
    context: '',
    confidence: 0.9,
    reason: '',
    alternatives: null,
  });
  const certain = sug('s0001', 'p1', '[CPF_1]', 'driverCpf');
  const doubt = sug('s0002', 'p2', 'R$ 650,00', 'periodRate');

  it('consentimento: marcas viram rótulos amigáveis, sem campo', () => {
    const doc = buildMaskedDocument(paragraphs, { stage: 'consent' });
    expect(text(doc)[0]).toBe('LOCATÁRIO: <nome escondido>, CPF <CPF escondido>.');
    expect(doc.fields).toEqual([]);
  });

  it('campos: certa vira campo verde, dúvida sem resposta fica âmbar', () => {
    const doc = buildMaskedDocument(paragraphs, {
      stage: 'fields',
      suggestions: [certain, doubt],
      doubtIds: new Set(['s0002']),
      decisions: {},
    });
    expect(text(doc)).toEqual([
      'LOCATÁRIO: <nome escondido>, CPF {driverCpf}.',
      'CLÁUSULA 2ª. Pagará {periodRate} por semana.',
    ]);
    const field = doc.paragraphs[1].segments.find((s) => s.kind === 'field');
    expect(field).toMatchObject({ tone: 'doubt' });
    expect(doc.clauses).toBe(1);
  });

  it('decisões: troca de campo vale, recusa deixa o texto original', () => {
    const doc = buildMaskedDocument(paragraphs, {
      stage: 'review',
      suggestions: [certain, doubt],
      doubtIds: new Set(['s0002']),
      decisions: {
        s0001: { id: 's0001', field: 'driverCpf', accept: false },
        s0002: { id: 's0002', field: 'totalAmount', accept: true },
      },
    });
    expect(text(doc)).toEqual([
      'LOCATÁRIO: <nome escondido>, CPF CPF escondido.',
      'CLÁUSULA 2ª. Pagará {totalAmount} por semana.',
    ]);
    expect(doc.fields).toEqual(['totalAmount']);
  });
});
