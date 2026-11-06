import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { RingLegendCard, RingSlice, ringGradient } from './ring-legend-card';

const SLICES: RingSlice[] = [
  { label: 'Ativos', value: 21, color: '#0a9b62' },
  { label: 'Reservados', value: 3, color: '#3b82f6' },
  { label: 'Cancelados', value: 0, color: '#fb7185' },
];

function render(slices: RingSlice[]) {
  const fixture = TestBed.createComponent(RingLegendCard);
  fixture.componentRef.setInput('title', 'Aluguéis por status');
  fixture.componentRef.setInput('slices', slices);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ringGradient', () => {
  it('skips empty slices and leaves a gap after each live one', () => {
    const g = ringGradient(SLICES, '#fff');
    expect(g).toBe(
      'conic-gradient(#0a9b62 0.0deg 312.0deg, #fff 312.0deg 315.0deg, #3b82f6 315.0deg 357.0deg, #fff 357.0deg 360.0deg)',
    );
    expect(g).not.toContain('#fb7185');
  });

  it('a single live slice fills the whole circle', () => {
    expect(ringGradient([SLICES[0], SLICES[2]], '#fff')).toBe(
      'conic-gradient(#0a9b62 0deg 360deg)',
    );
  });

  it('no data paints only the gap colour', () => {
    expect(ringGradient([], '#fff')).toBe('conic-gradient(#fff 0deg 360deg)');
  });
});

describe('RingLegendCard', () => {
  it('shows value and percent for every slice, as text', () => {
    const rows = render(SLICES).querySelectorAll('[data-legend-row]');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Ativos');
    expect(rows[0].textContent).toContain('21');
    expect(rows[0].textContent).toContain('88%');
    expect(rows[2].textContent).toContain('0%');
  });

  it('shows the total in the middle and describes the ring for assistive tech', () => {
    const el = render(SLICES);
    expect(el.querySelector('[data-ring]')!.textContent).toContain('24');
    expect(el.querySelector('[data-ring]')!.getAttribute('aria-label')).toBe(
      'Aluguéis por status: Ativos 21 (88%), Reservados 3 (13%), Cancelados 0 (0%)',
    );
  });

  it('shows the empty copy without slices', () => {
    expect(render([]).textContent).toContain('Sem dados no período.');
  });

  it('draws no divider lines between legend rows', () => {
    const html = render(SLICES).querySelector('ul')!.outerHTML;
    expect(html).not.toMatch(/divide-|border-b|border-t/);
  });
});
