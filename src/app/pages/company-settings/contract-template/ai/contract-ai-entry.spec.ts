import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractAiEntry } from './contract-ai-entry';
import { ContractAiService } from './contract-ai.service';
import { TenantResetRegistry } from '../../../../services/tenant-reset.registry';
import { DraftStatusResponse, MaskedTextResponse, SuggestionView } from './contract-ai.types';

const ID = '11111111-2222-3333-4444-555555555555';

function suggestion(over: Partial<SuggestionView> = {}): SuggestionView {
  return {
    id: 's1',
    paragraphId: 'p1',
    field: 'driverName',
    fieldLabel: 'Nome do motorista',
    excerpt: 'João da Silva',
    context: 'Contrato firmado com João da Silva, CPF [CPF_1].',
    confidence: 0.4,
    reason: 'Pode ser o nome da testemunha.',
    alternatives: [{ field: 'companyRepresentative', label: 'Representante da locadora' }],
    ...over,
  };
}

function draft(over: Partial<DraftStatusResponse> = {}): DraftStatusResponse {
  return {
    draftId: ID,
    status: 'NEEDS_REVIEW',
    failureCode: null,
    filename: 'contrato.docx',
    layoutSimplified: false,
    certain: [],
    doubts: [suggestion()],
    ...over,
  };
}

describe('ContractAiEntry', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ContractAiEntry>;
  let svc: ContractAiService;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends Element>(sel: string): T | null => el().querySelector<T>(sel);
  const buttons = (): HTMLButtonElement[] => Array.from(el().querySelectorAll('button'));
  const button = (text: string): HTMLButtonElement | undefined =>
    buttons().find((b) => b.textContent?.includes(text));

  async function start(enabled: boolean, stored?: DraftStatusResponse): Promise<void> {
    if (stored) sessionStorage.setItem('contractAiDraftId', ID);
    fixture = TestBed.createComponent(ContractAiEntry);
    svc = TestBed.inject(ContractAiService);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/ai-capability')).flush({ enabled });
    if (stored) {
      http.expectOne((r) => r.url.endsWith(`/drafts/${ID}`)).flush(stored);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const docx = (name: string, bytes: number[] = [0x50, 0x4b, 0x03, 0x04, 1], type = DOCX): File =>
    new File([new Uint8Array(bytes)], name, { type });

  async function pick(file: File): Promise<void> {
    const input = q<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    // A leitura dos 4 primeiros bytes (FileReader) termina fora do ciclo de CD.
    await new Promise((r) => setTimeout(r, 30));
    fixture.detectChanges();
  }

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    svc?.stopPolling();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('capacidade desligada: o DOM fica vazio (a página não muda)', async () => {
    await start(false);
    expect(el().textContent?.trim()).toBe('');
    expect(el().querySelector('button')).toBeNull();
  });

  it('capacidade ligada: tela 1 com CTA, saídas manuais e aviso jurídico; sem {{', async () => {
    await start(true);

    expect(button('Escolher arquivo')).toBeTruthy();
    expect(button('Ainda não tenho contrato')).toBeTruthy();
    expect(button('Prefiro montar sozinho')).toBeTruthy();
    expect(el().textContent).toContain('não valida as cláusulas');
    expect(el().textContent).not.toContain('{{');
    expect(q<HTMLInputElement>('input[type=file]')!.accept).toContain('.docx');
  });

  const masked = (over: Partial<MaskedTextResponse> = {}): MaskedTextResponse => ({
    draftId: ID,
    paragraphs: [
      { id: 'p1', text: 'Contrato com [CPF_1] e <img src=x onerror=alert(1)>' },
      { id: 'p2', text: 'Locatário Jo\u202Eão' },
    ],
    maskedTextSha256: 'abc123hash',
    consentVersion: 'v7',
    notMasked: [{ code: 'NAMES', label: 'Nomes de pessoas e empresas' }],
    ...over,
  });

  async function upload(): Promise<void> {
    await start(true);
    await pick(docx('contrato.docx'));
    button('Enviar arquivo')!.click();
    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/drafts'))
      .flush({ draftId: ID, status: 'AWAITING_CONSENT' }, { status: 202, statusText: 'ok' });
    fixture.detectChanges();
  }

  function flushMasked(m: MaskedTextResponse): void {
    http.expectOne((r) => r.url.endsWith(`/drafts/${ID}/masked-text`)).flush(m);
    fixture.detectChanges();
  }

  const consentBox = (): HTMLInputElement => q<HTMLInputElement>('input[type=checkbox]')!;

  async function check(): Promise<void> {
    // Sem IntersectionObserver (jsdom) o gate é o botão "Li o texto inteiro".
    button('Li o texto inteiro')?.click();
    fixture.detectChanges();
    const box = consentBox();
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('tela 1 não traz aviso de envio à IA; escolher arquivo não envia nada', async () => {
    await start(true);
    await pick(docx('contrato.docx'));

    expect(el().textContent).not.toContain('será enviado');
    expect(q('input[type=checkbox]')).toBeNull();
    http.expectNone((r) => r.method === 'POST');
  });

  it('upload → masked-text → consent → polling, com o texto mascarado real na tela', async () => {
    await upload();
    // Upload não dispara polling nem análise.
    http.expectNone((r) => r.url.endsWith(`/drafts/${ID}`) && r.method === 'GET');
    flushMasked(masked());

    expect(el().textContent).toContain('[CPF_1]');
    expect(el().textContent).toContain('Nomes de pessoas e empresas');
    expect(button('Enviar para análise')!.disabled).toBe(true);

    await check();
    button('Enviar para análise')!.click();
    button('Enviar para análise')?.click();
    const post = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/consent'));
    expect(post.request.body).toEqual({ consentVersion: 'v7', maskedTextSha256: 'abc123hash' });
    post.flush({ draftId: ID, status: 'ANALYZING' }, { status: 202, statusText: 'ok' });
    fixture.detectChanges();

    expect(el().textContent).toContain('Lendo o seu contrato');
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith(`/drafts/${ID}`)).flush(
      draft({ status: 'NEEDS_REVIEW' }),
    );
    fixture.detectChanges();
    expect(el().textContent).toContain('Dúvida 1 de 1');
  });

  /**
   * Consentimento v2: é a base da transferência internacional (LGPD art. 33, VIII), que
   * exige informação PRÉVIA. Sem provedor, país, salvaguarda e o que vai em claro, o aceite
   * não sustenta a seção 6 da política.
   */
  it('consentimento v2: nomeia Anthropic/EUA, a salvaguarda, o que vai em claro e linka a política', async () => {
    await upload();
    flushMasked(masked());
    const text = (el().textContent ?? '').replace(/\s+/g, ' ');

    expect(text).toContain('será enviado à Anthropic (serviço de IA Claude), nos Estados Unidos');
    expect(text).toContain('O texto sai do Brasil');
    expect(text).toContain('art. 33, VIII');
    expect(text).toContain('Vão escondidos: CPF, CNPJ');
    expect(text).toContain('Vão em claro: nomes de pessoas e de empresas, endereços');
    expect(text).toContain('autorizo o envio deste texto à Anthropic, nos Estados Unidos');
    expect(text).not.toContain('serviço de inteligência artificial de terceiros');

    const link = q<HTMLAnchorElement>('a[href="/politica-de-privacidade#analise-de-contrato-com-ia"]');
    expect(link).not.toBeNull();
    expect(link!.target).toBe('_blank');
    expect(link!.rel).toContain('noopener');
  });

  it('sem a caixa marcada o botão fica desabilitado e nada é enviado', async () => {
    await upload();
    flushMasked(masked());

    expect(consentBox().checked).toBe(false);
    const send = button('Enviar para análise')!;
    expect(send.disabled).toBe(true);
    send.click();
    http.expectNone((r) => r.url.endsWith('/consent'));
  });

  it('texto mascarado malicioso é exibido escapado e sem bidi (DOM do host)', async () => {
    await upload();
    flushMasked(masked());

    expect(q('img')).toBeNull();
    expect(el().querySelector('[onerror]')).toBeNull();
    expect(el().textContent).toContain('<img src=x onerror=alert(1)>');
    expect(el().textContent).not.toMatch(/[\u202A-\u202E]/);
    expect(el().textContent).toContain('Locatário Jo⟦U+202E⟧ão');
  });

  it('409 CONSENT_VERSION_MISMATCH reabre a tela com o texto novo', async () => {
    await upload();
    flushMasked(masked());
    await check();
    button('Enviar para análise')!.click();
    http
      .expectOne((r) => r.url.endsWith('/consent'))
      .flush(
        { message: 'v', code: 'CONSENT_VERSION_MISMATCH' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();
    expect(el().textContent).toContain('texto de autorização foi atualizado');

    flushMasked(masked({ consentVersion: 'v8', maskedTextSha256: 'newhash' }));
    expect(consentBox().checked).toBe(false); // consentimento antigo não vale
    await check();
    button('Enviar para análise')!.click();
    const again = http.expectOne((r) => r.url.endsWith('/consent'));
    expect(again.request.body).toEqual({ consentVersion: 'v8', maskedTextSha256: 'newhash' });
    again.flush({ draftId: ID, status: 'ANALYZING' }, { status: 202, statusText: 'ok' });
    http.match((r) => r.url.endsWith(`/drafts/${ID}`)).forEach((r) => r.flush(draft({ status: 'ANALYZING', doubts: [] })));
  });

  it('descartar pede confirmação antes do DELETE e não duplica com duplo clique', async () => {
    await upload();
    flushMasked(masked());
    button('Descartar arquivo')!.click();
    fixture.detectChanges();
    http.expectNone((r) => r.method === 'DELETE');

    const confirm = Array.from(el().querySelectorAll('app-confirm-dialog button')).find((b) =>
      b.textContent?.includes('Descartar'),
    ) as HTMLButtonElement;
    confirm.click();
    confirm.click();
    const dels = http.match((r) => r.method === 'DELETE' && r.url.endsWith(`/drafts/${ID}`));
    expect(dels.length).toBe(1);
    dels[0].flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();

    expect(button('Escolher arquivo')).toBeTruthy();
    expect(sessionStorage.getItem('contractAiDraftId')).toBeNull();
  });

  it('Cancelar chama DELETE e, se falhar, mantém a tela com o erro', async () => {
    await upload();
    flushMasked(masked());
    button('Cancelar')!.click();
    http
      .expectOne((r) => r.method === 'DELETE')
      .flush({ message: 'x' }, { status: 500, statusText: 'err' });
    fixture.detectChanges();

    expect(svc.draftId()).toBe(ID);
    expect(el().textContent).toContain('Não foi possível descartar');
    expect(button('Enviar para análise')).toBeTruthy();

    button('Cancelar')!.click();
    http.expectOne((r) => r.method === 'DELETE').flush(null, { status: 204, statusText: 'ok' });
    fixture.detectChanges();
    expect(button('Escolher arquivo')).toBeTruthy();
  });

  it('409 DRAFT_NOT_AWAITING_CONSENT no masked-text segue o status real, sem laço', async () => {
    await upload();
    http
      .expectOne((r) => r.url.endsWith('/masked-text'))
      .flush(
        { message: 'x', code: 'DRAFT_NOT_AWAITING_CONSENT' },
        { status: 409, statusText: 'Conflict' },
      );
    http
      .expectOne((r) => r.method === 'GET' && r.url.endsWith(`/drafts/${ID}`))
      .flush(draft({ status: 'ANALYZING', doubts: [] }));
    fixture.detectChanges();

    expect(el().textContent).toContain('Lendo o seu contrato');
    http.expectNone((r) => r.url.endsWith('/masked-text'));
    http.match((r) => r.url.endsWith(`/drafts/${ID}`)).forEach((r) => r.flush(draft({ status: 'ANALYZING', doubts: [] })));
  });

  it('quebra de linha é preservada e caracteres invisíveis viram marcadores com aviso', async () => {
    await upload();
    flushMasked(
      masked({ paragraphs: [{ id: 'p1', text: 'a\nb\u200Bc\u202Ed' }] }),
    );

    const p = q<HTMLElement>('[data-pi="0"]')!;
    expect(p.textContent).toContain('a\nb');
    expect(p.textContent).toContain('⟦U+200B⟧');
    expect(p.textContent).toContain('⟦U+202E⟧');
    expect(p.className).toContain('whitespace-pre-wrap');
    expect(el().textContent).toContain('2 caracteres invisíveis');
  });

  it('consentimento informado: com 150 parágrafos só habilita ao alcançar o fim', async () => {
    type Cb = (entries: { isIntersecting: boolean; target: Element }[]) => void;
    const observed: Element[] = [];
    let cb: Cb = () => undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(c: Cb) {
          cb = c;
        }
        observe(e: Element): void {
          observed.push(e);
        }
        disconnect(): void {
          observed.length = 0;
        }
      },
    );
    try {
      await upload();
      flushMasked(
        masked({
          paragraphs: Array.from({ length: 150 }, (_, i) => ({ id: 'p' + i, text: 'par ' + i })),
        }),
      );
      await fixture.whenStable();
      fixture.detectChanges();

      expect(el().querySelectorAll('[data-pi]').length).toBe(150); // nenhum omitido
      expect(button('Li o texto inteiro')).toBeUndefined();
      expect(consentBox().disabled).toBe(true);
      expect(el().textContent).toContain('0 de 150 parágrafos vistos');

      const paras = observed.filter((e) => (e as HTMLElement).dataset['pi'] !== undefined);
      cb(paras.slice(0, 60).map((target) => ({ isIntersecting: true, target })));
      fixture.detectChanges();
      expect(el().textContent).toContain('60 de 150 parágrafos vistos');
      expect(consentBox().disabled).toBe(true);
      expect(button('Enviar para análise')!.disabled).toBe(true);

      const end = observed.find((e) => (e as HTMLElement).dataset['end'])!;
      cb([{ isIntersecting: true, target: end }]);
      fixture.detectChanges();
      expect(consentBox().disabled).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('503 AI_DISABLED no upload mostra mensagem e não cria rascunho', async () => {
    await start(true);
    await pick(docx('contrato.docx'));
    button('Enviar arquivo')!.click();
    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/drafts'))
      .flush({ message: 'x', code: 'AI_DISABLED' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(el().textContent).toContain('indisponível');
    expect(svc.draftId()).toBeNull();
  });

  it('reload com rascunho AWAITING_CONSENT volta à tela de consentimento', async () => {
    await start(true, draft({ status: 'AWAITING_CONSENT', doubts: [] }));
    flushMasked(masked());
    expect(el().textContent).toContain('Enviar para análise');
    expect(el().textContent).toContain('[CPF_1]');
  });

  it('troca de empresa limpa o estado do consentimento', async () => {
    await upload();
    flushMasked(masked());
    TestBed.inject(TenantResetRegistry).run();
    fixture.detectChanges();

    expect(svc.masked()).toBeNull();
    expect(svc.draftId()).toBeNull();
    expect(el().textContent).not.toContain('[CPF_1]');
  });

  it('nome de arquivo hostil é exibido como texto, nunca como HTML', async () => {
    await start(true);
    await pick(docx('<img src=x onerror=alert(1)>.docx'));

    expect(q('img')).toBeNull();
    expect(el().textContent).toContain('<img src=x onerror=alert(1)>.docx');
  });

  it('.docx com MIME errado ou sem cabeçalho ZIP é recusado', async () => {
    await start(true);
    await pick(docx('contrato.docx', [0x50, 0x4b, 0x03, 0x04], 'application/pdf'));
    expect(button('Enviar para análise')).toBeUndefined();
    expect(el().textContent).toContain('Word (.docx)');

    await pick(docx('contrato.docx', [0x25, 0x50, 0x44, 0x46, 0x2d]));
    expect(button('Enviar para análise')).toBeUndefined();
    expect(el().textContent).toContain('não parece ser um documento Word');
    http.expectNone((r) => r.method === 'POST');
  });

  it('arquivo acima de 5 MB é recusado sem ler nem enviar', async () => {
    await start(true);
    const big = docx('contrato.docx');
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
    await pick(big);
    expect(el().textContent).toContain('5 MB');
    expect(button('Enviar para análise')).toBeUndefined();
  });

  it('caracteres bidi e de controle no nome do arquivo não chegam à tela', async () => {
    await start(true);
    await pick(docx('contrato‮​gnp.docx'));
    const shown = q('p.font-semibold')!.textContent ?? '';
    expect(shown).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B-\u200F]/);
    expect(shown).toContain('contratognp.docx');
  });

  it('trecho e motivo com caracteres bidi chegam limpos nas dúvidas', async () => {
    await start(
      true,
      draft({
        doubts: [
          suggestion({
            excerpt: 'Jo\u202Eão',
            context: 'com Jo\u202Eão, CPF [CPF_1]',
            reason: 'motivo\u2066 x',
          }),
        ],
      }),
    );
    expect(q('mark')!.textContent).toBe('João');
    expect(el().textContent).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  });

  it('arquivo que não é .docx é recusado antes de qualquer envio', async () => {
    await start(true);
    await pick(docx('contrato.pdf', [0x25, 0x50, 0x44, 0x46], 'application/pdf'));

    expect(el().textContent).toContain('Word (.docx)');
    expect(button('Enviar para análise')).toBeUndefined();
    http.expectNone((r) => r.method === 'POST');
  });

  it('dúvidas: uma por vez, trecho destacado, sugestão pré-marcada, e envia as decisões', async () => {
    await start(
      true,
      draft({
        doubts: [
          suggestion(),
          suggestion({ id: 's2', excerpt: 'R$ 500', context: 'caução de R$ 500', field: 'caucaoAmount', fieldLabel: 'Caução', alternatives: null }),
        ],
      }),
    );

    expect(el().textContent).toContain('Dúvida 1 de 2');
    expect(q('mark')!.textContent).toBe('João da Silva');
    const radios = Array.from(el().querySelectorAll<HTMLInputElement>('input[type=radio]'));
    expect(radios.find((r) => r.checked)!.value).toBe('driverName');
    expect(el().textContent).not.toContain('driverName'); // nenhum nome técnico visível

    // escolhe a alternativa e segue
    const alt = radios.find((r) => r.value === 'companyRepresentative')!;
    alt.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    button('Próxima')!.click();
    fixture.detectChanges();

    expect(el().textContent).toContain('Dúvida 2 de 2');
    expect(q('mark')!.textContent).toBe('R$ 500');
    button('Ver como fica')!.click();

    const put = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/decisions'));
    expect(put.request.body).toEqual({
      decisions: [
        { id: 's1', field: 'companyRepresentative', accept: true },
        { id: 's2', field: 'caucaoAmount', accept: true },
      ],
    });
    put.flush({ draftId: ID, status: 'FAILED', acceptedCount: 0, pendingDoubtIds: [] });
  });

  it.each([
    ['AI_DISABLED', 'indisponível'],
    ['AI_TIMEOUT', 'demorou'],
    ['AI_INVALID_RESPONSE', 'resposta'],
    ['NO_VALID_SUGGESTIONS', 'montar do zero'],
    ['SCANNED_PDF', 'escaneada'],
    ['FILE_INVALID', 'Word'],
  ])('falha %s mostra mensagem pt-BR e o caminho manual', async (code, snippet) => {
    await start(true, draft({ status: 'FAILED', failureCode: code, doubts: [] }));

    expect(el().textContent).toContain(snippet);
    expect(el().textContent).not.toContain(code);
    expect(button('Prefiro montar sozinho')).toBeTruthy();
  });

  it('fora do fluxo: sair da tela de progresso cancela o polling', async () => {
    vi.useFakeTimers();
    await start(true, draft({ status: 'ANALYZING', doubts: [] }));
    expect(el().textContent).toContain('Lendo o seu contrato');

    fixture.destroy();
    vi.advanceTimersByTime(30_000);
    vi.useRealTimers();
    http.expectNone((r) => r.url.includes(`/drafts/${ID}`));
  });

  it('tela 5: desligar um campo manda accept:false só para as sugestões dele', async () => {
    await start(
      true,
      draft({
        status: 'READY',
        certain: [
          suggestion({ id: 'c1', field: 'vehiclePlate', fieldLabel: 'Placa', excerpt: 'ABC1D23' }),
          suggestion({ id: 'c2', field: 'vehiclePlate', fieldLabel: 'Placa', excerpt: 'ABC1D23' }),
          suggestion({ id: 'c3', field: 'driverName', fieldLabel: 'Nome do motorista' }),
        ],
        doubts: [],
      }),
    );
    // READY abre a prévia, que baixa o DOCX; cancelamos a requisição e abrimos a tela 5.
    http.match((r) => r.url.endsWith('/preview')).forEach((r) => r.flush(new Blob(['x'])));
    svc.showFields.set(true);
    fixture.detectChanges();

    expect(el().textContent).toContain('usado em 2 lugares');
    expect(el().textContent).toContain('usado em 1 lugar');
    const placa = el().querySelector<HTMLButtonElement>('button[role=switch][aria-label="Placa"]')!;
    expect(placa.getAttribute('aria-checked')).toBe('true');
    placa.click();
    fixture.detectChanges();
    expect(placa.getAttribute('aria-checked')).toBe('false');

    button('Aplicar')!.click();
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.body).toEqual({
      decisions: [
        { id: 'c1', field: 'vehiclePlate', accept: false },
        { id: 'c2', field: 'vehiclePlate', accept: false },
        { id: 'c3', field: 'driverName', accept: true },
      ],
    });
    put.flush({ draftId: ID, status: 'READY', acceptedCount: 1, pendingDoubtIds: [] });
  });
});
