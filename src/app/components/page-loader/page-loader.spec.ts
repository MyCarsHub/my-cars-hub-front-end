import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PageLoader } from './page-loader';

describe('PageLoader', () => {
  let fixture: ComponentFixture<PageLoader>;
  const root = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(PageLoader);
    fixture.componentRef.setInput('title', 'Verificando seu convite…');
    fixture.componentRef.setInput('description', 'Só um instante enquanto confirmamos o link.');
    fixture.detectChanges();
  });

  it('renders the ring, the title as the page heading and the subtitle', () => {
    expect(root().querySelector('h1')?.textContent?.trim()).toBe('Verificando seu convite…');
    expect(root().querySelector('p')?.textContent?.trim()).toBe(
      'Só um instante enquanto confirmamos o link.',
    );
    expect(root().querySelectorAll('.rounded-full.border-4')).toHaveLength(2);
    expect(root().querySelector('.animate-spin')).not.toBeNull();
  });

  it('is a polite live status region and the ring is hidden from assistive tech', () => {
    const main = root().querySelector('main') as HTMLElement;
    expect(main.getAttribute('role')).toBe('status');
    expect(main.getAttribute('aria-live')).toBe('polite');
    expect(root().querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('fills the viewport by default and the shell content area when asked', () => {
    const main = () => root().querySelector('main') as HTMLElement;
    expect(main().classList.contains('min-h-screen')).toBe(true);

    fixture.componentRef.setInput('fullScreen', false);
    fixture.detectChanges();
    expect(main().classList.contains('min-h-screen')).toBe(false);
    expect(main().className).toContain('min-h-[70dvh]');
  });

  it('omits the subtitle when none is given', () => {
    fixture.componentRef.setInput('description', '');
    fixture.detectChanges();
    expect(root().querySelector('p')).toBeNull();
  });
});
