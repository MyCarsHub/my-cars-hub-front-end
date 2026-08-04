import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, it, expect, beforeEach } from 'vitest';

import { PrivacyPolicyComponent } from './privacy-policy/privacy-policy.component';
import { TermsOfUseComponent } from './terms-of-use/terms-of-use.component';

/**
 * The PT/EN switch used to live in a component-local signal: the English version was not
 * shareable, not indexable, and a reload silently fell back to Portuguese. The language now
 * lives in `?lang` — these specs drive the real router so the URL is the source of truth.
 */
describe('legal pages · language ↔ URL sync', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'politica-de-privacidade', component: PrivacyPolicyComponent },
          { path: 'termos-de-uso', component: TermsOfUseComponent },
        ]),
      ],
    });
  });

  async function renderAt(url: string): Promise<RouterTestingHarness> {
    const harness = await RouterTestingHarness.create(url);
    harness.detectChanges();
    return harness;
  }

  function headingOf(harness: RouterTestingHarness): string {
    const host = harness.fixture.nativeElement as HTMLElement;
    return host.querySelector('h1')?.textContent?.trim() ?? '';
  }

  function langButton(harness: RouterTestingHarness, label: 'PT' | 'EN'): HTMLButtonElement {
    const host = harness.fixture.nativeElement as HTMLElement;
    const button = Array.from(host.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) throw new Error(`Language button "${label}" not found`);
    return button;
  }

  it('renders Portuguese when ?lang is absent', async () => {
    const harness = await renderAt('/politica-de-privacidade');

    expect(headingOf(harness)).toBe('Política de Privacidade');
    expect(document.documentElement.lang).toBe('pt');
  });

  it('renders English directly from ?lang=en (shareable / survives reload)', async () => {
    const harness = await renderAt('/politica-de-privacidade?lang=en');

    expect(headingOf(harness)).toBe('Privacy Policy');
    expect(document.documentElement.lang).toBe('en');
  });

  it('applies ?lang=en to the terms page as well', async () => {
    const harness = await renderAt('/termos-de-uso?lang=en');

    expect(headingOf(harness)).toBe('Terms of Use');
  });

  it('writes the language to the URL when the toggle is used', async () => {
    const harness = await renderAt('/politica-de-privacidade');

    langButton(harness, 'EN').click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/politica-de-privacidade?lang=en');
    expect(headingOf(harness)).toBe('Privacy Policy');
  });

  it('drops the param when switching back to Portuguese (canonical URL stays clean)', async () => {
    const harness = await renderAt('/politica-de-privacidade?lang=en');

    langButton(harness, 'PT').click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/politica-de-privacidade');
    expect(headingOf(harness)).toBe('Política de Privacidade');
  });
});
