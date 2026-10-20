import { Injectable } from '@angular/core';
import {
  PREVIEW_CSP,
  sanitizePreviewHtml,
} from '../../pages/company-settings/contract-template/ai/contract-ai-sanitize';

/**
 * Largura de referência de uma página do Word em px CSS (Carta = 816, A4 = 794) mais a
 * margem da moldura. Usada para encaixar a folha inteira na largura do celular.
 */
export const DOCX_PAGE_WIDTH_PX = 840;

/**
 * DOCX → HTML SANEADO, pelo mesmo caminho da pré-visualização do contrato com IA
 * (`ContractAiPreview`), que é o caminho seguro que já existe no app:
 *
 *   contêiner INERTE (documento sem navegador) → `sanitizePreviewHtml` →
 *   `<iframe sandbox="">` sem scripts nem same-origin → CSP `PREVIEW_CSP` no srcdoc.
 *
 * O DOCX é da empresa (não confiável) e o app guarda o token na sessão: nada do
 * documento pode rodar nem buscar recurso externo. O caminho antigo do card de contrato
 * renderizava direto numa aba same-origin, sem nenhuma dessas camadas.
 *
 * `docx-preview` entra por `import()` dinâmico (já era um chunk lazy do app).
 */
@Injectable({ providedIn: 'root' })
export class DocxPreviewEngine {
  async toSafeHtml(source: Blob | ArrayBuffer): Promise<string> {
    const { renderAsync } = await import('docx-preview');
    const inert = document.implementation.createHTMLDocument('').createElement('div');
    await renderAsync(source, inert, undefined, {
      className: 'docx',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      useBase64URL: true,
      renderAltChunks: false,
      debug: false,
    });
    return sanitizePreviewHtml(inert.innerHTML);
  }
}

/**
 * Documento do srcdoc: CSP primeiro, depois a moldura escura do visualizador e o HTML
 * já saneado. `zoom` encaixa a folha na largura disponível (o sandbox não roda script,
 * então a escala vem de fora, calculada pelo visualizador).
 */
export function buildDocxSrcdoc(sanitizedHtml: string, zoom: number): string {
  const z = Math.max(0.2, Math.min(4, zoom)).toFixed(3);
  return (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">` +
    '<style>html,body{margin:0;background:#262626;}' +
    'body{padding:12px 0 96px;font-family:sans-serif;}' +
    `.docx-wrapper{background:transparent!important;padding:0!important;zoom:${z};}` +
    '.docx{background:#fff!important;margin:0 auto 16px!important;' +
    'box-shadow:0 1px 3px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.25);}</style>' +
    `</head><body>${sanitizedHtml}</body></html>`
  );
}
