import { ChangeDetectionStrategy, Component, DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, it, expect, beforeEach } from 'vitest';

import { PageTitleStrategy } from './page-title.strategy';
import { SITE_ORIGIN } from './seo.service';

@Component({
  selector: 'app-title-probe',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Probe {}

describe('PageTitleStrategy', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'bare', component: Probe },
          { path: 'labelled', component: Probe, data: { pageTitle: 'Relatórios' } },
          { path: 'router-title', component: Probe, title: 'Do Router' },
          {
            path: 'parent',
            data: { pageTitle: 'Veículos' },
            children: [{ path: 'child', component: Probe, data: { pageTitle: 'Novo veículo' } }],
          },
          {
            path: 'publica',
            component: Probe,
            data: { pageTitle: 'Pública', seo: { description: 'Descrição da pública.' } },
          },
        ]),
        { provide: TitleStrategy, useClass: PageTitleStrategy },
      ],
    });
    TestBed.inject(DOCUMENT)
      .head.querySelectorAll('link[rel="canonical"]')
      .forEach((el) => el.remove());
  });

  async function titleAt(url: string): Promise<string> {
    await RouterTestingHarness.create(url);
    return TestBed.inject(Title).getTitle();
  }

  it('appends the brand to data.pageTitle', async () => {
    expect(await titleAt('/labelled')).toBe('Relatórios — MyCarsHub');
  });

  it('uses the deepest primary route pageTitle', async () => {
    expect(await titleAt('/parent/child')).toBe('Novo veículo — MyCarsHub');
  });

  it('still honours the router-native title property', async () => {
    expect(await titleAt('/router-title')).toBe('Do Router — MyCarsHub');
  });

  it('falls back to the brand alone when a route carries no title', async () => {
    expect(await titleAt('/bare')).toBe('MyCarsHub');
  });

  function headMeta(selector: string): string | null {
    return TestBed.inject(DOCUMENT).head.querySelector(selector)?.getAttribute('content') ?? null;
  }

  it('drives the SEO head tags for a route that declares data.seo', async () => {
    await titleAt('/publica');

    expect(headMeta('meta[name="description"]')).toBe('Descrição da pública.');
    expect(headMeta('meta[name="robots"]')).toBe('index, follow');
    expect(headMeta('meta[property="og:title"]')).toBe('Pública — MyCarsHub');
    expect(
      TestBed.inject(DOCUMENT).head.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    ).toBe(`${SITE_ORIGIN}/publica`);
  });

  it('marks a route without data.seo as noindex — the authenticated app must not be indexed', async () => {
    await titleAt('/labelled');

    expect(headMeta('meta[name="robots"]')).toBe('noindex, nofollow');
    expect(TestBed.inject(DOCUMENT).head.querySelector('link[rel="canonical"]')).toBeNull();
  });
});
