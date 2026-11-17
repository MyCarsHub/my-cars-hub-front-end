import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SuggestionView } from './ai/contract-ai.types';
import { ContractPaper } from './contract-paper';
import {
  PaperSegment,
  SheetParagraph,
  buildMaskedDocument,
  maskedCountsText,
  protectedLabel,
} from './contract-paper.model';

const P: SheetParagraph = {
  id: 'p0011',
  text: 'Nome: Rafael Augusto Lima, CPF 083.016.613-05.',
  spans: [
    { start: 6, end: 25, kind: 'NAME' },
    { start: 31, end: 45, kind: 'CPF' },
  ],
};

const mark = (over: Partial<SuggestionView>): SuggestionView => ({
  id: 'q0001',
  paragraphId: 'p0011',
  field: '',
  fieldLabel: '',
  excerpt: '',
  context: '',
  confidence: 0,
  reason: '',
  alternatives: null,
  ...over,
});

const kinds = (segs: PaperSegment[]) => segs.map((s) => s.kind);

describe('folha com o contrato real', () => {
  it('consentimento: o texto real fica legível e o que a IA não recebe ganha o cadeado', () => {
    const doc = buildMaskedDocument([P], { stage: 'consent' });
    const segs = doc.paragraphs[0].segments;
    expect(kinds(segs)).toEqual(['text', 'protected', 'text', 'protected', 'text']);
    expect(segs[1]).toEqual({ kind: 'protected', text: 'Rafael Augusto Lima', label: protectedLabel('NAME') });
    expect(segs[3]).toMatchObject({ kind: 'protected', text: '083.016.613-05' });
    expect(protectedLabel('CPF')).toBe('Protegido: a IA não recebe este CPF');
    // Nenhum marcador nem «escondido» no texto real.
    expect(JSON.stringify(segs)).not.toMatch(/\[[A-Z]+_\d+\]|escondid/);
  });

  it('bloco confirmado: o campo aparece sobre o texto real, que continua legível', () => {
    const doc = buildMaskedDocument([P], {
      stage: 'review',
      suggestions: [
        mark({ id: 'q0001', field: 'driverName', excerpt: 'Rafael Augusto Lima', blockId: 'b1',
          places: [{ paragraphId: 'p0011', excerpt: 'Rafael Augusto Lima' }] }),
      ],
      decisions: { q0001: { id: 'q0001', field: 'driverName', accept: true, confirmed: true } },
    });
    const segs = doc.paragraphs[0].segments;
    expect(segs[1]).toMatchObject({ kind: 'field', field: 'driverName', original: 'Rafael Augusto Lima' });
    // O CPF sem resposta continua só protegido.
    expect(segs.find((s) => s.kind === 'protected')).toMatchObject({ text: '083.016.613-05' });
    expect(doc.fields).toEqual(['driverName']);
  });

  it('bloco sem resposta: proposto em âmbar na etapa das perguntas, fixo no «Conferir»', () => {
    const s = mark({ id: 'q0001', field: 'driverName', excerpt: 'Rafael Augusto Lima', blockId: 'b1',
      places: [{ paragraphId: 'p0011', excerpt: 'Rafael Augusto Lima' }] });
    const fields = buildMaskedDocument([P], { stage: 'fields', suggestions: [s], doubtIds: new Set(['q0001']), focusId: 'b1' });
    expect(fields.paragraphs[0].segments[1]).toMatchObject({ kind: 'field', tone: 'doubt', focus: true });
    const review = buildMaskedDocument([P], { stage: 'review', suggestions: [s], doubtIds: new Set(['q0001']) });
    expect(review.paragraphs[0].segments[1]).toEqual({ kind: 'kept', text: 'Rafael Augusto Lima', focus: false });
    expect(review.fields).toEqual([]);
  });

  it('pergunta sem escopo não presume campo antes da resposta', () => {
    const s = mark({ id: 'q0001', field: '', excerpt: 'Rafael Augusto Lima', blockId: 'b2',
      places: [{ paragraphId: 'p0011', excerpt: 'Rafael Augusto Lima' }] });
    const doc = buildMaskedDocument([P], { stage: 'fields', suggestions: [s], doubtIds: new Set(['q0001']) });
    expect(doc.paragraphs[0].segments[1]).toMatchObject({ kind: 'kept' });
  });

  it('título do arquivo real vem em negrito', () => {
    const doc = buildMaskedDocument(
      [{ id: 'p0', text: 'Contrato', spans: [], heading: true }, { id: 'p1', text: 'Informações do Locador', spans: [], heading: true }],
      { stage: 'consent' },
    );
    expect(doc.paragraphs[0].role).toBe('title');
    expect(doc.paragraphs[1].segments[0]).toEqual({ kind: 'text', text: 'Informações do Locador', bold: true });
  });

  it('contagem do que a IA não recebe, em palavras', () => {
    expect(maskedCountsText({ CPF: 2, NAME: 4, ADDRESS: 1 })).toBe('4 nomes, 1 endereço e 2 CPFs');
    expect(maskedCountsText({ PHONE: 1 })).toBe('1 telefone');
    expect(maskedCountsText({})).toBeNull();
    expect(maskedCountsText(undefined)).toBeNull();
  });
});

describe('ContractPaper: cadeado e «Ver como a IA recebe»', () => {
  function mount(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(ContractPaper);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('o dado protegido aparece real, com cadeado, e a legenda explica', () => {
    const doc = buildMaskedDocument([P], { stage: 'consent' });
    const { host } = mount({ paragraphs: doc.paragraphs });
    const locked = host.querySelectorAll('[data-protected]');
    expect(locked.length).toBe(2);
    expect(locked[1].textContent).toContain('083.016.613-05');
    expect(locked[1].getAttribute('title')).toBe('Protegido: a IA não recebe este CPF');
    expect(locked[1].querySelector('svg')).toBeTruthy();
    expect(host.textContent).toContain('Protegido: a IA não recebe');
  });

  it('campo sobre o texto real: valor legível e o nome do campo ao lado', () => {
    const doc = buildMaskedDocument([P], {
      stage: 'review',
      suggestions: [mark({ field: 'driverName', excerpt: 'Rafael Augusto Lima', blockId: 'b1',
        places: [{ paragraphId: 'p0011', excerpt: 'Rafael Augusto Lima' }] })],
      decisions: { q0001: { id: 'q0001', field: 'driverName', accept: true, confirmed: true } },
    });
    const { host } = mount({ paragraphs: doc.paragraphs });
    expect(host.querySelector('article')?.textContent).toContain('Rafael Augusto Lima');
    expect(host.querySelector('[data-field-note]')?.textContent).toBe('Nome do motorista');
  });

  it('o botão «Ver como a IA recebe» só aparece quando disponível e avisa a troca', () => {
    const { host: none } = mount({ paragraphs: [] });
    expect(none.querySelector('[data-ai-view]')).toBeNull();

    const { host, fixture } = mount({ aiViewAvailable: true, aiView: false });
    const seen: boolean[] = [];
    fixture.componentInstance.aiViewChange.subscribe((v) => seen.push(v));
    const btn = host.querySelector<HTMLButtonElement>('[data-ai-view]')!;
    expect(btn.textContent).toContain('Ver como a IA recebe');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    btn.click();
    expect(seen).toEqual([true]);
    fixture.componentRef.setInput('aiView', true);
    fixture.detectChanges();
    expect(btn.textContent).toContain('Ver o meu contrato');
  });
});
