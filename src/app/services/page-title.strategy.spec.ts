import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, it, expect, beforeEach } from 'vitest';

import { PageTitleStrategy } from './page-title.strategy';

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
        ]),
        { provide: TitleStrategy, useClass: PageTitleStrategy },
      ],
    });
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
});
