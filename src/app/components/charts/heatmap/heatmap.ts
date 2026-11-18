import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** One row of the grid (a weekday, a vehicle...): one value per column; `null` = not measured. */
export interface HeatmapRow {
  readonly key: string;
  readonly label: string;
  readonly values: readonly (number | null)[];
}

/** A labelled mark under the grid: `index` is the column it sits on. */
export interface HeatmapTick {
  readonly index: number;
  readonly text: string;
}

interface RenderedCell {
  readonly key: string;
  /** 0..1 share of the largest value; null for a cell that was not measured. */
  readonly level: number | null;
  readonly title: string;
}

interface RenderedRow {
  readonly key: string;
  readonly label: string;
  readonly cells: readonly RenderedCell[];
}

/** Faintest tint a measured non-zero cell gets, so "a little" never looks like "nothing". */
export const HEATMAP_MIN_LEVEL = 0.12;

/**
 * Pure: the tint of a cell, 0..1. Zero stays zero (the empty tile), any positive value gets at
 * least {@link HEATMAP_MIN_LEVEL}, and the largest value is 1. `null` (not measured) stays null.
 */
export function heatLevel(value: number | null, max: number): number | null {
  if (value === null || value === undefined) return null;
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(1, Math.max(HEATMAP_MIN_LEVEL, value / max));
}

/**
 * Grid of tiles whose tint is the value (weekday x hour of activity, for instance). Divs, not a
 * canvas: crisp at 375px, tiny DOM. The tint is DATA, not an action, so it is the neutral
 * foreground colour by default and never the brand orange. The numbers live in a screen-reader
 * table (a colour carries no number), and an unmeasured cell is drawn hollow, never as zero.
 */
@Component({
  selector: 'app-heatmap',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <div class="flex flex-col gap-1 min-w-0" aria-hidden="true" data-heatmap>
      @for (row of rendered(); track row.key; let r = $index) {
        <div data-heat-row class="flex items-center gap-1 min-w-0">
          <span class="w-8 shrink-0 text-[10px] sm:text-[11px] text-fg-muted">{{ row.label }}</span>
          @for (cell of row.cells; track cell.key) {
            <span
              data-heat-cell
              class="fade-in flex-1 min-w-0 rounded-[4px]"
              [style.height.px]="cellHeight()"
              [style.animation-delay.ms]="r * 30"
              [style.background-color]="cellColor(cell.level)"
              [style.box-shadow]="cell.level === null ? 'inset 0 0 0 1px var(--color-edge)' : null"
              [attr.title]="cell.title"
            ></span>
          }
        </div>
      }
      @if (ticks().length) {
        <div data-heat-ticks class="relative h-4 ml-9 text-[10px] sm:text-[11px] text-fg-muted">
          @for (t of positionedTicks(); track t.index) {
            <span class="absolute whitespace-nowrap" [style.left.%]="t.left" [style.transform]="t.shift">{{ t.text }}</span>
          }
        </div>
      }
    </div>

    <table class="sr-only">
      <caption>{{ ariaLabel() }}</caption>
      <thead>
        <tr>
          <th scope="col">{{ rowHeader() }}</th>
          @for (c of columns(); track $index) {
            <th scope="col">{{ c }}</th>
          }
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.key) {
          <tr>
            <th scope="row">{{ row.label }}</th>
            @for (v of row.values; track $index) {
              <td>{{ v === null ? 'sem dado' : v }}</td>
            }
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class Heatmap {
  readonly rows = input.required<readonly HeatmapRow[]>();
  /** Column names, for the screen-reader table and the tile tooltip (`08h-10h`). */
  readonly columns = input.required<readonly string[]>();
  readonly ariaLabel = input.required<string>();
  /** Header of the row names in the screen-reader table. */
  readonly rowHeader = input('Dia');
  /** Unit after the number in the tooltip (`12 ações`). */
  readonly unit = input('');
  /** Marks under the grid; empty hides the axis. */
  readonly ticks = input<readonly HeatmapTick[]>([]);
  readonly cellHeight = input(16);
  /** Tint colour (any CSS colour). Data, not action: neutral by default. */
  readonly color = input('var(--color-fg)');

  private readonly max = computed(() =>
    Math.max(0, ...this.rows().flatMap((r) => r.values.map((v) => (v === null ? 0 : v)))),
  );

  protected readonly rendered = computed<RenderedRow[]>(() => {
    const max = this.max();
    const cols = this.columns();
    const unit = this.unit();
    return this.rows().map((row) => ({
      key: row.key,
      label: row.label,
      cells: row.values.map((v, i) => ({
        key: `${row.key}-${i}`,
        level: heatLevel(v, max),
        title: `${row.label} ${cols[i] ?? ''}: ${v === null ? 'sem dado' : `${v}${unit ? ' ' + unit : ''}`}`,
      })),
    }));
  });

  protected readonly positionedTicks = computed(() => {
    const n = Math.max(1, this.columns().length);
    return this.ticks().map((t) => ({
      index: t.index,
      text: t.text,
      // Centre of the column; edges hang inward so the label never leaves the card.
      left: ((t.index + 0.5) / n) * 100,
      shift: t.index === 0 ? 'translateX(-25%)' : t.index >= n - 1 ? 'translateX(-75%)' : 'translateX(-50%)',
    }));
  });

  protected cellColor(level: number | null): string {
    if (level === null) return 'transparent';
    if (level === 0) return 'var(--color-surface-sunken)';
    return `color-mix(in srgb, ${this.color()} ${Math.round(level * 85)}%, transparent)`;
  }
}
