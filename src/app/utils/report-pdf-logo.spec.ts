import type jsPDF from 'jspdf';
import { describe, expect, it, vi } from 'vitest';
import { PDF_TABLE_TOP_MARGIN, stampLogoOnEveryPage } from './report-pdf-logo';

const PAGE_WIDTH = 595.28;

interface FakeDoc {
  addImage: ReturnType<typeof vi.fn>;
  setPage: ReturnType<typeof vi.fn>;
  getNumberOfPages: () => number;
  getCurrentPageInfo: () => { pageNumber: number };
  internal: { pageSize: { getWidth: () => number } };
}

function createFakeDoc(totalPages: number, addImage = vi.fn()): FakeDoc {
  return {
    addImage,
    setPage: vi.fn(),
    getNumberOfPages: () => totalPages,
    getCurrentPageInfo: () => ({ pageNumber: totalPages }),
    internal: { pageSize: { getWidth: () => PAGE_WIDTH } },
  };
}

function asDoc(doc: FakeDoc): jsPDF {
  return doc as unknown as jsPDF;
}

describe('stampLogoOnEveryPage', () => {
  it('carimba a logo uma vez em cada página, inclusive a primeira', () => {
    const doc = createFakeDoc(3);

    stampLogoOnEveryPage(asDoc(doc));

    expect(doc.addImage).toHaveBeenCalledTimes(3);
    expect(doc.setPage).toHaveBeenCalledWith(1);
    expect(doc.setPage).toHaveBeenCalledWith(2);
    expect(doc.setPage).toHaveBeenCalledWith(3);
  });

  it('posiciona a logo no canto superior direito, dentro da margem', () => {
    const doc = createFakeDoc(1);

    stampLogoOnEveryPage(asDoc(doc));

    const [data, format, x, y, w, h] = doc.addImage.mock.calls[0];
    expect(String(data)).toMatch(/^data:image\/png;base64,/);
    expect(format).toBe('PNG');
    expect(w).toBe(h);
    expect(y).toBeGreaterThan(0);
    // À direita, sem estourar a página.
    expect(x + w).toBeLessThan(PAGE_WIDTH);
    expect(x).toBeGreaterThan(PAGE_WIDTH / 2);
    // Tabelas começam abaixo do bloco da logo.
    expect(PDF_TABLE_TOP_MARGIN).toBeGreaterThan(y + h);
  });

  it('restaura a página corrente após carimbar', () => {
    const doc = createFakeDoc(2);

    stampLogoOnEveryPage(asDoc(doc));

    expect(doc.setPage).toHaveBeenLastCalledWith(2);
  });

  it('degrada silenciosamente quando o desenho da logo falha', () => {
    const addImage = vi.fn(() => {
      throw new Error('imagem inválida');
    });
    const doc = createFakeDoc(2, addImage);

    expect(() => stampLogoOnEveryPage(asDoc(doc))).not.toThrow();
    expect(addImage).toHaveBeenCalledTimes(1);
  });
});
