import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
      providers: [provideHttpClient(), provideHttpClientTesting()],
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
    expect(paperText()).toContain('{{franchiseKm}}');

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
    });
    fixture.detectChanges();
    expect(paperText()).toContain('CPF escondido');
    expect(paperText()).not.toContain('[CPF_1]');

    expect(button('Autorizar e analisar')!.disabled).toBe(true);
    host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    fixture.detectChanges();
    click('Autorizar e analisar');
    const consent = http.expectOne(`${ROOT}/drafts/${DRAFT}/consent`);
    expect(consent.request.body).toEqual({ consentVersion: 'v3', maskedTextSha256: 'abc' });
    consent.flush({ draftId: DRAFT, status: 'ANALYZING' });
    fixture.detectChanges();
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
    expect(paperText()).toContain('{{totalAmount}}');
    expect(paperText()).toContain('{{driverCpf}}');
  });
});
