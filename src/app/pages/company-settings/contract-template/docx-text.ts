/**
 * Lê só o TEXTO dos parágrafos de um DOCX, para o contrato ao vivo mostrar «como foi
 * enviado». O `docx-preview` entra por import dinâmico (fora do bundle inicial) e desenha num
 * documento INERTE (sem navegador: nada carrega nem executa). Do resultado sai apenas
 * `textContent`; nenhum HTML do arquivo chega à tela.
 */
export async function readDocxParagraphs(blob: Blob): Promise<string[]> {
  const { renderAsync } = await import('docx-preview');
  const inert = document.implementation.createHTMLDocument('').createElement('div');
  await renderAsync(blob, inert, undefined, {
    inWrapper: false,
    ignoreWidth: true,
    ignoreHeight: true,
    renderHeaders: false,
    renderFooters: false,
    renderFootnotes: false,
    renderEndnotes: false,
    renderAltChunks: false,
    useBase64URL: true,
    debug: false,
  });
  const out: string[] = [];
  for (const p of Array.from(inert.querySelectorAll('p'))) {
    const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out;
}
