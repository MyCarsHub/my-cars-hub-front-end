import { Component } from '@angular/core';
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

describe('RingLegendCard header', () => {
  it('the title is one truncated line, so the four cards of a row keep aligned headers', () => {
    const h2 = render(SLICES).querySelector('h2')!;
    expect(h2.className).toContain('truncate');
    expect(h2.getAttribute('title')).toBeTruthy();
  });
});

/** The admin home puts three of these in a `lg:grid-cols-3` row: each card is ~287px wide. */
@Component({
  imports: [RingLegendCard],
  template: `<div style="width: 287px">
    <app-ring-legend-card title="Aluguéis por status" totalLabel="aluguéis" [slices]="slices" />
  </div>`,
})
class NarrowHost {
  readonly slices: RingSlice[] = [
    { label: 'Ativa', value: 12, color: '#0a9b62' },
    { label: 'Reservado', value: 2, color: '#3b82f6' },
    { label: 'Inadimplente', value: 1, color: '#fb7185' },
  ];
}

describe('RingLegendCard in a narrow (~287px) card', () => {
  // jsdom has no layout engine, so the spec pins the CSS contract that makes the layout follow
  // the CARD's width: a size container around the body, a stacked default and the side-by-side
  // row only behind a container-size variant, and legend labels kept on one line.
  function narrow(): HTMLElement {
    const fixture = TestBed.createComponent(NarrowHost);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('decides the layout by the card width: the body sits inside a size container', () => {
    const body = narrow().querySelector('[data-ring-body]')!;
    expect(body).toBeTruthy();
    expect(body.parentElement!.classList).toContain('@container');
  });

  it('stacks by default (ring on top, legend below) and only goes side by side at a container size', () => {
    const body = narrow().querySelector('[data-ring-body]')!;
    const classes = Array.from(body.classList);
    expect(classes).toContain('flex-col');
    expect(classes).not.toContain('flex-row');
    expect(classes.some((c) => /^@\[[\d.]+rem\]:flex-row$/.test(c))).toBe(true);
    // the ring comes first, so stacked means "ring on top"
    expect(body.firstElementChild!.hasAttribute('data-ring')).toBe(true);
  });

  it('goes side by side only where the label column still gets real room', () => {
    // Measured in production: a full-width card on a 375px phone has ~311px of content and the
    // "Custos por fornecedor" card on desktop ~326px; side by side both cut every label. The
    // largest phones (430px) give ~366px. Beside the ring the row spends ~271px on fixed columns
    // (ring 128 + gap 20 + swatch 20 + gap 12 + percent and a money value ~91), and a label needs
    // at least ~140px to show a status or vendor name whole.
    const classes = Array.from(narrow().querySelector('[data-ring-body]')!.classList);
    const sizes = classes
      .map((c) => /^@\[([\d.]+)rem\]:/.exec(c))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]) * 16);
    expect(sizes.length).toBeGreaterThan(0);
    expect(new Set(sizes).size).toBe(1); // flex-row and its gap switch at the same size
    const threshold = sizes[0];
    const LARGEST_PHONE_CONTENT_PX = 366;
    const FIXED_COLUMNS_PX = 271;
    const MIN_LABEL_PX = 140;
    expect(threshold).toBeGreaterThan(LARGEST_PHONE_CONTENT_PX);
    expect(threshold - FIXED_COLUMNS_PX).toBeGreaterThanOrEqual(MIN_LABEL_PX);
  });

  it('keeps each label on one line (ellipsis, full text in the title), never one letter a line', () => {
    const labels = Array.from(narrow().querySelectorAll('[data-legend-label]'));
    expect(labels).toHaveLength(3);
    for (const label of labels) {
      expect(label.classList).toContain('truncate');
      expect(label.classList).not.toContain('break-words');
      expect(label.getAttribute('title')).toBe(label.textContent!.trim());
    }
  });

  it('gives the label the free width of the row, so the percent never sits on the swatch', () => {
    const row = narrow().querySelector('[data-legend-row]')!;
    const [left, right] = Array.from(row.children);
    expect(left.classList).toContain('flex-1');
    expect(left.classList).toContain('min-w-0');
    expect(right.classList).toContain('shrink-0');
  });
});
