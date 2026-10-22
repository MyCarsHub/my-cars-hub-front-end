import { describe, expect, it } from 'vitest';
import { buildPreviewSrcdoc, sanitizePreviewHtml } from './contract-ai-sanitize';

// Vindo do antigo contract-ai-preview.spec (a tela saiu; o saneamento continua em uso pelo
// visualizador de documentos).
const HOSTILE =
  '<p onclick="alert(1)">oi <b onmouseover="x()">negrito</b></p>' +
  '<script>window.pwned=1</script>' +
  '<a href="javascript:alert(1)">link</a>' +
  '<a href=" jav&#x09;ascript:alert(2)">link2</a>' +
  '<a href="https://evil.example/x">ext</a>' +
  '<img src="http://evil.example/p.png" onerror="alert(3)">' +
  '<img src="data:image/png;base64,AAAA">' +
  '<link rel="stylesheet" href="http://evil.example/a.css">' +
  '<iframe src="http://evil.example"></iframe>' +
  '<svg onload="alert(4)"></svg>' +
  '<style>@import url(http://evil.example/b.css); p{background:url(http://evil.example/t.gif)}</style>' +
  '<div style="background:url(http://evil.example/z.png)">x</div>';

describe('sanitizePreviewHtml', () => {
  it('remove script, on*, javascript:, externos, link, iframe, svg e css remoto', () => {
    const out = sanitizePreviewHtml(HOSTILE);

    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/\bon\w+\s*=/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/evil\.example/);
    expect(out).not.toMatch(/<(link|iframe|svg)/i);
    expect(out).not.toMatch(/@import/i);
    expect(out).toContain('negrito');
    expect(out).toContain('data:image/png;base64,AAAA');
  });

  it('o srcdoc leva CSP restritiva antes do conteúdo', () => {
    const doc = buildPreviewSrcdoc('<p>x</p>');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('img-src data:');
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<p>x</p>'));
  });
});
