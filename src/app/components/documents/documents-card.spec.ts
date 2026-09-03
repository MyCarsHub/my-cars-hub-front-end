import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentLike, DocumentSlotDef, DocumentsCard } from './documents-card';
import { ApiErrorService } from '../../services/api-error.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';

/**
 * FIX-0231 — o card COMPARTILHADO, testado direto pela superfície que os
 * wrappers parametrizam. O comportamento canônico (um por tipo, portão,
 * estados, upload abortável) já é coberto pelos 41 testes do wrapper do
 * motorista; aqui ficam SÓ os contratos de parametrização que o motorista não
 * exercita: `maxPerKind > 1` (modo N, futuro card de incidentes) e o fallback
 * da mensagem de portão.
 */
describe('DocumentsCard — parametrização (FIX-0231)', () => {
  const doc = (id: string, kind: string, fileName = `${id}.pdf`): DocumentLike => ({
    id,
    kind,
    kindLabel: kind,
    fileName,
    sizeBytes: 2048,
    createdDate: '2026-03-02T12:00:00',
  });

  const COPY = {
    documentTitle: 'Abrindo…',
    title: 'Abrindo o documento',
    note: 'Aguarde.',
    stalledNote: 'Falhou.',
  };

  let list: ReturnType<typeof vi.fn>;
  let upload: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<DocumentsCard>;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function slotButton(kind: string): HTMLButtonElement {
    const el = host().querySelector<HTMLButtonElement>(`[data-kind="${kind}"] > button`);
    if (!el) throw new Error(`slot ${kind} não está na tela`);
    return el;
  }

  function dispatchFile(name: string): void {
    const input = host().querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('o seletor de arquivos não está na tela');
    const file = new File(['x'], name, { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  async function setup(opts: {
    defs: DocumentSlotDef[];
    docs?: DocumentLike[];
    maxPerKind?: number;
  }): Promise<void> {
    list = vi.fn(() => of(opts.docs ?? []));
    upload = vi.fn((kind: string) => of(doc('novo', kind, 'novo.pdf')));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: ExternalNavigationService, useValue: { openPendingTab: vi.fn() } },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
        },
        { provide: ApiErrorService, useValue: { claim: vi.fn(), messageFor: vi.fn(() => 'erro') } },
      ],
    });

    fixture = TestBed.createComponent(DocumentsCard);
    fixture.componentRef.setInput('slotDefs', opts.defs);
    fixture.componentRef.setInput('ops', {
      list,
      upload,
      remove: vi.fn(() => of(void 0)),
      signedUrl: vi.fn(() => of({ url: 'https://signed' })),
    });
    fixture.componentRef.setInput('description', 'Descrição de teste.');
    fixture.componentRef.setInput('placeholderCopy', COPY);
    if (opts.maxPerKind !== undefined) {
      fixture.componentRef.setInput('maxPerKind', opts.maxPerKind);
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const NOTA: DocumentSlotDef = {
    kind: 'NOTA',
    label: 'Nota fiscal',
    hint: 'Peça e mão de obra.',
    required: true,
  };

  it('com maxPerKind 2, o slot com 1 arquivo continua anexável e o 2º ACRESCENTA', async () => {
    await setup({ defs: [NOTA], docs: [doc('d1', 'NOTA')], maxPerKind: 2 });

    expect(slotButton('NOTA').disabled).toBe(false);
    // No modo N o rótulo é contagem, não "Anexado".
    expect(host().textContent).toContain('1 arquivo');
    expect(host().textContent).not.toContain('Anexado');
    // E a label não mente "nenhum arquivo" nem promete substituição: tem
    // documento E tem vaga.
    expect(slotButton('NOTA').getAttribute('aria-label')).toBe(
      'Anexar Nota fiscal — documento anexado, ainda há vaga',
    );

    slotButton('NOTA').click();
    fixture.detectChanges();
    dispatchFile('segunda-nota.pdf');

    expect(upload).toHaveBeenCalledTimes(1);
    expect(host().querySelectorAll('[data-file-row]')).toHaveLength(2);
    expect(host().textContent).toContain('2 arquivos');
  });

  it('com maxPerKind 2, o slot CHEIO (2 arquivos) tranca como o 1-por-tipo tranca no 1º', async () => {
    await setup({
      defs: [NOTA],
      docs: [doc('d1', 'NOTA'), doc('d2', 'NOTA')],
      maxPerKind: 2,
    });

    expect(slotButton('NOTA').disabled).toBe(true);
    slotButton('NOTA').click();
    fixture.detectChanges();
    dispatchFile('terceira.pdf');
    expect(upload).not.toHaveBeenCalled();
  });

  it('recusa o kind vedado com a mensagem PADRÃO quando a def não traz uma própria', async () => {
    // Portão aberto no toque…
    await setup({ defs: [{ ...NOTA, gated: false }] });
    slotButton('NOTA').click();
    fixture.detectChanges();

    // …e fechado antes da escolha do arquivo (defs são reativas), SEM mensagem própria.
    fixture.componentRef.setInput('slotDefs', [{ ...NOTA, gated: true }]);
    fixture.detectChanges();
    dispatchFile('nota.pdf');

    expect(upload).not.toHaveBeenCalled();
    expect(host().textContent).toContain(
      'Este tipo de documento não está disponível. Escolha outro tipo e envie de novo.',
    );
  });

  it('usa a descrição e o título parametrizados', async () => {
    await setup({ defs: [NOTA] });
    expect(host().textContent).toContain('Descrição de teste.');
    // Sem override, o título default.
    expect(host().textContent).toContain('Documentos');

    fixture.componentRef.setInput('title', 'Documentos da manutenção');
    fixture.detectChanges();
    expect(host().textContent).toContain('Documentos da manutenção');
  });

  /**
   * FIX-0236 (decisão do usuário): tipo SEM documento lê VERMELHO — essencial
   * e opcional por igual —, COM documento lê VERDE (parcial do modo N
   * incluso), e o portão fechado segue neutro apagado. As classes saem dos
   * tokens danger/success existentes.
   */
  it('pinta vazio de vermelho, preenchido de verde e mantém o portão neutro', async () => {
    await setup({
      defs: [
        NOTA,
        { kind: 'RECIBO', label: 'Recibo', hint: 'Comprovante.', required: false },
        {
          kind: 'EXTRA',
          label: 'Extra',
          hint: 'Vedado.',
          required: false,
          gated: true,
        },
      ],
      docs: [doc('d1', 'NOTA'), doc('d9', 'EXTRA')],
    });

    const filled = host().querySelector('[data-kind="NOTA"]');
    expect(filled?.getAttribute('data-state')).toBe('filled');
    expect(filled?.classList.contains('bg-success-50')).toBe(true);
    expect(filled?.classList.contains('border-success-100')).toBe(true);

    // Opcional vazio também é vermelho — a regra é estrita, sem exceção.
    const empty = host().querySelector('[data-kind="RECIBO"]');
    expect(empty?.getAttribute('data-state')).toBe('empty');
    expect(empty?.classList.contains('bg-rose-50')).toBe(true);
    expect(empty?.classList.contains('border-rose-500')).toBe(true);
    expect(empty?.classList.contains('border-dashed')).toBe(true);

    const gated = host().querySelector('[data-kind="EXTRA"]');
    expect(gated?.getAttribute('data-state')).toBe('gated');
    expect(gated?.classList.contains('bg-neutral-50')).toBe(true);
    expect(gated?.classList.contains('bg-rose-50')).toBe(false);
    expect(gated?.classList.contains('bg-success-50')).toBe(false);
  });

  /**
   * O substantivo é parametrizável (iteração 3): o sinistro se intitula
   * "Anexos" e precisa que TODAS as mensagens digam "anexo". O default cobre
   * as demais entidades sem que elas passem nada.
   */
  it('usa o substantivo parametrizado nas mensagens, com "documento" no default', async () => {
    await setup({ defs: [NOTA], docs: [doc('d1', 'NOTA')] });

    expect(host().querySelector('app-confirm-dialog')?.getAttribute('title')).toBeNull();
    expect(slotButton('NOTA').getAttribute('aria-label')).toContain('documento anexado');
    const abrir = host().querySelector('[data-file-row] button');
    expect(abrir?.getAttribute('aria-label')).toBe('Abrir documento d1.pdf');

    fixture.componentRef.setInput('nounSingular', 'anexo');
    fixture.detectChanges();

    expect(slotButton('NOTA').getAttribute('aria-label')).toContain('anexo anexado');
    expect(
      host().querySelector('[data-file-row] button')?.getAttribute('aria-label'),
    ).toBe('Abrir anexo d1.pdf');
  });

  beforeEach(() => {
    TestBed.resetTestingModule();
  });
});
