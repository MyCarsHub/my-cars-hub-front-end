import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatKpiNumber, type KpiNumberFormat } from '../../kpi-card/kpi-card';
import { barPct } from '../bar-chart/bar-chart';

/** One coloured part of a row. `color` is any CSS colour (token var or hex). */
export interface StackSegment {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

export interface StackRow {
  readonly label: string;
  readonly hint?: string;
  readonly segments: readonly StackSegment[];
}

interface RenderedSegment extends StackSegment {
  readonly pct: number;
  readonly text: string;
}

interface RenderedRow {
  readonly label: string;
  readonly hint: string | null;
  readonly totalText: string;
  readonly segments: readonly RenderedSegment[];
  readonly summary: string;
}

interface LegendItem {
  readonly key: string;
  readonly label: string;
  readonly color: string;
}

/**
 * Stacked horizontal bars: each row is one bar split into coloured parts, all rows on the
 * same scale (the largest row total is 100%). Same row layout and scale rule as `app-bar-chart`
 * (`barPct`), so a stacked and a plain bar read the same. Divs and widths, not canvas: crisp at
 * any width, tiny DOM, and the numbers are real text for screen readers.
 */
@Component({
  selector: 'app-stacked-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <div class="space-y-3 min-w-0">
      @for (row of renderedRows(); track row.label) {
        <div class="min-w-0" role="group" [attr.aria-label]="row.label + ': ' + row.summary">
          <div class="flex justify-between items-baseline gap-2 text-xs mb-1 min-w-0">
            <span class="text-fg-soft truncate min-w-0">{{ row.label }}</span>
            <span class="text-fg font-medium tabular-nums shrink-0">{{ row.totalText }}</span>
          </div>
          @if (row.hint) {
            <p class="text-[10px] text-fg-subtle mb-1 truncate">{{ row.hint }}</p>
          }
          <div class="flex h-2.5 gap-0.5 rounded-full bg-surface-sunken overflow-hidden" aria-hidden="true">
            @for (seg of row.segments; track seg.key) {
              <div
                data-segment
                class="h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-500 motion-reduce:transition-none"
                [style.width.%]="seg.pct"
                [style.background-color]="seg.color"
              ></div>
            }
          </div>
        </div>
      } @empty {
        <p class="text-sm text-fg-subtle text-center py-6">Sem dados no período.</p>
      }
    </div>
    @if (legend().length) {
      <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted" aria-label="Legenda">
        @for (item of legend(); track item.key) {
          <li class="inline-flex items-center gap-1.5">
            <span class="size-2.5 rounded-[3px] shrink-0" aria-hidden="true" [style.background-color]="item.color"></span>
            {{ item.label }}
          </li>
        }
      </ul>
    }
  `,
})
export class StackedBarChart {
  readonly rows = input.required<readonly StackRow[]>();
  /** How a value becomes text; default counts. */
  readonly valueFormat = input<KpiNumberFormat>('integer');

  protected readonly renderedRows = computed(() => this.render());

  private render(): RenderedRow[] {
    const fmt = this.valueFormat();
    const totals = this.rows().map((r) => r.segments.reduce((s, x) => s + Math.max(0, x.value), 0));
    const max = Math.max(0, ...totals);
    return this.rows().map((r, i) => {
      const segments = r.segments.map((s) => ({
        ...s,
        pct: barPct(s.value, max),
        text: formatKpiNumber(fmt, s.value),
      }));
      return {
        label: r.label,
        hint: r.hint ?? null,
        totalText: formatKpiNumber(fmt, totals[i]),
        segments,
        summary: segments.map((s) => `${s.label} ${s.text}`).join(', '),
      };
    });
  }

  protected readonly legend = computed<LegendItem[]>(() => {
    const seen = new Map<string, LegendItem>();
    for (const row of this.rows()) {
      for (const s of row.segments) {
        if (!seen.has(s.key)) seen.set(s.key, { key: s.key, label: s.label, color: s.color });
      }
    }
    return [...seen.values()];
  });
}
