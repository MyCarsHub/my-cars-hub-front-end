import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { PendingDocumentsBlock, PendingSlotView } from './pending-documents-block';

/**
 * FIX-0231 — o bloco de cadastro COMPARTILHADO, testado direto pelos seus
 * DEFAULTS (o wrapper do motorista sobrescreve `sentNote`; aqui fica pinado o
 * que vale para o próximo adotante que NÃO sobrescrever) e pelo fio do gesto.
 * O comportamento do motorista continua coberto pelos specs do driver-form.
 */
describe('PendingDocumentsBlock — defaults e gesto (FIX-0231/0236)', () => {
  const slot = (over: Partial<PendingSlotView> = {}): PendingSlotView => ({
    kind: 'NOTA',
    label: 'Nota fiscal',
    hint: 'Peça e mão de obra.',
    files: [],
    sent: false,
    ...over,
  });

  let fixture: ComponentFixture<PendingDocumentsBlock>;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function slotEl(kind: string): HTMLElement {
    const el = host().querySelector<HTMLElement>(`[data-doc-slot="${kind}"]`);
    if (!el) throw new Error(`slot ${kind} não está na tela`);
    return el;
  }

  function slotButton(kind: string): HTMLButtonElement {
    const el = slotEl(kind).querySelector<HTMLButtonElement>(':scope > button');
    if (!el) throw new Error(`slot ${kind} não tem botão`);
    return el;
  }

  function setup(slots: PendingSlotView[]): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(PendingDocumentsBlock);
    fixture.componentRef.setInput('description', 'Descrição de teste.');
    fixture.componentRef.setInput('slots', slots);
    fixture.detectChanges();
  }

  it('slot enviado usa o sentNote DEFAULT quando o consumidor não sobrescreve', () => {
    setup([
      slot({
        sent: true,
        files: [{ id: 1, name: 'nota.pdf', sizeText: '2.0 KB', sent: true }],
      }),
    ]);

    const aria = slotButton('NOTA').getAttribute('aria-label') ?? '';
    expect(aria).toBe('Nota fiscal — documento já enviado. Gerencie pelo detalhe.');
    expect(slotButton('NOTA').disabled).toBe(true);
    expect(host().textContent).toContain('Enviado');
  });

  it('renderiza TODOS os arquivos do slot, um por linha, com remover nos não enviados', () => {
    setup([
      slot({
        files: [
          { id: 1, name: 'primeira.pdf', sizeText: '2.0 KB', sent: true },
          { id: 2, name: 'segunda.pdf', sizeText: '3.0 KB', sent: false },
        ],
      }),
    ]);

    const rows = slotEl('NOTA').querySelectorAll('ul > li');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('primeira.pdf');
    expect(rows[0].textContent).toContain('Enviado');
    expect(rows[1].textContent).toContain('segunda.pdf');
    expect(rows[1].querySelector('button[aria-label="Remover segunda.pdf"]')).not.toBeNull();
  });

  it('emite filePicked com o tipo do slot tocado quando o arquivo passa nas regras', () => {
    setup([slot()]);
    const picked = vi.fn();
    fixture.componentInstance.filePicked.subscribe(picked);

    slotButton('NOTA').click();
    fixture.detectChanges();
    const input = host().querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('o seletor de arquivos não está na tela');
    const file = new File(['x'], 'nota.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(picked).toHaveBeenCalledTimes(1);
    expect(picked).toHaveBeenCalledWith({ kind: 'NOTA', file });
  });

  /** FIX-0236: sem arquivo = VERMELHO; com arquivo (pendente ou enviado) = VERDE. */
  it('pinta o slot vazio de vermelho e o slot com arquivo de verde', () => {
    setup([
      slot(),
      slot({
        kind: 'RECIBO',
        label: 'Recibo',
        files: [{ id: 1, name: 'recibo.pdf', sizeText: '2.0 KB', sent: false }],
      }),
    ]);

    const empty = slotEl('NOTA');
    expect(empty.getAttribute('data-filled')).toBe('false');
    expect(empty.classList.contains('bg-rose-50')).toBe(true);
    expect(empty.classList.contains('border-rose-500')).toBe(true);
    expect(empty.classList.contains('border-dashed')).toBe(true);

    const filled = slotEl('RECIBO');
    expect(filled.getAttribute('data-filled')).toBe('true');
    expect(filled.classList.contains('bg-success-50')).toBe(true);
    expect(filled.classList.contains('border-success-100')).toBe(true);
  });
});
