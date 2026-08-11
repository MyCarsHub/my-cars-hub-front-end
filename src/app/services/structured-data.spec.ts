import { describe, it, expect } from 'vitest';

import { SITE_ORIGIN } from './seo.service';
import { absoluteUrl, breadcrumbListJsonLd } from './structured-data';

interface ListItem {
  readonly '@type': string;
  readonly position: number;
  readonly name: string;
  readonly item: string;
}

function items(node: unknown): readonly ListItem[] {
  return (node as { itemListElement: readonly ListItem[] }).itemListElement;
}

describe('breadcrumbListJsonLd', () => {
  const trail = [
    { name: 'Início', path: '/' },
    { name: 'Blog', path: '/blog' },
    { name: 'Como cobrar aluguel', path: '/blog/como-cobrar-aluguel' },
  ];

  it('numbers the hops from 1 and keeps the declared order', () => {
    const node = breadcrumbListJsonLd(trail) as Record<string, unknown>;

    expect(node['@type']).toBe('BreadcrumbList');
    expect(items(node).map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items(node).map((i) => i.name)).toEqual([
      'Início',
      'Blog',
      'Como cobrar aluguel',
    ]);
  });

  it('makes every item an absolute URL on the canonical origin', () => {
    for (const item of items(breadcrumbListJsonLd(trail))) {
      expect(item['@type']).toBe('ListItem');
      expect(item.item.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
    }
  });

  /** The block must be addressable per URL, or two pages would collide on one `@id`. */
  it('keys the block on the last hop, which is the page itself', () => {
    const node = breadcrumbListJsonLd(trail) as Record<string, unknown>;

    expect(node['@id']).toBe(`${SITE_ORIGIN}/blog/como-cobrar-aluguel#breadcrumb`);
  });

  it('builds a two-hop trail for a legal page', () => {
    const node = breadcrumbListJsonLd([
      { name: 'Início', path: '/' },
      { name: 'Termos de Uso', path: '/termos-de-uso' },
    ]);

    expect(items(node)).toHaveLength(2);
    expect(items(node)[1].item).toBe(`${SITE_ORIGIN}/termos-de-uso`);
  });
});

describe('absoluteUrl', () => {
  it('prefixes a site-relative path with the canonical origin', () => {
    expect(absoluteUrl('/blog')).toBe(`${SITE_ORIGIN}/blog`);
    expect(absoluteUrl('blog')).toBe(`${SITE_ORIGIN}/blog`);
  });

  it('strips query and hash so a canonical never carries them', () => {
    expect(absoluteUrl('/termos-de-uso?lang=en#topo')).toBe(`${SITE_ORIGIN}/termos-de-uso`);
  });

  /** Blog covers can already be absolute CDN URLs — re-prefixing them would break them. */
  it('passes an absolute URL through untouched', () => {
    expect(absoluteUrl('https://cdn.example.com/capa.png')).toBe(
      'https://cdn.example.com/capa.png',
    );
  });
});
