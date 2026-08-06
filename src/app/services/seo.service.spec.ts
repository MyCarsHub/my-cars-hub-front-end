import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DEFAULT_DESCRIPTION, SITE_ORIGIN, SeoService } from './seo.service';

describe('SeoService', () => {
  let seo: SeoService;
  let doc: Document;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    seo = TestBed.inject(SeoService);
    doc = TestBed.inject(DOCUMENT);
    doc.head.querySelectorAll('link[rel="canonical"], script[data-seo-jsonld]').forEach((el) => {
      el.remove();
    });
  });

  function meta(selector: string): string | null {
    return doc.head.querySelector(selector)?.getAttribute('content') ?? null;
  }

  function canonical(): string | null {
    return doc.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
  }

  describe('public routes (with data.seo)', () => {
    it('sets description, canonical and Open Graph from the route', () => {
      seo.applyRouteSeo({
        title: 'Termos de Uso — MyCarsHub',
        urlPath: '/termos-de-uso',
        seo: { description: 'Condições de uso.' },
      });

      expect(meta('meta[name="description"]')).toBe('Condições de uso.');
      expect(canonical()).toBe(`${SITE_ORIGIN}/termos-de-uso`);
      expect(meta('meta[property="og:url"]')).toBe(`${SITE_ORIGIN}/termos-de-uso`);
      expect(meta('meta[property="og:title"]')).toBe('Termos de Uso — MyCarsHub');
      expect(meta('meta[property="og:description"]')).toBe('Condições de uso.');
      expect(meta('meta[name="twitter:title"]')).toBe('Termos de Uso — MyCarsHub');
    });

    it('marks the page indexable', () => {
      seo.applyRouteSeo({ title: 'T', urlPath: '/', seo: { description: 'd' } });

      expect(meta('meta[name="robots"]')).toBe('index, follow');
    });

    it('honours an explicit canonicalPath so ?lang=en collapses onto the PT URL', () => {
      seo.applyRouteSeo({
        title: 'T',
        urlPath: '/politica-de-privacidade?lang=en',
        seo: { description: 'd', canonicalPath: '/politica-de-privacidade' },
      });

      expect(canonical()).toBe(`${SITE_ORIGIN}/politica-de-privacidade`);
    });

    it('strips query and fragment when the canonical falls back to the URL', () => {
      seo.applyRouteSeo({ title: 'T', urlPath: '/blog?page=2#topo', seo: { description: 'd' } });

      expect(canonical()).toBe(`${SITE_ORIGIN}/blog`);
    });

    it('keeps a single canonical element across navigations', () => {
      seo.applyRouteSeo({ title: 'A', urlPath: '/', seo: { description: 'a' } });
      seo.applyRouteSeo({ title: 'B', urlPath: '/blog', seo: { description: 'b' } });

      expect(doc.head.querySelectorAll('link[rel="canonical"]').length).toBe(1);
      expect(canonical()).toBe(`${SITE_ORIGIN}/blog`);
    });
  });

  describe('private routes (no data.seo)', () => {
    it('fails closed to noindex and drops the canonical', () => {
      seo.applyRouteSeo({ title: 'A', urlPath: '/', seo: { description: 'a' } });
      seo.applyRouteSeo({ title: 'Dashboard — MyCarsHub', urlPath: '/dashboard' });

      expect(meta('meta[name="robots"]')).toBe('noindex, nofollow');
      expect(canonical()).toBeNull();
    });

    it('falls back to the default description', () => {
      seo.applyRouteSeo({ title: 'Dashboard — MyCarsHub', urlPath: '/dashboard' });

      expect(meta('meta[name="description"]')).toBe(DEFAULT_DESCRIPTION);
    });
  });

  /**
   * `/blog/:slug` carries a single static description for every post. Without a runtime
   * override the whole blog ships duplicate meta descriptions.
   */
  describe('runtime description (setDescription)', () => {
    beforeEach(() => {
      seo.applyRouteSeo({
        title: 'Blog — MyCarsHub',
        urlPath: '/blog/como-cobrar-aluguel',
        seo: { description: 'Artigo do blog MyCarsHub.' },
      });
    });

    it('overwrites description, og:description and twitter:description together', () => {
      seo.setDescription('Como automatizar a cobrança do aluguel sem perder o controle.');

      const expected = 'Como automatizar a cobrança do aluguel sem perder o controle.';
      expect(meta('meta[name="description"]')).toBe(expected);
      expect(meta('meta[property="og:description"]')).toBe(expected);
      expect(meta('meta[name="twitter:description"]')).toBe(expected);
    });

    it('keeps the route description when the post has none', () => {
      seo.setDescription('   ');

      expect(meta('meta[name="description"]')).toBe('Artigo do blog MyCarsHub.');
    });

    it('clamps a long excerpt at a word boundary', () => {
      seo.setDescription(`${'palavra '.repeat(40)}fim`);

      const applied = meta('meta[name="description"]') ?? '';
      expect(applied.length).toBeLessThanOrEqual(160);
      expect(applied.endsWith('…')).toBe(true);
      expect(applied).not.toContain('palav…');
    });

    it('collapses whitespace coming from the editor', () => {
      seo.setDescription('  duas   linhas\n  de  texto  ');

      expect(meta('meta[name="description"]')).toBe('duas linhas de texto');
    });
  });

  describe('JSON-LD', () => {
    function block(id: string): HTMLScriptElement | null {
      return doc.head.querySelector<HTMLScriptElement>(`script[data-seo-jsonld="${id}"]`);
    }

    it('writes a parseable application/ld+json script', () => {
      seo.setJsonLd('organization', { '@type': 'Organization', name: 'MyCarsHub' });

      const el = block('organization');
      expect(el?.getAttribute('type')).toBe('application/ld+json');
      expect(JSON.parse(el?.textContent ?? '')).toEqual({
        '@type': 'Organization',
        name: 'MyCarsHub',
      });
    });

    it('replaces rather than duplicates when written twice under the same id', () => {
      seo.setJsonLd('pricing', { price: 1 });
      seo.setJsonLd('pricing', { price: 2 });

      expect(doc.head.querySelectorAll('script[data-seo-jsonld="pricing"]').length).toBe(1);
      expect(JSON.parse(block('pricing')?.textContent ?? '')).toEqual({ price: 2 });
    });

    it('escapes "<" so embedded markup cannot close the script tag', () => {
      seo.setJsonLd('x', { name: '</script><img src=x>' });

      expect(block('x')?.textContent).not.toContain('</script>');
      expect(JSON.parse(block('x')?.textContent ?? '')).toEqual({
        name: '</script><img src=x>',
      });
    });

    it('removes the block on request', () => {
      seo.setJsonLd('organization', { a: 1 });
      seo.removeJsonLd('organization');

      expect(block('organization')).toBeNull();
    });
  });
});
