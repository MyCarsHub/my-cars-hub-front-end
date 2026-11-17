import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContractAiService } from './contract-ai.service';
import { BlockView, DraftStatusResponse, QuestionView } from './contract-ai.types';

const BASE = 'settings/contract-template';
const ID = '11111111-2222-3333-4444-555555555555';

const COMPANY_BLOCK: BlockView = {
  id: 'b0001',
  kind: 'CONFIRM',
  party: 'COMPANY',
  partyLabel: 'Locadora (locador, dono, representante ou a própria locadora)',
  aiParty: null,
  aiEvidence: null,
  source: 'LABEL',
  label: 'LOCADORA',
  sectionPath: ['CONTRATO'],
  options: [
    { party: 'DRIVER', label: 'Motorista (Locatário)' },
    { party: 'COMPANY', label: 'Locadora' },
  ],
  appliesTo: 2,
  items: [
    {
      id: 'q0001',
      kind: 'NAME',
      excerpt: 'Alfa Locações Ltda',
      context: 'LOCADORA: Alfa Locações Ltda, CNPJ 11.637.265/0001-11',
      places: [{ paragraphId: 'p0002', excerpt: 'Alfa Locações Ltda' }],
      fieldsByParty: {
        COMPANY: [{ field: 'companyName', label: 'Nome da locadora' }],
        DRIVER: [{ field: 'driverName', label: 'Nome do motorista' }],
      },
    },
    {
      id: 'q0002',
      kind: 'CNPJ',
      excerpt: '11.637.265/0001-11',
      context: 'LOCADORA: Alfa Locações Ltda, CNPJ 11.637.265/0001-11',
      places: [{ paragraphId: 'p0002', excerpt: '11.637.265/0001-11' }],
      fieldsByParty: { COMPANY: [{ field: 'companyCnpj', label: 'CNPJ da locadora' }] },
    },
  ],
};

const WITNESS_BLOCK: BlockView = {
  id: 'b0003',
  kind: 'QUESTION',
  party: null,
  partyLabel: null,
  aiParty: 'THIRD',
  aiEvidence: 'Testemunha:',
  source: 'AI',
  label: null,
  sectionPath: [],
  options: [
    { party: 'DRIVER', label: 'Motorista (Locatário)' },
    { party: 'COMPANY', label: 'Locadora' },
    { party: 'THIRD', label: 'Contato de terceiro do motorista' },
  ],
  appliesTo: 2,
  items: [
    {
      id: 'q0007',
      kind: 'NAME',
      excerpt: 'Fábio Moreira Cunha',
      context: 'Testemunha: Fábio Moreira Cunha, CPF 859.952.890-47',
      places: [{ paragraphId: 'p0040', excerpt: 'Fábio Moreira Cunha' }],
      fieldsByParty: {
        DRIVER: [{ field: 'driverName', label: 'Nome do motorista' }],
        COMPANY: [{ field: 'companyRepresentative', label: 'Representante da locadora' }],
        THIRD: [
          { field: 'driverReference1', label: 'Referência 1 do motorista' },
          { field: 'driverReference2', label: 'Referência 2 do motorista' },
          { field: 'driverReference3', label: 'Referência 3 do motorista' },
        ],
      },
    },
    {
      id: 'q0008',
      kind: 'CPF',
      excerpt: '859.952.890-47',
      context: 'Testemunha: Fábio Moreira Cunha, CPF 859.952.890-47',
      places: [{ paragraphId: 'p0040', excerpt: '859.952.890-47' }],
      fieldsByParty: { DRIVER: [{ field: 'driverCpf', label: 'CPF do motorista' }] },
    },
  ],
};

const question = (id: string): QuestionView => ({
  id,
  kind: 'CPF',
  excerpt: 'x',
  context: 'x',
  places: [{ paragraphId: 'p1', excerpt: 'x' }],
  options: [{ field: 'driverCpf', label: 'CPF do motorista' }],
  nearby: [],
});

function draft(over: Partial<DraftStatusResponse> = {}): DraftStatusResponse {
  return {
    draftId: ID,
    status: 'NEEDS_REVIEW',
    failureCode: null,
    filename: 'contrato.pdf',
    layoutSimplified: false,
    certain: [],
    doubts: [],
    questions: [question('q0001'), question('q0002'), question('q0007'), question('q0008'), question('q0099')],
    blocks: [COMPANY_BLOCK, WITNESS_BLOCK],
    ...over,
  };
}

describe('ContractAiService: blocos de dados de pessoa', () => {
  let http: HttpTestingController;
  let svc: ContractAiService;

  const find = (suffix: string, method: string) =>
    http.expectOne((r) => r.url.endsWith(`${BASE}${suffix}`) && r.method === method);

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(ContractAiService);
    svc.draftId.set(ID);
    svc.draft.set(draft());
  });

  afterEach(() => {
    svc.stopPolling();
    sessionStorage.clear();
  });

  it('pergunta por bloco: a pergunta por valor que um bloco cobre não aparece de novo', () => {
    const asks = svc.asks();
    expect(asks.map((a) => a.id)).toEqual(['b0001', 'b0003', 'q0099']);
    expect(asks[0].block?.id).toBe('b0001');
    expect(asks[2].question?.id).toBe('q0099');
  });

  it('sem blocos (backend anterior), as perguntas por valor seguem como antes', () => {
    svc.draft.set(draft({ blocks: undefined }));
    expect(svc.asks().map((a) => a.id)).toEqual(['q0001', 'q0002', 'q0007', 'q0008', 'q0099']);
  });

  it('confirmar o bloco vira o campo da parte em cada dado; terceiro deixa fixo', () => {
    svc.setBlockAnswer('b0001', 'COMPANY');
    svc.setBlockAnswer('b0003', 'THIRD');
    const eff = svc.effectiveDecisions();
    expect(eff['q0001']).toEqual({ id: 'q0001', field: 'companyName', accept: true, confirmed: true });
    expect(eff['q0002']).toEqual({ id: 'q0002', field: 'companyCnpj', accept: true, confirmed: true });
    expect(eff['q0007']).toEqual({ id: 'q0007', field: null, accept: false, confirmed: true });
    expect(eff['q0008']).toEqual({ id: 'q0008', field: null, accept: false, confirmed: true });
  });

  it('parte sem campo para o dado deixa o dado fixo (CNPJ respondido como do motorista)', () => {
    svc.setBlockAnswer('b0001', 'DRIVER');
    expect(svc.effectiveDecisions()['q0001'].field).toBe('driverName');
    expect(svc.effectiveDecisions()['q0002']).toEqual({ id: 'q0002', field: null, accept: false, confirmed: true });
  });

  it('terceiro: a referência escolhida vence o bloco e some ao trocar de parte', () => {
    svc.setBlockAnswer('b0003', 'THIRD');
    svc.setItemReference('q0007', 'driverReference2');
    expect(svc.effectiveDecisions()['q0007']).toEqual({
      id: 'q0007',
      field: 'driverReference2',
      accept: true,
      confirmed: true,
    });
    svc.setBlockAnswer('b0003', 'DRIVER');
    expect(svc.decisions()['q0007']).toBeUndefined();
    expect(svc.effectiveDecisions()['q0007'].field).toBe('driverName');
  });

  it('parte fora das opções do bloco é ignorada (Terceiro só quando o contrato ou a IA disse)', () => {
    svc.setBlockAnswer('b0001', 'THIRD');
    expect(svc.blockAnswers()['b0001']).toBeUndefined();
    svc.setBlockAnswer('b0001', 'NONE');
    expect(svc.blockAnswers()['b0001']).toBe('NONE');
  });

  it('o PUT leva os blocos e as decisões explícitas; bloco desconhecido não vai', () => {
    sessionStorage.setItem('contractAiBlocks', JSON.stringify({ b9999: 'DRIVER' }));
    svc.blockAnswers.set({ b9999: 'DRIVER' });
    svc.setBlockAnswer('b0001', 'COMPANY');
    svc.setBlockAnswer('b0003', 'THIRD');
    svc.setItemReference('q0007', 'driverReference1');
    svc.commitDecisions();
    const put = find(`/drafts/${ID}/decisions`, 'PUT');
    expect(put.request.body).toEqual({
      decisions: [{ id: 'q0007', field: 'driverReference1', accept: true, confirmed: true }],
      blocks: [
        { id: 'b0001', party: 'COMPANY' },
        { id: 'b0003', party: 'THIRD' },
      ],
    });
    put.flush({ draftId: ID, status: 'READY', acceptedCount: 3, pendingDoubtIds: [] });
  });

  it('sem blocos respondidos o PUT mantém a forma antiga (sem a chave blocks)', () => {
    svc.draft.set(draft({ blocks: undefined }));
    svc.setDecision({ id: 'q0001', field: 'driverCpf', accept: true, confirmed: true });
    svc.commitDecisions();
    const put = find(`/drafts/${ID}/decisions`, 'PUT');
    expect(Object.keys(put.request.body as object)).toEqual(['decisions']);
    put.flush({ draftId: ID, status: 'READY', acceptedCount: 1, pendingDoubtIds: [] });
  });

  it('salvar com blocos marca questionsReviewed', () => {
    svc.draft.set(draft({ questions: [], status: 'READY' }));
    svc.save(false);
    const post = find(`/drafts/${ID}/save`, 'POST');
    expect(post.request.body).toEqual({ questionsReviewed: true });
    post.flush({ id: 't1' });
  });

  it('a sessão guarda só ids e partes, e uma entrada estranha é descartada ao retomar', () => {
    svc.setBlockAnswer('b0001', 'COMPANY');
    const raw = sessionStorage.getItem('contractAiBlocks') ?? '';
    expect(JSON.parse(raw)).toEqual({ b0001: 'COMPANY' });
    expect(raw).not.toContain('Alfa');

    svc.reset();
    sessionStorage.setItem(
      'contractAiBlocks',
      JSON.stringify({ b0001: 'COMPANY', 'b 2': 'DRIVER', b0003: 'Fiador', b0004: 'NONE' }),
    );
    sessionStorage.setItem('contractAiDraftId', ID);
    svc.init();
    find('/ai-capability', 'GET').flush({ enabled: true });
    expect(svc.blockAnswers()).toEqual({ b0001: 'COMPANY', b0004: 'NONE' });
    find(`/drafts/${ID}`, 'GET').flush(draft());
  });

  it('blocos sem resposta ficam listados (e os dados deles, fixos)', () => {
    svc.setBlockAnswer('b0001', 'COMPANY');
    expect(svc.unansweredBlocks().map((b) => b.id)).toEqual(['b0003']);
    expect(svc.effectiveDecisions()['q0007']).toBeUndefined();
    expect(svc.unanswered().map((q) => q.id)).toEqual(['q0099']);
  });

  it('aba nova: as respostas gravadas voltam do servidor e o PUT seguinte não as perde', () => {
    svc.reset();
    sessionStorage.setItem('contractAiDraftId', ID);
    svc.init();
    find('/ai-capability', 'GET').flush({ enabled: true });
    find(`/drafts/${ID}`, 'GET').flush(
      draft({
        answers: {
          blocks: [
            { id: 'b0001', party: 'COMPANY', confirmed: true },
            { id: 'b0003', party: 'THIRD', confirmed: true },
            { id: 'b9999', party: 'DRIVER', confirmed: true },
          ],
          decisions: [
            // Expandidas dos blocos: não voltam como decisão explícita.
            { id: 'q0001', field: 'companyName', accept: true, confirmed: true },
            { id: 'q0002', field: 'companyCnpj', accept: true, confirmed: true },
            { id: 'q0008', field: null, accept: false, confirmed: true },
            // A referência escolhida volta.
            { id: 'q0007', field: 'driverReference2', accept: true, confirmed: true },
            { id: 'q0099', field: 'driverCpf', accept: true, confirmed: true },
          ],
        },
      }),
    );
    expect(svc.blockAnswers()).toEqual({ b0001: 'COMPANY', b0003: 'THIRD' });
    expect(Object.keys(svc.decisions()).sort()).toEqual(['q0007', 'q0099']);
    expect(svc.effectiveDecisions()['q0001'].field).toBe('companyName');
    expect(svc.unansweredBlocks()).toEqual([]);

    // Trocar a parte do bloco não fica preso à decisão expandida antiga.
    svc.setBlockAnswer('b0001', 'DRIVER');
    expect(svc.effectiveDecisions()['q0001'].field).toBe('driverName');

    svc.commitDecisions();
    const put = find(`/drafts/${ID}/decisions`, 'PUT');
    expect(put.request.body).toEqual({
      decisions: [
        { id: 'q0007', field: 'driverReference2', accept: true, confirmed: true },
        { id: 'q0099', field: 'driverCpf', accept: true, confirmed: true },
      ],
      blocks: [
        { id: 'b0001', party: 'DRIVER' },
        { id: 'b0003', party: 'THIRD' },
      ],
    });
    put.flush({ draftId: ID, status: 'READY', acceptedCount: 2, pendingDoubtIds: [] });
  });

  it('o que esta aba respondeu e não gravou vence o servidor', () => {
    svc.reset();
    sessionStorage.setItem('contractAiDraftId', ID);
    sessionStorage.setItem('contractAiBlocks', JSON.stringify({ b0001: 'NONE' }));
    svc.init();
    find('/ai-capability', 'GET').flush({ enabled: true });
    find(`/drafts/${ID}`, 'GET').flush(
      draft({ answers: { blocks: [{ id: 'b0001', party: 'COMPANY', confirmed: true }], decisions: [] } }),
    );
    expect(svc.blockAnswers()).toEqual({ b0001: 'NONE' });
  });

  it('«Ver como a IA recebe» do servidor: pedido uma vez por rascunho', () => {
    svc.loadAiView();
    svc.loadAiView();
    find(`/drafts/${ID}/ai-view`, 'GET').flush({
      draftId: ID,
      status: 'READY',
      paragraphs: [{ id: 'p1', text: 'LOCATÁRIO: [NOME_1]' }],
      maskedTextSha256: 'a',
      consentedTextSha256: 'a',
      matchesConsent: true,
      maskedCounts: { NAME: 1 },
    });
    expect(svc.aiView()?.paragraphs[0].text).toBe('LOCATÁRIO: [NOME_1]');
    http.verify();
  });

  it('o contrato real é pedido uma vez por rascunho', () => {
    svc.loadDocument();
    svc.loadDocument();
    find(`/drafts/${ID}/document`, 'GET').flush({
      draftId: ID,
      status: 'NEEDS_REVIEW',
      paragraphs: [],
      maskedCounts: { CPF: 1 },
    });
    expect(svc.document()?.maskedCounts).toEqual({ CPF: 1 });
    http.verify();
  });
});
