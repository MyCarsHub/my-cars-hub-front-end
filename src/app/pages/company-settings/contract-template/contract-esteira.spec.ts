import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../../environments/environment';
import { ContractEsteira } from './contract-esteira';
import { ContractBase } from './base/contract-base.types';
import { ContractTemplateDto } from './contract-template-service';

const mocks = vi.hoisted(() => ({ renderAsync: vi.fn() }));
vi.mock('docx-preview', () => ({ renderAsync: mocks.renderAsync }));

const ROOT = `${environment.apiUrl}/settings/contract-template`;
const DRAFT = '11111111-2222-3333-4444-555555555555';

const BASE: ContractBase = {
  version: 'base-v7',
  draft: true,
  clauses: [
    { id: 'partes', title: 'Partes', description: '', fixed: true, defaultOn: true,
      text: '# CONTRATO DE LOCAÇÃO Nº {{rentalId}}\n\nLOCATÁRIO: {{driverName}}.' },
    { id: 'prazo', title: 'Prazo', description: '', fixed: true, defaultOn: true,
      text: '## DO PRAZO\nComeça em {{startDate}}.' },
    { id: 'caucao', title: 'Caução', description: 'Valor deixado no início.', fixed: false, defaultOn: true,
      text: '## DA CAUÇÃO\nCaução de {{caucaoAmount}}.' },
    { id: 'km', title: 'Limite de quilometragem', description: 'Franquia.', fixed: false, defaultOn: false,
      text: '## DA QUILOMETRAGEM\nFranquia de {{franchiseKm}} km.' },
  ],
};

const SAVED: ContractTemplateDto = {
  id: 't9',
  filename: 'contrato-mycarshub.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sizeBytes: 2048,
  uploadedAt: '2026-10-21T10:00:00Z',
  uploadedBy: 'u1',
  detectedPlaceholders: [],
  supportedVariables: [],
};

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ContractEsteira', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ContractEsteira>;
  let host: HTMLElement;

  beforeEach(() => {
    sessionStorage.clear();
    mocks.renderAsync.mockReset();
    TestBed.configureTestingModule({
      imports: [ContractEsteira],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture?.destroy();
  });

  function mount(opts: { ai?: boolean; base?: 'on' | 'off' } = {}): void {
    fixture = TestBed.createComponent(ContractEsteira);
    host = fixture.nativeElement;
    fixture.detectChanges();
    http.expectOne(`${ROOT}/ai-capability`).flush({ enabled: opts.ai ?? true });
    const base = http.expectOne(`${ROOT}/base`);
    if ((opts.base ?? 'on') === 'on') base.flush(BASE);
    else base.flush({ code: 'CONTRACT_BASE_DISABLED' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
  }

  const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'));
  const button = (label: string) => buttons().find((b) => b.textContent?.trim().startsWith(label));
  const paperText = () => host.querySelector('article')?.textContent?.replace(/\s+/g, ' ') ?? '';
  function click(label: string): void {
    const b = button(label);
    expect(b, `botão «${label}»`).toBeTruthy();
    b!.click();
    fixture.detectChanges();
  }

  it('flag desligada: «Montar do zero» aparece com «Em breve» e não abre', () => {
    mount({ base: 'off' });
    const zero = button('Montar do zero')!;
    expect(zero.disabled).toBe(true);
    expect(zero.textContent).toContain('Em breve');
    zero.click();
    fixture.detectChanges();
    expect(host.textContent).not.toContain('Sempre no contrato');
  });

  it('IA desligada: «Ajustar o meu contrato» aparece com «Em breve»', () => {
    mount({ ai: false });
    const mine = button('Ajustar o meu contrato')!;
    expect(mine.disabled).toBe(true);
    expect(mine.textContent).toContain('Em breve');
    expect(mine.textContent).not.toContain('Com IA');
  });

  it('montar do zero: contrato ao vivo renumera, selo de rascunho, e o POST leva versão + opcionais', () => {
    mount();
    const saved: ContractTemplateDto[] = [];
    fixture.componentInstance.saved.subscribe((t) => saved.push(t));

    click('Montar do zero');
    expect(host.textContent).toContain('Rascunho, aguardando revisão jurídica');
    expect(paperText()).toContain('CLÁUSULA 2ª — DA CAUÇÃO.');
    expect(paperText()).not.toContain('QUILOMETRAGEM');
    expect(paperText()).toContain('R$ 2.000,00'); // modo «Com exemplo»

    // Liga km, desliga caução: km vira a 2ª.
    const boxes = Array.from(host.querySelectorAll<HTMLInputElement>('input[type=checkbox]'));
    boxes[1].click(); // km
    boxes[0].click(); // caução
    fixture.detectChanges();
    expect(paperText()).toContain('CLÁUSULA 2ª — DA QUILOMETRAGEM.');
    expect(paperText()).not.toContain('CAUÇÃO');

    click('Com o nome dos campos');
    // O cliente vê o nome do campo em português, nunca a chave em inglês.
    expect(paperText()).toContain('Km de franquia');
    expect(paperText()).not.toContain('{{');
    expect(paperText()).not.toContain('franchiseKm');

    click('Conferir contrato');
    expect(host.textContent).toContain('Confira e salve');
    click('Salvar contrato');

    const req = http.expectOne(`${ROOT}/base/save`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ version: 'base-v7', optionalClauseIds: ['km'] });
    req.flush(SAVED);
    fixture.detectChanges();
    expect(saved).toEqual([SAVED]);
    expect(button('Ajustar o meu contrato')).toBeTruthy(); // voltou ao início
    http.verify();
  });

  it('montar do zero: falha no save mostra erro e fica na etapa', () => {
    mount();
    click('Montar do zero');
    click('Conferir contrato');
    click('Salvar contrato');
    http.expectOne(`${ROOT}/base/save`).flush({ code: 'X' }, { status: 500, statusText: 'err' });
    fixture.detectChanges();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Não foi possível salvar');
    expect(host.textContent).toContain('Confira e salve');
  });

  it('montar do zero: modelo que chega DEPOIS do clique ainda marca as cláusulas padrão', () => {
    fixture = TestBed.createComponent(ContractEsteira);
    host = fixture.nativeElement;
    fixture.detectChanges();
    http.expectOne(`${ROOT}/ai-capability`).flush({ enabled: true });
    http.expectOne(`${ROOT}/base`).flush({ code: 'X' }, { status: 500, statusText: 'err' });
    fixture.detectChanges();

    click('Montar do zero'); // habilitado no estado de erro
    click('Tentar novamente');
    http.expectOne(`${ROOT}/base`).flush(BASE);
    fixture.detectChanges();

    const boxes = Array.from(host.querySelectorAll<HTMLInputElement>('input[type=checkbox]'));
    expect(boxes.map((b) => b.checked)).toEqual([true, false]); // caução (padrão), km
    expect(paperText()).toContain('DA CAUÇÃO');
  });

  it('montar do zero: 409 de versão relê o modelo, mantém as escolhas e salva com a versão nova', () => {
    mount();
    click('Montar do zero');
    click('Conferir contrato');
    click('Salvar contrato');
    http
      .expectOne(`${ROOT}/base/save`)
      .flush({ code: 'CONTRACT_BASE_VERSION_CHANGED' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('O modelo de contrato foi atualizado');

    http.expectOne(`${ROOT}/base`).flush({ ...BASE, version: 'base-v8' });
    fixture.detectChanges();
    click('Salvar contrato');
    const again = http.expectOne(`${ROOT}/base/save`);
    expect(again.request.body).toEqual({ version: 'base-v8', optionalClauseIds: ['caucao'] });
  });

  it('montar do zero: 403 sem permissão explica quem pode salvar e não relê o modelo', () => {
    mount();
    click('Montar do zero');
    click('Conferir contrato');
    click('Salvar contrato');
    http
      .expectOne(`${ROOT}/base/save`)
      .flush({ code: 'CONTRACT_BASE_FORBIDDEN' }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(host.querySelector('[role=alert]')?.textContent).toContain(
      'Só o dono ou o gerente da empresa pode salvar o contrato.',
    );
    http.expectNone(`${ROOT}/base`);
  });

  it('fazer no Word: com contrato em uso, pede confirmação antes de substituir', async () => {
    fixture = TestBed.createComponent(ContractEsteira);
    fixture.componentRef.setInput('template', { ...SAVED, filename: 'atual.docx' });
    host = fixture.nativeElement;
    fixture.detectChanges();
    http.expectOne(`${ROOT}/ai-capability`).flush({ enabled: true });
    http.expectOne(`${ROOT}/base`).flush(BASE);
    fixture.detectChanges();

    click('Já sei colocar os campos no Word');
    http.expectOne(`${ROOT}/example`).flush('# CONTRATO');
    fixture.detectChanges();

    const input = host.querySelector<HTMLInputElement>('app-contract-word-step input[type=file]')!;
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])], 'novo.docx', { type: DOCX_MIME });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.querySelector('[role=dialog]')?.textContent).toContain(
        '«novo.docx» vai substituir «atual.docx» nos próximos aluguéis.',
      );
    });
    http.expectNone(ROOT); // nada sobe antes do «Substituir»

    const confirm = Array.from(host.querySelectorAll<HTMLButtonElement>('[role=dialog] button')).find(
      (b) => b.textContent?.trim() === 'Substituir',
    )!;
    confirm.click();
    fixture.detectChanges();
    const up = http.expectOne((r) => r.method === 'POST' && r.url === ROOT);
    expect((up.request.body as FormData).get('file')).toBe(file);
    expect(button('Cancelar')!.disabled).toBe(true); // envio em voo
    up.flush(SAVED);
  });

  it('fazer no Word: arquivo sem assinatura de Word é recusado sem enviar nada', async () => {
    mount();
    click('Já sei colocar os campos no Word');
    http.expectOne(`${ROOT}/example`).flush('# CONTRATO');
    fixture.detectChanges();
    const input = host.querySelector<HTMLInputElement>('app-contract-word-step input[type=file]')!;
    const fake = new File(['nao e zip'], 'contrato.docx', { type: DOCX_MIME });
    Object.defineProperty(input, 'files', { value: [fake], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.textContent).toContain('Este arquivo não parece ser um documento do Word.');
    });
    http.expectNone((r) => r.method === 'POST');
  });

  it('ajustar o meu: texto mascarado que falha oferece «Tentar de novo» e pede de novo', async () => {
    mount();
    click('Ajustar o meu contrato');
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])], 'meu.docx', { type: DOCX_MIME });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button('Continuar')!.disabled).toBe(false);
    });
    click('Continuar');
    http.expectOne(`${ROOT}/drafts`).flush({ draftId: DRAFT, status: 'AWAITING_CONSENT' });
    fixture.detectChanges();
    http
      .expectOne(`${ROOT}/drafts/${DRAFT}/masked-text`)
      .flush({ code: 'X' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    click('Tentar de novo');
    http.expectOne(`${ROOT}/drafts/${DRAFT}/masked-text`).flush({
      draftId: DRAFT,
      paragraphs: [{ id: 'p1', text: 'CPF [CPF_1].' }],
      maskedTextSha256: 'abc',
      consentVersion: 'v3',
      notMasked: [],
      aiRoute: 'anthropic:claude-haiku-5-5>claude-opus-5-5',
      aiProviders: [
        { provider: 'anthropic', label: 'Anthropic', models: ['claude-haiku-5-5', 'claude-opus-5-5'] },
      ],
    });
    fixture.detectChanges();
    expect(button('Tentar de novo')).toBeUndefined();
    expect(paperText()).toContain('CPF escondido');
  });

  it('ajustar o meu: provedor de IA mudou depois do aceite → pede o texto, a rota e o aceite de novo', async () => {
    mocks.renderAsync.mockImplementation(async (_b: Blob, el: HTMLElement) => {
      el.innerHTML = '<p>CONTRATO</p>';
    });
    mount();
    click('Ajustar o meu contrato');
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])], 'meu.docx', { type: DOCX_MIME });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button('Continuar')!.disabled).toBe(false);
    });
    click('Continuar');
    http.expectOne(`${ROOT}/drafts`).flush({ draftId: DRAFT, status: 'AWAITING_CONSENT' });
    fixture.detectChanges();
    const view = (route: string, label: string, models: string[]) => ({
      draftId: DRAFT,
      paragraphs: [{ id: 'p1', text: 'CPF [CPF_1].' }],
      maskedTextSha256: 'abc',
      consentVersion: 'v3',
      notMasked: [],
      aiRoute: route,
      aiProviders: [{ provider: label.toLowerCase(), label, models }],
    });
    http
      .expectOne(`${ROOT}/drafts/${DRAFT}/masked-text`)
      .flush(view('anthropic:claude-haiku-5-5', 'Anthropic', ['claude-haiku-5-5']));
    fixture.detectChanges();
    host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    fixture.detectChanges();
    click('Autorizar e analisar');
    http.expectOne(`${ROOT}/drafts/${DRAFT}/consent`).flush({ draftId: DRAFT, status: 'ANALYZING' });
    fixture.detectChanges();

    // A análise não rodou: o servidor devolve o rascunho ao consentimento com o motivo.
    http.expectOne(`${ROOT}/drafts/${DRAFT}`).flush({
      draftId: DRAFT,
      status: 'AWAITING_CONSENT',
      failureCode: 'CONSENT_PROVIDER_CHANGED',
      filename: 'meu.docx',
      layoutSimplified: false,
      certain: [],
      doubts: [],
    });
    fixture.detectChanges();
    http
      .expectOne(`${ROOT}/drafts/${DRAFT}/masked-text`)
      .flush(view('anthropic:claude-haiku-5-5>claude-opus-5-5', 'Anthropic', ['claude-haiku-5-5', 'claude-opus-5-5']));
    fixture.detectChanges();

    expect(host.textContent).toContain('O serviço de IA que vai ler o contrato mudou depois da sua autorização');
    expect(host.querySelector('[data-ai-route]')?.textContent).toContain('claude-opus-5-5');
    // O aceite antigo não vale: a caixa volta desmarcada.
    expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
    expect(button('Autorizar e analisar')!.disabled).toBe(true);
    host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    fixture.detectChanges();
    click('Autorizar e analisar');
    expect(http.expectOne(`${ROOT}/drafts/${DRAFT}/consent`).request.body).toEqual({
      consentVersion: 'v3',
      maskedTextSha256: 'abc',
      aiRoute: 'anthropic:claude-haiku-5-5>claude-opus-5-5',
    });
  });

  it('ajustar o meu: .docx do Android (octet-stream) com assinatura de Word é aceito', async () => {
    mount();
    click('Ajustar o meu contrato');
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])], 'meu.docx', {
      type: 'application/octet-stream',
    });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button('Continuar')!.disabled).toBe(false);
    });
    expect(host.textContent).not.toContain('Este arquivo não é do Word');
  });

  it('ajustar o meu: recusa arquivo que não é Word, sem enviar nada', async () => {
    mount();
    click('Ajustar o meu contrato');
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    const dt = { files: [new File(['%PDF'], 'contrato.pdf', { type: 'application/pdf' })] };
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await flush();
    fixture.detectChanges();
    expect(host.textContent).toContain('Este arquivo não é do Word');
    expect(button('Continuar')!.disabled).toBe(true);
    http.expectNone(`${ROOT}/drafts`);
  });

  /** Da escolha do arquivo até a resposta da análise, com o texto mascarado dado. */
  async function analysed(paragraphs: { id: string; text: string }[], status: object): Promise<void> {
    mocks.renderAsync.mockImplementation(async (_b: Blob, el: HTMLElement) => {
      el.innerHTML = '<p>CONTRATO</p>';
    });
    mount();
    click('Ajustar o meu contrato');
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])], 'meu.docx', { type: DOCX_MIME });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button('Continuar')!.disabled).toBe(false);
    });
    click('Continuar');
    http.expectOne(`${ROOT}/drafts`).flush({ draftId: DRAFT, status: 'AWAITING_CONSENT' });
    fixture.detectChanges();
    http.expectOne(`${ROOT}/drafts/${DRAFT}/masked-text`).flush({
      draftId: DRAFT,
      paragraphs,
      maskedTextSha256: 'abc',
      consentVersion: 'v3',
      notMasked: [],
      aiRoute: 'r',
      aiProviders: [],
    });
    fixture.detectChanges();
    host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    fixture.detectChanges();
    click('Autorizar e analisar');
    http.expectOne(`${ROOT}/drafts/${DRAFT}/consent`).flush({ draftId: DRAFT, status: 'ANALYZING' });
    fixture.detectChanges();
    http.expectOne(`${ROOT}/drafts/${DRAFT}`).flush({
      draftId: DRAFT,
      failureCode: null,
      filename: 'meu.docx',
      layoutSimplified: false,
      certain: [],
      doubts: [],
      ...status,
    });
    fixture.detectChanges();
  }

  const EXISTING = [
    { field: 'rentalId', label: 'Número do contrato' },
    { field: 'driverName', label: 'Nome do motorista' },
    { field: 'contractDate', label: 'Data do contrato' },
  ];

  it('contrato com campos e nada novo: vai direto a «Conferir», conta os campos e salva sem decisões', async () => {
    await analysed(
      [
        { id: 'p1', text: 'Contrato nº {{rentalId}}' },
        { id: 'p2', text: 'LOCATÁRIO: {{driverName}}, em {{contractDate}}.' },
      ],
      { status: 'READY', existingFields: EXISTING },
    );

    expect(host.textContent).toContain('Confira e salve');
    expect(host.querySelector('dl dd')?.textContent?.trim()).toBe('3');
    expect(host.textContent).toContain('3 dados já estão no contrato');
    expect(paperText()).not.toContain('{{');
    expect(host.querySelectorAll('article [class*="emerald"]').length).toBe(3);

    click('Salvar contrato');
    http.expectNone(`${ROOT}/drafts/${DRAFT}/decisions`);
    http.expectOne(`${ROOT}/drafts/${DRAFT}/save`).flush(SAVED);
  });

  it('a etapa dos campos mostra o que já está no contrato, e o total soma os dois', async () => {
    await analysed(
      [
        { id: 'p1', text: 'Contrato nº {{rentalId}}' },
        { id: 'p2', text: 'Campinas, {{contractDate}}' },
      ],
      {
        status: 'NEEDS_REVIEW',
        existingFields: EXISTING.filter((f) => f.field !== 'driverName'),
        doubts: [
          { id: 's0001', paragraphId: 'p2', field: 'companyCity', fieldLabel: 'Cidade da empresa', excerpt: 'Campinas',
            context: 'Campinas, {{contractDate}}', confidence: 0.6, reason: '', alternatives: [] },
        ],
      },
    );

    expect(host.querySelector('blockquote')?.textContent).toContain('Campinas');
    expect(host.querySelector('blockquote')?.textContent).toContain('Data do contrato');
    expect(host.querySelector('blockquote')?.textContent).not.toContain('{{');
    expect(host.textContent).toContain('Seu contrato já tinha 2 dados.');
    expect(host.textContent).toContain('Só falta 1 pergunta rápida.');
    expect(host.textContent).toContain('2 dados já estão no contrato');
    expect(paperText()).not.toContain('{{');

    click('Ver como ficou');
    http.expectOne(`${ROOT}/drafts/${DRAFT}/decisions`)
      .flush({ draftId: DRAFT, status: 'READY', acceptedCount: 1, pendingDoubtIds: [] });
    fixture.detectChanges();

    expect(host.querySelector('dl dd')?.textContent?.trim()).toBe('3');
  });

  const QUESTION = {
    id: 'q0001',
    kind: 'CPF',
    excerpt: '[CPF_1]',
    context: 'CONTRATANTE: Fulano, CPF [CPF_1].',
    places: [{ paragraphId: 'p1', excerpt: '[CPF_1]' }],
    options: [{ field: 'driverCpf', label: 'CPF do motorista' }],
    nearby: [],
  };
  const TEXT = [{ id: 'p1', text: 'CONTRATANTE: Fulano, CPF [CPF_1].' }];
  const answerRadios = () =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('[role=radio]')).filter((r) =>
      r.closest('[aria-label="Escolha uma resposta"]'),
    );
  const KEEP = 'Locador, fiador, testemunha ou outra pessoa: manter como está';

  it('pergunta: nenhuma resposta marcada, sem «Mais provável», e terceiros são resposta válida', async () => {
    await analysed(TEXT, { status: 'NEEDS_REVIEW', questions: [QUESTION] });

    expect(host.textContent).toContain('De quem é este CPF?');
    expect(host.textContent).toContain('Sem resposta, ele fica como está');
    expect(host.textContent).not.toContain('Mais provável');
    expect(answerRadios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect(answerRadios().map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['CPF do motorista', KEEP]);
  });

  it('pergunta numa célula de tabela: mostra a coluna e a linha, com o valor mascarado', async () => {
    await analysed([{ id: 'p1', text: 'CPF: [CPF_1]' }], {
      status: 'NEEDS_REVIEW',
      questions: [
        {
          ...QUESTION,
          context: 'CPF: [CPF_1]',
          nearby: [
            { where: 'COLUMN', text: 'LOCADOR: {{driverName}}' },
            { where: 'ROW', text: 'CPF [CPF_2]' },
          ],
        },
      ],
    });

    const near = host.querySelector('[data-question-nearby]')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(near).toContain('Na mesma coluna');
    expect(near).toContain('LOCADOR: Nome do motorista');
    expect(near).toContain('Na mesma linha');
    expect(near).toContain('CPF CPF escondido');
    expect(near).not.toContain('[CPF_2]');
    expect(near).not.toContain('{{');
  });

  it('pergunta de um valor repetido diz que a resposta vale para todos os lugares', async () => {
    await analysed(TEXT, {
      status: 'NEEDS_REVIEW',
      questions: [{ ...QUESTION, places: [...QUESTION.places, { paragraphId: 'p1', excerpt: '[CPF_1]' }] }],
    });

    expect(host.textContent).toContain('Aparece 2 vezes');
  });

  it('dado que não pode virar campo: a pergunta informa e não oferece campo', async () => {
    await analysed(TEXT, { status: 'NEEDS_REVIEW', questions: [{ ...QUESTION, options: [] }] });

    expect(host.textContent).toContain('não pode virar campo');
    expect(answerRadios().map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([KEEP]);
  });

  it('seguir sem responder não aceita nada, e o «Conferir» lista o que ficou fixo', async () => {
    await analysed(TEXT, { status: 'NEEDS_REVIEW', questions: [QUESTION] });

    click('Ver como ficou');
    const put = http.expectOne(`${ROOT}/drafts/${DRAFT}/decisions`);
    expect(put.request.body).toEqual({ decisions: [] });
    put.flush({ draftId: DRAFT, status: 'READY', acceptedCount: 0, pendingDoubtIds: [] });
    fixture.detectChanges();

    expect(host.querySelector('dl dd')?.textContent?.trim()).toBe('0');
    expect(host.querySelectorAll('article [class*="emerald"]').length).toBe(0);
    const left = host.querySelector('[data-unanswered]')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(left).toContain('1 pergunta sem resposta');
    expect(left).toContain('CPF escondido');
    expect(left).toContain('CONTRATANTE: Fulano');
    expect(left).not.toContain('[CPF_1]');
  });

  it('o «Conferir» distingue duas células iguais pela coluna de cada uma', async () => {
    const cell = (id: string, marker: string, column: string) => ({
      ...QUESTION,
      id,
      excerpt: marker,
      context: `CPF: ${marker}`,
      places: [{ paragraphId: 'p1', excerpt: marker }],
      nearby: [{ where: 'COLUMN', text: column }],
    });
    await analysed([{ id: 'p1', text: 'CPF: [CPF_1] CPF: [CPF_2]' }], {
      status: 'NEEDS_REVIEW',
      questions: [cell('q0001', '[CPF_1]', 'LOCADOR: Fulano'), cell('q0002', '[CPF_2]', 'LOCATÁRIO: Beltrano')],
    });

    click('Próxima pergunta');
    click('Ver como ficou');
    http.expectOne(`${ROOT}/drafts/${DRAFT}/decisions`)
      .flush({ draftId: DRAFT, status: 'READY', acceptedCount: 0, pendingDoubtIds: [] });
    fixture.detectChanges();

    const rows = Array.from(host.querySelectorAll('[data-unanswered] li')).map((li) => li.textContent);
    expect(rows[0]).toContain('LOCADOR: Fulano');
    expect(rows[1]).toContain('LOCATÁRIO: Beltrano');
  });

  it('o «Conferir» avisa quando o contrato não tem nome nem CPF do motorista como campo', async () => {
    await analysed(TEXT, { status: 'NEEDS_REVIEW', questions: [QUESTION] });

    click('Ver como ficou');
    http.expectOne(`${ROOT}/drafts/${DRAFT}/decisions`)
      .flush({ draftId: DRAFT, status: 'READY', acceptedCount: 0, pendingDoubtIds: [] });
    fixture.detectChanges();

    expect(host.textContent).toContain('sem o nome e o CPF do motorista');
  });

  it('salvar com perguntas diz ao backend que elas foram vistas', async () => {
    await analysed(TEXT, { status: 'NEEDS_REVIEW', questions: [QUESTION] });
    click('Ver como ficou');
    http.expectOne(`${ROOT}/drafts/${DRAFT}/decisions`)
      .flush({ draftId: DRAFT, status: 'READY', acceptedCount: 0, pendingDoubtIds: [] });
    fixture.detectChanges();

    click('Salvar contrato');
    const post = http.expectOne(`${ROOT}/drafts/${DRAFT}/save`);

    expect(post.request.body).toEqual({ questionsReviewed: true });
    post.flush(SAVED);
  });

  it('sem perguntas, o salvar manda o corpo de sempre: esta tela vai ao ar antes do backend novo', async () => {
    await analysed([{ id: 'p1', text: '{{rentalId}}' }], { status: 'READY', existingFields: [EXISTING[0]] });

    click('Salvar contrato');
    const post = http.expectOne(`${ROOT}/drafts/${DRAFT}/save`);

    expect(post.request.body).toEqual({});
    post.flush(SAVED);
  });

  it('respondida como do motorista: vai com a confirmação e vira campo', async () => {
    await analysed(TEXT, { status: 'NEEDS_REVIEW', questions: [QUESTION] });

    answerRadios()[0].click();
    fixture.detectChanges();
    expect(answerRadios()[0].getAttribute('aria-checked')).toBe('true');
    click('Ver como ficou');
    const put = http.expectOne(`${ROOT}/drafts/${DRAFT}/decisions`);
    expect(put.request.body).toEqual({
      decisions: [{ id: 'q0001', field: 'driverCpf', accept: true, confirmed: true }],
    });
    put.flush({ draftId: DRAFT, status: 'READY', acceptedCount: 1, pendingDoubtIds: [] });
    fixture.detectChanges();

    expect(host.querySelector('dl dd')?.textContent?.trim()).toBe('1');
    expect(host.querySelector('[data-unanswered]')).toBeNull();
  });

  it('respondida como de outra pessoa: fica fixo e não conta como sem resposta', async () => {
    await analysed(TEXT, { status: 'NEEDS_REVIEW', questions: [QUESTION] });

    answerRadios()[1].click();
    fixture.detectChanges();
    click('Ver como ficou');
    const put = http.expectOne(`${ROOT}/drafts/${DRAFT}/decisions`);
    expect(put.request.body).toEqual({ decisions: [{ id: 'q0001', field: null, accept: false }] });
    put.flush({ draftId: DRAFT, status: 'READY', acceptedCount: 0, pendingDoubtIds: [] });
    fixture.detectChanges();

    expect(host.querySelector('[data-unanswered]')).toBeNull();
  });

  it('token desconhecido: o salvar recusa com a instrução, e o contrato fica na tela', async () => {
    await analysed([{ id: 'p1', text: 'Olá {{campoEstranho}} e {{rentalId}}' }], {
      status: 'READY',
      existingFields: [EXISTING[0]],
    });

    click('Salvar contrato');
    http.expectOne(`${ROOT}/drafts/${DRAFT}/save`).flush(
      { code: 'TEMPLATE_UNKNOWN_PLACEHOLDER' },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();

    expect(host.textContent).toContain('não reconhece');
    expect(host.textContent).toContain('Confira e salve');
  });

  it('ajustar o meu: envio → texto mascarado → autorização → uma pergunta por vez → decisões', async () => {
    mocks.renderAsync.mockImplementation(async (_b: Blob, el: HTMLElement) => {
      el.innerHTML = '<p>CONTRATO DE LOCAÇÃO</p><p>LOCATÁRIO: Carlos <script>x()</script></p>';
    });
    mount();
    click('Ajustar o meu contrato');

    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])], 'meu.docx', { type: DOCX_MIME });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    // Contrato como foi enviado: só texto, nada do HTML do arquivo.
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(paperText()).toContain('LOCATÁRIO: Carlos');
    });
    expect(host.querySelector('article script')).toBeNull();

    click('Continuar');
    const up = http.expectOne(`${ROOT}/drafts`);
    expect(up.request.method).toBe('POST');
    // Envio em voo: cancelar agora deixaria o 202 reabrir o caminho depois.
    fixture.detectChanges();
    expect(button('Cancelar')!.disabled).toBe(true);
    expect((up.request.body as FormData).get('file')).toBe(file);
    up.flush({ draftId: DRAFT, status: 'AWAITING_CONSENT' });
    fixture.detectChanges();

    const masked = http.expectOne(`${ROOT}/drafts/${DRAFT}/masked-text`);
    masked.flush({
      draftId: DRAFT,
      paragraphs: [
        { id: 'p1', text: 'LOCATÁRIO: [NOME_1], CPF [CPF_1].' },
        { id: 'p2', text: 'CLÁUSULA 2ª. Pagará R$ 650,00 por semana.' },
      ],
      maskedTextSha256: 'abc',
      consentVersion: 'v3',
      notMasked: [],
      aiRoute: 'anthropic:claude-haiku-5-5>claude-opus-5-5',
      aiProviders: [
        { provider: 'anthropic', label: 'Anthropic', models: ['claude-haiku-5-5', 'claude-opus-5-5'] },
      ],
    });
    fixture.detectChanges();
    expect(paperText()).toContain('CPF escondido');
    expect(paperText()).not.toContain('[CPF_1]');

    expect(button('Autorizar e analisar')!.disabled).toBe(true);
    host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    fixture.detectChanges();
    click('Autorizar e analisar');
    const consent = http.expectOne(`${ROOT}/drafts/${DRAFT}/consent`);
    expect(host.querySelector('[data-ai-route]')?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Anthropic · modelos claude-haiku-5-5 e claude-opus-5-5',
    );
    expect(consent.request.body).toEqual({
      consentVersion: 'v3',
      maskedTextSha256: 'abc',
      aiRoute: 'anthropic:claude-haiku-5-5>claude-opus-5-5',
    });
    consent.flush({ draftId: DRAFT, status: 'ANALYZING' });
    fixture.detectChanges();
    expect(host.textContent).toContain('Lendo o seu contrato');
    // Lendo (ANALYZING): o servidor recusa o DELETE com 409; «Cancelar» espera e nem o
    // método da tela, chamado direto, descarta o rascunho.
    expect(button('Cancelar')!.disabled).toBe(true);
    (fixture.componentInstance as unknown as { askExit(): void }).askExit();
    fixture.detectChanges();
    http.expectNone((r) => r.method === 'DELETE');
    expect(host.textContent).not.toContain('Cancelar a montagem?');
    expect(host.textContent).toContain('Lendo o seu contrato');

    http.expectOne(`${ROOT}/drafts/${DRAFT}`).flush({
      draftId: DRAFT,
      status: 'NEEDS_REVIEW',
      failureCode: null,
      filename: 'meu.docx',
      layoutSimplified: false,
      certain: [
        { id: 's0001', paragraphId: 'p1', field: 'driverCpf', fieldLabel: 'CPF do motorista', excerpt: '[CPF_1]',
          context: 'CPF [CPF_1].', confidence: 0.99, reason: '', alternatives: null },
      ],
      doubts: [
        { id: 's0002', paragraphId: 'p2', field: 'periodRate', fieldLabel: 'Valor por período', excerpt: 'R$ 650,00',
          context: 'Pagará R$ 650,00 por semana.', confidence: 0.6, reason: '',
          alternatives: [{ field: 'totalAmount', label: 'Valor total' }, { field: 'caucaoAmount', label: 'Caução' }] },
      ],
    });
    fixture.detectChanges();

    expect(host.textContent).toContain('A IA marcou 1 dado sozinha. Só falta 1 pergunta rápida.');
    expect(host.textContent).toContain('O que é «R$ 650,00» no seu contrato?');
    const radios = Array.from(host.querySelectorAll<HTMLButtonElement>('[role=radio]')).filter((r) =>
      r.closest('[aria-label="Escolha uma resposta"]'),
    );
    expect(radios.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'O valor de cada pagamento Mais provável',
      'O valor total do aluguel',
      'O valor da caução',
      'Nenhum desses. Deixar sempre igual',
    ]);
    expect(host.querySelector('select')).toBeNull(); // dúvidas sem selects

    radios[1].click();
    fixture.detectChanges();
    click('Ver como ficou');
    const put = http.expectOne(`${ROOT}/drafts/${DRAFT}/decisions`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({
      decisions: [{ id: 's0002', field: 'totalAmount', accept: true }],
    });
    put.flush({ draftId: DRAFT, status: 'READY', acceptedCount: 2, pendingDoubtIds: [] });
    fixture.detectChanges();

    expect(host.textContent).toContain('Confira e salve');
    click('Com o nome dos campos');
    expect(paperText()).toContain('Valor total');
    expect(paperText()).toContain('CPF do motorista');
    expect(paperText()).not.toContain('{{');
    expect(paperText()).not.toMatch(/totalAmount|driverCpf/);
  });
});
