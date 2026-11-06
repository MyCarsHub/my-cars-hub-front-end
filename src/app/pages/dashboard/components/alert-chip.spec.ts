import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AlertChip } from './alert-chip';

describe('AlertChip', () => {
  function render(label: string, count = 3): HTMLElement {
    const fixture = TestBed.createComponent(AlertChip);
    fixture.componentRef.setInput('label', label);
    fixture.componentRef.setInput('count', count);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows exactly the count and the label, nothing else', () => {
    const host = render('cobranças vencidas');
    expect(host.textContent?.replace(/\s+/g, '')).toBe('3cobrançasvencidas');
  });

  it('can shrink inside a 320px row: no nowrap, the host and the button are capped to the row', () => {
    const host = render('documentos a vencer (7d) e outras pendências longas');
    const button = host.querySelector('button')!;
    expect(host.className).toContain('min-w-0');
    expect(host.className).toContain('max-w-full');
    expect(host.className).not.toContain('shrink-0');
    expect(button.className).toContain('max-w-full');
    expect(button.className).not.toContain('whitespace-nowrap');
  });
});
