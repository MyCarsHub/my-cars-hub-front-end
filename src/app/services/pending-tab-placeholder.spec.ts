import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PAYMENT_PLACEHOLDER_COPY,
  PLACEHOLDER_STALL_MS,
  POLICY_DOCUMENT_PLACEHOLDER_COPY,
  renderPendingTabPlaceholder,
} from './pending-tab-placeholder';

/** Stand-in for the `about:blank` document of the reserved tab. */
const blankTabDocument = () => document.implementation.createHTMLDocument('');

describe('renderPendingTabPlaceholder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // A tela de carregamento
  // ---------------------------------------------------------------------------

  it('renders a spinner instead of the bare text message', () => {
    const doc = blankTabDocument();

    renderPendingTabPlaceholder(doc);

    expect(doc.querySelector('.mch-spinner')).not.toBeNull();
    expect(doc.querySelector('style')?.textContent).toContain('@keyframes mch-spin');
  });

  it('keeps the "do not close this tab" warning — the useful half of the old text', () => {
    const doc = blankTabDocument();

    renderPendingTabPlaceholder(doc);

    expect(doc.body.textContent).toContain('Não feche esta aba');
    expect(doc.body.textContent).toContain(PAYMENT_PLACEHOLDER_COPY.title);
    expect(doc.title).toBe(PAYMENT_PLACEHOLDER_COPY.documentTitle);
  });

  it('announces the wait to screen readers and hides the decorative spinner', () => {
    const doc = blankTabDocument();

    renderPendingTabPlaceholder(doc);

    const stage = doc.querySelector('.mch-stage');
    expect(stage?.getAttribute('role')).toBe('status');
    expect(stage?.getAttribute('aria-live')).toBe('polite');
    expect(doc.querySelector('.mch-spinner')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('stops the animation under prefers-reduced-motion', () => {
    const doc = blankTabDocument();

    renderPendingTabPlaceholder(doc);

    const css = doc.querySelector('style')?.textContent ?? '';
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('accepts alternative copy for callers that are not the checkout', () => {
    const doc = blankTabDocument();

    renderPendingTabPlaceholder(doc, {
      documentTitle: 'Abrindo apólice…',
      title: 'Abrindo a apólice',
      note: 'Não feche esta aba.',
    });

    expect(doc.body.textContent).toContain('Abrindo a apólice');
    expect(doc.body.textContent).not.toContain('pagamento');
  });

  // ---------------------------------------------------------------------------
  // O caminho de falha: ninguém fica preso no spinner
  // ---------------------------------------------------------------------------

  it('holds the loading state while the opener still has time to act', () => {
    const doc = blankTabDocument();

    renderPendingTabPlaceholder(doc);
    // O teto de 20s do POST /billing/checkout ainda não estourou.
    vi.advanceTimersByTime(PLACEHOLDER_STALL_MS - 1);

    expect(doc.querySelector('.mch-spinner')).not.toBeNull();
    expect(doc.body.textContent).toContain('Não feche esta aba');
  });

  it('drops the spinner and offers a way out when no redirect ever arrives', () => {
    const doc = blankTabDocument();

    renderPendingTabPlaceholder(doc);
    vi.advanceTimersByTime(PLACEHOLDER_STALL_MS);

    // Sem spinner eterno...
    expect(doc.querySelector('.mch-spinner')).toBeNull();
    // ...e com uma saída acionável, dentro do mesmo aria-live.
    expect(doc.body.textContent).toContain('Está demorando mais que o esperado');
    expect(doc.body.textContent).toContain('Feche esta aba');
    // O usuário não pode achar que pagou.
    expect(doc.body.textContent).toContain('Nada foi cobrado');
    expect(doc.querySelector('.mch-stage')?.getAttribute('aria-live')).toBe('polite');
  });

  it('stays silent when the tab was navigated away before the stall fires', () => {
    const doc = blankTabDocument();

    renderPendingTabPlaceholder(doc);
    // `location.replace` derruba o documento: o nó deixa de estar conectado.
    doc.querySelector('.mch-stage')?.remove();

    expect(() => vi.advanceTimersByTime(PLACEHOLDER_STALL_MS)).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // A apólice não cobra nada — a aba dela não pode falar em pagamento
  // ---------------------------------------------------------------------------

  it('a apólice nunca anuncia pagamento enquanto carrega', () => {
    const doc = blankTabDocument();

    renderPendingTabPlaceholder(doc, POLICY_DOCUMENT_PLACEHOLDER_COPY);

    expect(doc.title).toBe(POLICY_DOCUMENT_PLACEHOLDER_COPY.documentTitle);
    expect(doc.body.textContent).toContain('Abrindo a apólice');
    expect(doc.body.textContent).toContain('Não feche esta aba');
    expect(doc.body.textContent).not.toContain('pagamento');
  });

  it('a apólice também não anuncia cobrança no estado de impasse', () => {
    const doc = blankTabDocument();

    renderPendingTabPlaceholder(doc, POLICY_DOCUMENT_PLACEHOLDER_COPY);
    vi.advanceTimersByTime(PLACEHOLDER_STALL_MS);

    expect(doc.querySelector('.mch-spinner')).toBeNull();
    // A saída acionável continua lá, sem a promessa de que nada foi cobrado.
    expect(doc.body.textContent).toContain('Feche esta aba');
    expect(doc.body.textContent).not.toContain('cobrado');
    expect(doc.body.textContent).not.toContain('pagamento');
  });

  it('never throws when the document refuses to cooperate', () => {
    const hostile = {
      createElement: () => {
        throw new Error('dead document');
      },
    } as unknown as Document;

    expect(() => renderPendingTabPlaceholder(hostile)).not.toThrow();
  });
});
