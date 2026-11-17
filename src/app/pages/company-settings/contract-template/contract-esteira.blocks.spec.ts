import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../../environments/environment';
import { BlockView } from './ai/contract-ai.types';
import { ContractEsteira } from './contract-esteira';

const mocks = vi.hoisted(() => ({ renderAsync: vi.fn() }));
vi.mock('docx-preview', () => ({ renderAsync: mocks.renderAsync }));

const ROOT = `${environment.apiUrl}/settings/contract-template`;
const DRAFT = '11111111-2222-3333-4444-555555555555';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const REAL = {
  draftId: DRAFT,
  status: 'AWAITING_CONSENT',
  paragraphs: [
    { id: 'p0001', text: 'CONTRATO DE LOCAÇÃO', headingLevel: 1, bold: true, structural: true,
      sectionPath: [], cell: null, protectedSpans: [] },
    { id: 'p0002', text: 'LOCADORA: Alfa Locações Ltda, CNPJ 11.637.265/0001-11.', headingLevel: 0, bold: false,
      structural: false, sectionPath: ['CONTRATO DE LOCAÇÃO'], cell: null,
      protectedSpans: [{ start: 10, end: 28, kind: 'NAME' }, { start: 35, end: 53, kind: 'CNPJ' }] },
    { id: 'p0003', text: 'Avisos para Rua Sete de Setembro, 45.', headingLevel: 0, bold: false,
      structural: false, sectionPath: ['CONTRATO DE LOCAÇÃO'], cell: null,
      protectedSpans: [{ start: 12, end: 36, kind: 'ADDRESS' }] },
  ],
  maskedCounts: { NAME: 1, CNPJ: 1, ADDRESS: 1 },
};

const MASKED = {
  draftId: DRAFT,
  paragraphs: [
    { id: 'p0001', text: 'CONTRATO DE LOCAÇÃO' },
    { id: 'p0002', text: 'LOCADORA: [NOME_1], CNPJ [CNPJ_1].' },
    { id: 'p0003', text: 'Avisos para [ENDERECO_1].' },
  ],
  maskedTextSha256: 'abc',
  consentVersion: '3',
  notMasked: [],
  aiRoute: 'anthropic:claude-haiku-5-5',
  aiProviders: [{ provider: 'anthropic', label: 'Anthropic', models: ['claude-haiku-5-5'] }],
  maskedCounts: { NAME: 1, CNPJ: 1, ADDRESS: 1 },
};

const BLOCKS: BlockView[] = [
  {
    id: 'b0001', kind: 'CONFIRM', party: 'COMPANY', partyLabel: 'Locadora', aiParty: null, aiEvidence: null,
    source: 'LABEL', label: 'LOCADORA', sectionPath: ['CONTRATO DE LOCAÇÃO'],
    options: [{ party: 'DRIVER', label: 'Motorista (Locatário)' }, { party: 'COMPANY', label: 'Locadora' }],
    appliesTo: 2,
    items: [
      { id: 'q0001', kind: 'NAME', excerpt: 'Alfa Locações Ltda',
        context: 'LOCADORA: Alfa Locações Ltda, CNPJ 11.637.265/0001-11.',
        places: [{ paragraphId: 'p0002', excerpt: 'Alfa Locações Ltda' }],
        fieldsByParty: { COMPANY: [{ field: 'companyName', label: 'Nome da locadora' }] } },
      { id: 'q0002', kind: 'CNPJ', excerpt: '11.637.265/0001-11',
        context: 'LOCADORA: Alfa Locações Ltda, CNPJ 11.637.265/0001-11.',
        places: [{ paragraphId: 'p0002', excerpt: '11.637.265/0001-11' }],
        fieldsByParty: { COMPANY: [{ field: 'companyCnpj', label: 'CNPJ da locadora' }] } },
    ],
  },
  {
    id: 'b0002', kind: 'QUESTION', party: null, partyLabel: null, aiParty: null, aiEvidence: null,
    source: 'NONE', label: null, sectionPath: ['CONTRATO DE LOCAÇÃO'],
    options: [{ party: 'DRIVER', label: 'Motorista (Locatário)' }, { party: 'COMPANY', label: 'Locadora' }],
    appliesTo: 1,
    items: [
      { id: 'q0003', kind: 'ADDRESS', excerpt: 'Rua Sete de Setembro, 45',
        context: 'Avisos para Rua Sete de Setembro, 45.',
        places: [{ paragraphId: 'p0003', excerpt: 'Rua Sete de Setembro, 45' }],
        fieldsByParty: {
          DRIVER: [{ field: 'driverAddress', label: 'Endereço do motorista' }],
          COMPANY: [{ field: 'companyAddress', label: 'Endereço da locadora' }],
        } },
    ],
  },
];

describe('ContractEsteira: contrato real e perguntas por bloco', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ContractEsteira>;
  let host: HTMLElement;

  beforeEach(() => {
    sessionStorage.clear();
    mocks.renderAsync.mockReset();
    mocks.renderAsync.mockImplementation(async (_b: Blob, el: HTMLElement) => {
      el.innerHTML = '<p>CONTRATO</p>';
    });
    TestBed.configureTestingModule({
      imports: [ContractEsteira],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'));
  const button = (label: string) => buttons().find((b) => b.textContent?.trim().startsWith(label));
  const paperText = () => host.querySelector('article')?.textContent?.replace(/\s+/g, ' ') ?? '';
  function click(label: string): void {
    const b = button(label);
    expect(b, `botão «${label}»`).toBeTruthy();
    b!.click();
    fixture.detectChanges();
  }

  it('mostra o texto real com cadeado, a versão da IA no botão, e responde por bloco', async () => {
    fixture = TestBed.createComponent(ContractEsteira);
    host = fixture.nativeElement;
    fixture.detectChanges();
    http.expectOne(`${ROOT}/ai-capability`).flush({ enabled: true });
    http.expectOne(`${ROOT}/base`).flush({ code: 'X' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

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
    http.expectOne(`${ROOT}/drafts/${DRAFT}/document`).flush(REAL);
    fixture.detectChanges();
    http.expectOne(`${ROOT}/drafts/${DRAFT}/masked-text`).flush(MASKED);
    fixture.detectChanges();

    // Consentimento: o contrato real, com o que a IA não recebe marcado.
    expect(paperText()).toContain('Alfa Locações Ltda');
    expect(paperText()).toContain('11.637.265/0001-11');
    expect(paperText()).not.toMatch(/\[[A-Z]+_\d+\]|escondid/);
    expect(host.querySelectorAll('article [data-protected]').length).toBe(3);
    expect(host.querySelector('[data-masked-summary]')?.textContent).toContain(
      'escondemos 1 nome, 1 endereço e 1 CNPJ',
    );

    // «Ver como a IA recebe»: a versão mascarada, exatamente a que sai daqui.
    click('Ver como a IA recebe');
    expect(paperText()).toContain('nome escondido');
    expect(paperText()).not.toContain('Alfa Locações Ltda');
    click('Ver o meu contrato');
    expect(paperText()).toContain('Alfa Locações Ltda');

    host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    fixture.detectChanges();
    click('Autorizar e analisar');
    http.expectOne(`${ROOT}/drafts/${DRAFT}/consent`).flush({ draftId: DRAFT, status: 'ANALYZING' });
    fixture.detectChanges();
    http.expectOne(`${ROOT}/drafts/${DRAFT}`).flush({
      draftId: DRAFT, status: 'NEEDS_REVIEW', failureCode: null, filename: 'meu.docx', layoutSimplified: false,
      certain: [], doubts: [],
      questions: [
        { id: 'q0001', kind: 'NAME', excerpt: 'Alfa Locações Ltda', context: '', places: [], options: [], nearby: [] },
        { id: 'q0002', kind: 'CNPJ', excerpt: '11.637.265/0001-11', context: '', places: [], options: [], nearby: [] },
        { id: 'q0003', kind: 'ADDRESS', excerpt: 'Rua Sete de Setembro, 45', context: '', places: [], options: [], nearby: [] },
      ],
      blocks: BLOCKS,
    });
    fixture.detectChanges();

    // Pergunta 1 de 2: o bloco que o contrato já diz de quem é. O campo proposto aparece sobre o texto real.
    expect(host.textContent).toContain('Pergunta 1 de 2');
    expect(host.textContent).toContain('Encontramos estes dados da Locadora');
    expect(paperText()).toContain('Alfa Locações Ltda');
    expect(paperText()).toContain('Nome da locadora');
    click('Está certo');
    click('Próxima pergunta');

    // Pergunta 2 de 2: sem título nem rótulo, o dono escolhe a parte.
    expect(host.textContent).toContain('Este endereço é de quem?');
    expect(host.textContent).toContain('Esta resposta vale para 1 item');
    host.querySelector<HTMLButtonElement>('[data-party="COMPANY"]')!.click();
    fixture.detectChanges();
    click('Ver como ficou');

    const put = http.expectOne(`${ROOT}/drafts/${DRAFT}/decisions`);
    expect(put.request.body).toEqual({
      decisions: [],
      blocks: [
        { id: 'b0001', party: 'COMPANY' },
        { id: 'b0002', party: 'COMPANY' },
      ],
    });
    put.flush({ draftId: DRAFT, status: 'READY', acceptedCount: 3, pendingDoubtIds: [] });
    fixture.detectChanges();

    expect(host.textContent).toContain('Confira e salve');
    expect(paperText()).toContain('Rua Sete de Setembro, 45');
    expect(paperText()).toContain('Endereço da locadora');
    expect(host.textContent).not.toContain('sem resposta');

    click('Salvar contrato');
    const save = http.expectOne(`${ROOT}/drafts/${DRAFT}/save`);
    expect(save.request.body).toEqual({ questionsReviewed: true });
  });
});
