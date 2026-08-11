import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';

import { NotFound } from './not-found';

describe('NotFound', () => {
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotFound],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(NotFound);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  /** Exactly one `h1`, and it must say the page is missing — not "login". */
  it('states that the page was not found, in a single h1', () => {
    const headings = host.querySelectorAll('h1');

    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toContain('não foi encontrada');
  });

  /**
   * O motivo de a página existir: a URL quebrada tem de oferecer um caminho de volta
   * para conteúdo indexável, em vez de mandar o visitante para `/login`.
   */
  it('offers a way back to the indexable pages', () => {
    const targets = Array.from(host.querySelectorAll<HTMLAnchorElement>('main a')).map((a) =>
      a.getAttribute('href'),
    );

    expect(targets).toContain('/');
    expect(targets).toContain('/blog');
    expect(targets).not.toContain('/login');
  });

  it('leaves no dead link in the page body', () => {
    const anchors = Array.from(host.querySelectorAll<HTMLAnchorElement>('a'));

    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(anchor.getAttribute('href')).toBeTruthy();
      expect(anchor.getAttribute('href')).not.toBe('#');
    }
  });
});
