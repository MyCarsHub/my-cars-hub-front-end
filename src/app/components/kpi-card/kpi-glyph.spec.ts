import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { KpiGlyph, type KpiGlyphName } from './kpi-glyph';

const NAMES: KpiGlyphName[] = [
  'receipt', 'check', 'clock', 'alert', 'contract', 'coin', 'calendar', 'shield', 'car', 'user',
  'wrench', 'camera', 'x', 'key', 'swap',
];

@Component({
  imports: [KpiGlyph],
  template: `<app-kpi-glyph [name]="name()" />`,
})
class Host {
  name = signal<KpiGlyphName>('receipt');
}

describe('KpiGlyph', () => {
  it('draws something and stays decorative for every name', () => {
    const fixture = TestBed.createComponent(Host);
    for (const name of NAMES) {
      fixture.componentInstance.name.set(name);
      fixture.detectChanges();
      const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
      expect(svg.getAttribute('aria-hidden'), name).toBe('true');
      expect(svg.children.length, name).toBeGreaterThan(0);
    }
  });
});
