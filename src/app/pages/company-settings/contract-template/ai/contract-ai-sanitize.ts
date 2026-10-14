/**
 * Saneamento do HTML da pré-visualização. O DOCX é da empresa (não confiável) e o app
 * guarda o token na sessão: nada do documento pode rodar nem buscar recurso externo.
 * Defesa em camadas: contêiner inerte, este filtro, iframe sandbox sem scripts/same-origin
 * e CSP restritiva no srcdoc.
 */

const BLOCKED_TAGS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base',
  'form', 'input', 'button', 'noscript', 'template', 'svg', 'math', 'audio', 'video', 'source',
  'track', 'portal',
]);

const URL_ATTRS = new Set([
  'href', 'src', 'xlink:href', 'action', 'formaction', 'srcset', 'poster', 'background',
  'data', 'ping', 'cite',
]);

const SAFE_URL = /^(#|data:image\/(png|jpe?g|gif|webp|bmp);base64,)/i;

/** `url(...)` só passa com data:image; `@import` e `expression()` somem. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/url\(\s*(['"]?)\s*(?!data:image\/)[^)]*\)/gi, 'url()');
}

export function sanitizePreviewHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const all = Array.from(doc.body.querySelectorAll('*'));
  for (const el of all) {
    if (BLOCKED_TAGS.has(el.tagName.toLowerCase())) {
      el.remove();
      continue;
    }
    if (el.tagName.toLowerCase() === 'style') {
      el.textContent = sanitizeCss(el.textContent ?? '');
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (URL_ATTRS.has(name)) {
        // Remove controles e espaços que ajudam a disfarçar "java\tscript:".
        // eslint-disable-next-line no-control-regex
        const value = attr.value.replace(/[\u0000- ]+/g, '');
        if (!SAFE_URL.test(value)) el.removeAttribute(attr.name);
      } else if (name === 'style') {
        el.setAttribute('style', sanitizeCss(attr.value));
      }
    }
  }
  // <style> do docx-preview pode cair no <head> ao ser re-parseado.
  for (const s of Array.from(doc.head.querySelectorAll('style'))) {
    s.textContent = sanitizeCss(s.textContent ?? '');
  }
  return doc.head.innerHTML + doc.body.innerHTML;
}

export const PREVIEW_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/** Documento completo do srcdoc: CSP primeiro, depois o conteúdo já saneado. */
export function buildPreviewSrcdoc(sanitizedHtml: string): string {
  return (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">` +
    '<style>body{margin:0;padding:8px;background:#f5f5f5;font-family:sans-serif}' +
    '.docx-wrapper{background:transparent!important;padding:0!important}' +
    '.docx{background:#fff!important;margin:0 auto 12px;max-width:100%}</style>' +
    `</head><body>${sanitizedHtml}</body></html>`
  );
}
