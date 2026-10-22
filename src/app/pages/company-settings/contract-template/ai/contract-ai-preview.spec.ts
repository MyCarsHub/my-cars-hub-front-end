import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractAiPreview } from './contract-ai-preview';
import { ContractAiService } from './contract-ai.service';
import { buildPreviewSrcdoc, sanitizePreviewHtml } from './contract-ai-sanitize';

const ID = '11111111-2222-3333-4444-555555555555';

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

const mocks = vi.hoisted(() => ({
  renderAsync: vi.fn(),
}));
vi.mock('docx-preview', () => ({ renderAsync: mocks.renderAsync }));

describe('sanitizePreviewHtml', () => {
  it('remove script, on*, javascript:, externos, link, iframe, svg e css remoto', () => {
    const out = sanitizePreviewHtml(HOSTILE);

    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/\bon\w+\s*=/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/evil\.example/);
    expect(out).not.toMatch(/<(link|iframe|svg)/i);
    expect(out).not.toMatch(/@import/i);
    expect(out).toContain('negrito'); // conteúdo legítimo preservado
    expect(out).toContain('data:image/png;base64,AAAA'); // imagem embutida permitida
  });

  it('o srcdoc leva CSP restritiva antes do conteúdo', () => {
    const doc = buildPreviewSrcdoc('<p>x</p>');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('img-src data:');
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<p>x</p>'));
  });
});

describe('ContractAiPreview', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.renderAsync.mockReset();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('DOCX hostil vai para um iframe sandbox sem scripts/same-origin e nada entra no DOM da SPA', async () => {
    mocks.renderAsync.mockImplementation(async (_blob: Blob, container: HTMLElement) => {
      container.innerHTML = HOSTILE;
    });
    const http = TestBed.inject(HttpTestingController);
    const svc = TestBed.inject(ContractAiService);
    svc.draftId.set(ID);

    const fixture = TestBed.createComponent(ContractAiPreview);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.endsWith(`/drafts/${ID}/preview`))
      .flush(new Blob(['x']));
    await new Promise((r) => setTimeout(r, 20));
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const frame = host.querySelector('iframe')!;
    const sandbox = frame.getAttribute('sandbox');
    expect(sandbox).not.toBeNull();
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');

    // O renderer recebeu um contêiner FORA do documento da SPA.
    const container = mocks.renderAsync.mock.calls[0][1] as HTMLElement;
    expect(container.ownerDocument).not.toBe(document);

    // Nada do documento chegou ao DOM da SPA (host e document).
    for (const root of [host, document.body]) {
      expect(root.querySelector('script')).toBeNull();
      expect(root.querySelector('img')).toBeNull();
      expect(root.querySelector('link[href*="evil"]')).toBeNull();
      expect(root.querySelector('[onclick],[onmouseover],[onerror]')).toBeNull();
      expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
    }
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();

    // O que foi para o iframe já está saneado e com CSP.
    const srcdoc = frame.srcdoc;
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain('negrito');
    expect(srcdoc).not.toMatch(/<script|javascript:|evil\.example|onerror|onclick/i);
  });
});
