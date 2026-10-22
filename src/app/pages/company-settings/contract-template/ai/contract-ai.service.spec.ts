import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantResetRegistry } from '../../../../services/tenant-reset.registry';
import { ContractAiCapability } from './contract-ai-capability';
import { POLL_MAX_ATTEMPTS, ContractAiService, pollDelay } from './contract-ai.service';
import { DraftStatusResponse } from './contract-ai.types';

const BASE = 'settings/contract-template';
const ID = '11111111-2222-3333-4444-555555555555';

function draft(over: Partial<DraftStatusResponse> = {}): DraftStatusResponse {
  return {
    draftId: ID,
    status: 'ANALYZING',
    failureCode: null,
    filename: 'contrato.docx',
    layoutSimplified: false,
    certain: [],
    doubts: [],
    ...over,
  };
}

describe('ContractAiService', () => {
  let http: HttpTestingController;
  let svc: ContractAiService;

  const find = (suffix: string, method: string) =>
    http.expectOne((r) => r.url.endsWith(`${BASE}${suffix}`) && r.method === method);

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(ContractAiService);
  });

  afterEach(() => {
    svc.stopPolling();
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it('com a capacidade desligada nada é consultado além dela', () => {
    svc.init();
    find('/ai-capability', 'GET').flush({ enabled: false });

    expect(svc.enabled()).toBe(false);
    expect(svc.step()).toBe('intro');
    http.expectNone((r) => r.url.includes('/drafts'));
  });

  it('erro na capacidade equivale a desligada', () => {
    svc.init();
    find('/ai-capability', 'GET').flush('x', { status: 500, statusText: 'err' });
    expect(svc.enabled()).toBe(false);
  });

  it('retoma o rascunho guardado na sessão depois de um reload', () => {
    sessionStorage.setItem('contractAiDraftId', ID);
    svc.init();
    find('/ai-capability', 'GET').flush({ enabled: true });

    find(`/drafts/${ID}`, 'GET').flush(draft({ status: 'NEEDS_REVIEW' }));
    expect(svc.step()).toBe('doubts');
  });

  it('ignora na sessão um valor que não é UUID e o remove', () => {
    sessionStorage.setItem('contractAiDraftId', 'qualquer-coisa');
    svc.init();
    find('/ai-capability', 'GET').flush({ enabled: true });

    http.expectNone((r) => r.url.includes('/drafts/'));
    expect(sessionStorage.getItem('contractAiDraftId')).toBeNull();
  });

  it('envia o arquivo, guarda só o draftId e faz polling com backoff até sair de ANALYZING', () => {
    const file = new File(['x'], 'contrato.docx');
    svc.submit(file);
    const post = find('/drafts', 'POST');
    expect((post.request.body as FormData).get('file')).toBe(file);
    post.flush({ draftId: ID, status: 'ANALYZING' }, { status: 202, statusText: 'Accepted' });

    expect(sessionStorage.getItem('contractAiDraftId')).toBe(ID);
    find(`/drafts/${ID}`, 'GET').flush(draft());

    // Nada antes do atraso; depois dele, a próxima consulta.
    vi.advanceTimersByTime(pollDelay(1) - 1);
    http.expectNone((r) => r.url.includes(`/drafts/${ID}`));
    vi.advanceTimersByTime(1);
    find(`/drafts/${ID}`, 'GET').flush(draft());

    vi.advanceTimersByTime(pollDelay(2));
    find(`/drafts/${ID}`, 'GET').flush(draft({ status: 'READY' }));

    expect(svc.step()).toBe('preview');
    vi.advanceTimersByTime(60_000);
    http.expectNone((r) => r.url.includes(`/drafts/${ID}`));
  });

  it('o atraso do polling cresce e tem teto', () => {
    expect(pollDelay(1)).toBeGreaterThan(pollDelay(0));
    expect(pollDelay(POLL_MAX_ATTEMPTS)).toBe(5000);
  });

  it('stopPolling cancela a próxima consulta', () => {
    svc.draftId.set(ID);
    svc.startPolling();
    find(`/drafts/${ID}`, 'GET').flush(draft());
    svc.stopPolling();

    vi.advanceTimersByTime(60_000);
    http.expectNone((r) => r.url.includes(`/drafts/${ID}`));
  });

  it('para com mensagem quando o limite de tentativas acaba', () => {
    svc.draftId.set(ID);
    svc.startPolling();
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      find(`/drafts/${ID}`, 'GET').flush(draft());
      vi.advanceTimersByTime(5000);
    }
    expect(svc.pollTimedOut()).toBe(true);
    http.expectNone((r) => r.url.includes(`/drafts/${ID}`));
  });

  it('404 no polling limpa o rascunho e explica', () => {
    sessionStorage.setItem('contractAiDraftId', ID);
    svc.draftId.set(ID);
    svc.startPolling();
    find(`/drafts/${ID}`, 'GET').flush({ message: 'x' }, { status: 404, statusText: 'nf' });

    expect(svc.draftId()).toBeNull();
    expect(svc.error()).toContain('não existe mais');
    expect(sessionStorage.getItem('contractAiDraftId')).toBeNull();
  });

  it('DRAFT_LIMIT_REACHED no envio vira mensagem útil e não cria rascunho', () => {
    svc.submit(new File(['x'], 'a.docx'));
    find('/drafts', 'POST').flush(
      { message: 'limite', code: 'DRAFT_LIMIT_REACHED' },
      { status: 409, statusText: 'Conflict' },
    );

    expect(svc.draftId()).toBeNull();
    expect(svc.error()).toContain('análises em andamento');
    expect(svc.busy()).toBe(false);
  });

  it('segundo submit enquanto o primeiro voa não duplica a requisição', () => {
    svc.submit(new File(['x'], 'a.docx'));
    svc.submit(new File(['x'], 'a.docx'));
    const reqs = http.match((r) => r.url.endsWith(`${BASE}/drafts`) && r.method === 'POST');
    expect(reqs.length).toBe(1);
  });

  it('PUT das decisões manda o conjunto inteiro no corpo esperado', () => {
    svc.draftId.set(ID);
    svc.draft.set(draft({ status: 'NEEDS_REVIEW' }));
    svc.setDecision({ id: 's1', field: 'driverName', accept: true });
    svc.setDecision({ id: 's2', field: 'vehiclePlate', accept: false });
    svc.commitDecisions();

    const put = find(`/drafts/${ID}/decisions`, 'PUT');
    expect(put.request.body).toEqual({
      decisions: [
        { id: 's1', field: 'driverName', accept: true },
        { id: 's2', field: 'vehiclePlate', accept: false },
      ],
    });
    put.flush({ draftId: ID, status: 'READY', acceptedCount: 1, pendingDoubtIds: [] });
    expect(svc.step()).toBe('preview');
  });

  it('as respostas dadas sobrevivem ao reload (só ids e campos)', () => {
    svc.draftId.set(ID);
    svc.setDecision({ id: 's1', field: 'driverName', accept: true });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const again = TestBed.inject(ContractAiService);
    sessionStorage.setItem('contractAiDraftId', ID);
    again.init();
    TestBed.inject(HttpTestingController)
      .expectOne((r) => r.url.endsWith('/ai-capability'))
      .flush({ enabled: true });

    expect(again.decisions()['s1']).toEqual({ id: 's1', field: 'driverName', accept: true });
    again.stopPolling();
  });

  it('409 ACTIVE_TEMPLATE_CHANGED_SINCE_ANALYSIS pede confirmação e só então reenvia com confirmOverwrite', () => {
    svc.draftId.set(ID);
    svc.draft.set(draft({ status: 'READY' }));
    svc.save(false);

    const first = find(`/drafts/${ID}/save`, 'POST');
    expect(first.request.body).toEqual({});
    first.flush(
      { message: 'mudou', code: 'ACTIVE_TEMPLATE_CHANGED_SINCE_ANALYSIS' },
      { status: 409, statusText: 'Conflict' },
    );

    expect(svc.overwriteCode()).toBe('ACTIVE_TEMPLATE_CHANGED_SINCE_ANALYSIS');
    expect(svc.draftId()).toBe(ID); // rascunho preservado
    http.expectNone((r) => r.url.endsWith('/save')); // nada reenviado sozinho

    svc.save(true);
    const second = find(`/drafts/${ID}/save`, 'POST');
    expect(second.request.body).toEqual({ confirmOverwrite: true });
    second.flush({ id: 't', filename: 'c.docx' });
    expect(svc.step()).toBe('saved');
    expect(svc.draftId()).toBeNull();
  });

  it('falha genérica no save preserva o rascunho e mostra mensagem', () => {
    svc.draftId.set(ID);
    svc.draft.set(draft({ status: 'READY' }));
    svc.save(false);
    find(`/drafts/${ID}/save`, 'POST').flush(
      { message: 'boom' },
      { status: 500, statusText: 'err' },
    );

    expect(svc.draftId()).toBe(ID);
    expect(svc.error()).toContain('Não foi possível salvar');
    expect(svc.busy()).toBe(false);
  });

  it('DOUBTS_PENDING no save recarrega o rascunho', () => {
    svc.draftId.set(ID);
    svc.draft.set(draft({ status: 'READY' }));
    svc.save(false);
    find(`/drafts/${ID}/save`, 'POST').flush(
      { message: 'x', code: 'DOUBTS_PENDING' },
      { status: 409, statusText: 'Conflict' },
    );
    find(`/drafts/${ID}`, 'GET').flush(draft({ status: 'NEEDS_REVIEW' }));
    expect(svc.step()).toBe('doubts');
  });

  it('preview sem rascunho recusa e não chama /drafts/null/preview', () => {
    let failed = false;
    svc.preview().subscribe({ error: () => (failed = true) });
    expect(failed).toBe(true);
    http.expectNone((r) => r.url.includes('/preview'));
  });

  it('respostas restauradas inválidas (id, campo, tipos) são descartadas', () => {
    sessionStorage.setItem('contractAiDraftId', ID);
    sessionStorage.setItem(
      'contractAiDecisions',
      JSON.stringify({
        s0001: { id: 's0001', field: 'driverName', accept: true },
        '../x': { id: '../x', field: 'driverName', accept: true },
        s0002: { id: 's0002', field: '__proto__', accept: true },
        s0003: { id: 's0003', field: 'driverName', accept: 'sim' },
        s0004: { id: 's9999', field: 'driverName', accept: true },
      }),
    );
    svc.init();
    find('/ai-capability', 'GET').flush({ enabled: true });

    expect(svc.decisions()).toEqual({
      s0001: { id: 's0001', field: 'driverName', accept: true },
    });
  });

  it('capacidade fica em cache: uma só chamada, mesmo reabrindo a tela', () => {
    const cap = TestBed.inject(ContractAiCapability);
    cap.load();
    find('/ai-capability', 'GET').flush({ enabled: false });
    cap.load();
    svc.init();
    http.expectNone((r) => r.url.endsWith('/ai-capability'));
    expect(cap.state()).toBe('off');
  });

  it('403/5xx na capacidade vira indisponível e não repete a chamada', () => {
    const cap = TestBed.inject(ContractAiCapability);
    cap.load();
    find('/ai-capability', 'GET').flush('x', { status: 403, statusText: 'Forbidden' });
    cap.load();
    cap.load();
    http.expectNone((r) => r.url.endsWith('/ai-capability'));
    expect(cap.state()).toBe('unavailable');
    expect(cap.enabled()).toBe(false);
  });

  it('a troca de empresa invalida o cache da capacidade', () => {
    const cap = TestBed.inject(ContractAiCapability);
    cap.load();
    find('/ai-capability', 'GET').flush({ enabled: true });
    TestBed.inject(TenantResetRegistry).run();
    cap.load();
    find('/ai-capability', 'GET').flush({ enabled: false });
    expect(cap.state()).toBe('off');
  });

  it('o consentimento manda a rota exibida; 409 CONSENT_PROVIDER_CHANGED recarrega texto e rota', () => {
    svc.draftId.set(ID);
    svc.draft.set(draft({ status: 'AWAITING_CONSENT' }));
    svc.loadMaskedText();
    find(`/drafts/${ID}/masked-text`, 'GET').flush({
      draftId: ID,
      paragraphs: [],
      maskedTextSha256: 'a'.repeat(64),
      consentVersion: '2',
      notMasked: [],
      aiRoute: 'anthropic:claude-haiku-5-5',
      aiProviders: [{ provider: 'anthropic', label: 'Anthropic', models: ['claude-haiku-5-5'] }],
    });

    svc.consent();
    const post = find(`/drafts/${ID}/consent`, 'POST');
    expect(post.request.body).toEqual({
      consentVersion: '2',
      maskedTextSha256: 'a'.repeat(64),
      aiRoute: 'anthropic:claude-haiku-5-5',
    });
    post.flush({ code: 'CONSENT_PROVIDER_CHANGED' }, { status: 409, statusText: 'Conflict' });

    expect(svc.error()).toContain('O serviço de IA que vai ler o contrato mudou');
    // Reabre a tela com a rota nova: o aceite antigo não é reaproveitado.
    find(`/drafts/${ID}/masked-text`, 'GET');
    expect(svc.masked()).toBeNull();
  });

  it('503 AI_BUSY mostra o Retry-After em segundos', () => {
    svc.submit(new File(['x'], 'a.docx'));
    find('/drafts', 'POST').flush(
      { message: 'fila', code: 'AI_BUSY' },
      { status: 503, statusText: 'Unavailable', headers: { 'Retry-After': '7' } },
    );
    expect(svc.error()).toContain('Tente novamente em 7 segundos');
  });

  it('a troca de empresa zera o estado', () => {
    svc.draftId.set(ID);
    TestBed.inject(ContractAiCapability).state.set('on');
    TestBed.inject(TenantResetRegistry).run();

    expect(svc.draftId()).toBeNull();
    expect(svc.enabled()).toBeNull();
    expect(sessionStorage.getItem('contractAiDraftId')).toBeNull();
  });
});
