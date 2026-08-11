import { describe, it, expect } from 'vitest';

import { SITE_ORIGIN } from '../../services/seo.service';
import { BlogPostDetail } from '../../types/blog.types';
import { blogPostingJsonLd } from './blog-structured-data';

/** A fully populated post — every optional field present. */
const FULL: BlogPostDetail = {
  id: 'p-1',
  slug: 'como-cobrar-aluguel',
  title: 'Como cobrar aluguel sem correr atrás',
  excerpt: 'Um resumo curto do post.',
  coverUrl: '/png/capa.png',
  category: 'COBRANCAS',
  status: 'PUBLISHED',
  publishedAt: '2026-07-02T10:00:00Z',
  createdDate: '2026-06-30T09:00:00Z',
  readingMinutes: 7,
  modifyDate: '2026-07-10T12:00:00Z',
  authorId: 'a3f1c2d4-0000-0000-0000-000000000000',
  bodyMarkdown: '# Título',
  bodyHtml: '<h1>Título</h1>',
  metaDescription: 'A meta description de verdade do post.',
};

function node(post: BlogPostDetail): Record<string, unknown> {
  return blogPostingJsonLd(post) as Record<string, unknown>;
}

describe('blogPostingJsonLd', () => {
  it('carries the post fields the page renders', () => {
    const post = node(FULL);

    expect(post['@type']).toBe('BlogPosting');
    expect(post['headline']).toBe(FULL.title);
    expect(post['datePublished']).toBe(FULL.publishedAt);
    expect(post['dateModified']).toBe(FULL.modifyDate);
    expect(post['description']).toBe(FULL.metaDescription);
    expect(post['articleSection']).toBe('Cobranças');
    expect(post['timeRequired']).toBe('PT7M');
    expect(post['inLanguage']).toBe('pt-BR');
  });

  it('anchors the post to its own canonical URL', () => {
    const url = `${SITE_ORIGIN}/blog/${FULL.slug}`;
    const post = node(FULL);

    expect(post['url']).toBe(url);
    expect(post['@id']).toBe(`${url}#post`);
    expect(post['mainEntityOfPage']).toEqual({ '@type': 'WebPage', '@id': url });
  });

  it('absolutizes a site-relative cover and keeps an external one as-is', () => {
    expect(node(FULL)['image']).toBe(`${SITE_ORIGIN}/png/capa.png`);
    expect(node({ ...FULL, coverUrl: 'https://cdn.example.com/c.png' })['image']).toBe(
      'https://cdn.example.com/c.png',
    );
  });

  /**
   * O ponto inteiro do módulo: campo que a API devolve nulo é OMITIDO, nunca preenchido
   * com um default. Uma `datePublished` errada contradiz a data visível na página.
   */
  it('omits every field the API did not provide', () => {
    const post = node({
      ...FULL,
      excerpt: null,
      coverUrl: null,
      publishedAt: null,
      modifyDate: null,
      metaDescription: null,
      readingMinutes: 0,
    });

    for (const key of [
      'description',
      'image',
      'datePublished',
      'dateModified',
      'timeRequired',
    ]) {
      expect(post[key], `${key} deveria ter sido omitido`).toBeUndefined();
    }
    // O que não depende da API continua lá.
    expect(post['headline']).toBe(FULL.title);
  });

  it('falls back to the excerpt when the post has no metaDescription', () => {
    expect(node({ ...FULL, metaDescription: null })['description']).toBe(FULL.excerpt);
  });

  /** `dateModified` sem `datePublished` descreve um rascunho, não um artigo publicado. */
  it('never emits dateModified for a post that was never published', () => {
    expect(node({ ...FULL, publishedAt: null })['dateModified']).toBeUndefined();
  });

  /**
   * `authorId` é um UUID e a página não mostra byline nenhuma. Um Person inventado a
   * partir do id seria exatamente o dado falso que o Google penaliza.
   */
  it('attributes the post to the Organization, never to a fabricated Person', () => {
    const author = node(FULL)['author'] as Record<string, unknown>;

    expect(author['@type']).toBe('Organization');
    expect(author['@id']).toBe(`${SITE_ORIGIN}/#organization`);
    expect(JSON.stringify(node(FULL))).not.toContain(FULL.authorId);
  });

  it('points publisher at the canonical Organization node', () => {
    expect(node(FULL)['publisher']).toEqual({ '@id': `${SITE_ORIGIN}/#organization` });
  });
});
