import type jsPDF from 'jspdf';

/**
 * Logo oficial do MyCarsHub (`public/icons/icon-192.png`) embutida como data URI.
 *
 * Embutida em vez de buscada em runtime: jsPDF não renderiza SVG nativamente, o projeto
 * não pode ganhar dependência nova e um `fetch` tornaria `exportReportPdf` assíncrono
 * (mudando a assinatura pública). O PNG tem ~2,7 KB, então o custo de bundle é irrelevante
 * e a exportação nunca depende de rede, CORS ou do asset estar publicado.
 */
const LOGO_PNG_DATA_URI =
  'data:image/png;base64,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';

/** Lado do quadrado da logo, em pt. */
const LOGO_SIZE = 26;

/** Distância da logo até as bordas superior e direita da página, em pt. */
const LOGO_MARGIN = 24;

/**
 * Espaço reservado no topo das páginas para a logo não colidir com as tabelas.
 * Use como `margin: { top: PDF_TABLE_TOP_MARGIN }` em cada `autoTable`.
 */
export const PDF_TABLE_TOP_MARGIN = LOGO_MARGIN + LOGO_SIZE + 14;

/**
 * Carimba a logo no canto superior direito de todas as páginas já criadas no documento.
 * Deve ser chamada depois de gerado todo o conteúdo e antes de salvar.
 *
 * A logo é decorativa: qualquer falha ao desenhar é engolida para não impedir a exportação.
 */
export function stampLogoOnEveryPage(doc: jsPDF): void {
  try {
    const x = doc.internal.pageSize.getWidth() - LOGO_MARGIN - LOGO_SIZE;
    const currentPage = doc.getCurrentPageInfo().pageNumber;
    const totalPages = doc.getNumberOfPages();

    for (let page = 1; page <= totalPages; page++) {
      doc.setPage(page);
      doc.addImage(
        LOGO_PNG_DATA_URI,
        'PNG',
        x,
        LOGO_MARGIN,
        LOGO_SIZE,
        LOGO_SIZE,
        'mycarshub-logo',
        'FAST',
      );
    }

    doc.setPage(currentPage);
  } catch {
    // Silencioso de propósito: relatório sem logo é melhor que relatório não exportado.
  }
}
