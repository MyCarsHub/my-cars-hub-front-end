import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { formatKpiNumber } from '../../kpi-card/kpi-card';
import { ChartTooltip, type ChartTooltipRow } from '../chart-tooltip/chart-tooltip';

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
  /** Column name (`08h-10h`). */
  readonly column: string;
  /** Value with its unit, or "sem dado". */
  readonly text: string;
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
 *
 * Reading a tile: hover or tap opens a tooltip (row, column, value with unit); the grid is one
 * keyboard stop whose arrows walk the tiles (Home/End along the row, Esc closes) and announce
 * each one politely. Rows fade in one after the other (none under reduced motion).
 */
@Component({
  selector: 'app-heatmap',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartTooltip],
  host: { class: 'block min-w-0' },
  template: `
    <div
      class="flex flex-col gap-1 min-w-0 rounded-lg touch-pan-y select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-fg-subtle focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      data-heatmap
      tabindex="0"
      role="group"
      [attr.aria-label]="ariaLabel() + '. Setas para ler cada faixa.'"
      (pointermove)="onPointer($event)"
      (pointerdown)="onPointer($event)"
      (pointerleave)="onPointerLeave($event)"
      (keydown)="onKey($event)"
      (focus)="onFocus()"
      (blur)="active.set(null)"
    >
      @for (row of rendered(); track row.key; let r = $index) {
        <div data-heat-row class="flex items-center gap-1 min-w-0" aria-hidden="true">
          <span class="w-8 shrink-0 text-[10px] sm:text-[11px] text-fg-muted" [class.text-fg]="active()?.r === r" [class.font-semibold]="active()?.r === r">{{ row.label }}</span>
          <div class="relative flex-1 min-w-0 flex items-center gap-1">
            @for (cell of row.cells; track cell.key; let c = $index) {
              <span
                data-heat-cell
                class="fade-in flex-1 min-w-0 rounded-[4px] transition-[outline-color] duration-150"
                [attr.data-r]="r"
                [attr.data-c]="c"
                [style.height.px]="cellHeight()"
                [style.animation-delay.ms]="r * 30"
                [style.background-color]="cellColor(cell.level)"
                [style.box-shadow]="cell.level === null ? 'inset 0 0 0 1px var(--color-edge)' : null"
                [style.outline]="active()?.r === r && active()?.c === c ? '2px solid var(--color-fg)' : null"
                [style.outline-offset.px]="1"
              ></span>
            }
            @if (tip(); as t) {
              @if (t.r === r) {
                <app-chart-tooltip [title]="t.title" [rows]="t.rows" [x]="t.x" [y]="t.below ? 100 : 0" [below]="t.below" />
              }
            }
          </div>
        </div>
      }
      @if (ticks().length) {
        <div data-heat-ticks class="relative h-4 ml-9 text-[10px] sm:text-[11px] text-fg-muted" aria-hidden="true">
          @for (t of positionedTicks(); track t.index) {
            <span class="absolute whitespace-nowrap" [style.left.%]="t.left" [style.transform]="t.shift">{{ t.text }}</span>
          }
        </div>
      }
    </div>

    <p class="sr-only" aria-live="polite" data-heat-live>{{ spoken() }}</p>

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
              <td>{{ v === null ? 'sem dado' : valueText(v) }}</td>
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
  /** Text of a value (tooltip, reading, table). Default: pt-BR integer, without the unit in the table. */
  readonly formatValue = input<((v: number) => string) | null>(null);

  /** Tile being read (hover, tap, keyboard); null = none. */
  protected readonly active = signal<{ r: number; c: number } | null>(null);
  /** Last tile reached by keyboard, for the polite announcement (pointer readings stay silent). */
  protected readonly spoken = signal('');

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
        column: cols[i] ?? '',
        text: v === null || v === undefined ? 'sem dado' : `${this.valueText(v)}${unit ? ' ' + unit : ''}`,
      })),
    }));
  });

  protected valueText(v: number): string {
    const custom = this.formatValue();
    return custom ? custom(v) : formatKpiNumber('integer', v);
  }

  /** Pure-ish: "Seg 08h-10h: 12 ações". */
  protected cellReading(r: number, c: number): string {
    const row = this.rendered()[r];
    const cell = row?.cells[c];
    return row && cell ? `${row.label} ${cell.column}: ${cell.text}` : '';
  }

  protected readonly tip = computed(() => {
    const a = this.active();
    const row = a ? this.rendered()[a.r] : null;
    const cell = a && row ? row.cells[a.c] : null;
    if (!a || !row || !cell) return null;
    const n = Math.max(1, row.cells.length);
    const rows: ChartTooltipRow[] = [{ key: cell.key, label: cell.column, value: cell.text }];
    // The top two rows open the box downwards so it stays inside the card.
    return { r: a.r, x: ((a.c + 0.5) / n) * 100, below: a.r < 2, title: row.label, rows };
  });

  protected onPointer(event: PointerEvent): void {
    const target = event.target as Element | null;
    const tile = target?.closest?.('[data-heat-cell]');
    if (!tile) return;
    const r = Number(tile.getAttribute('data-r'));
    const c = Number(tile.getAttribute('data-c'));
    if (Number.isInteger(r) && Number.isInteger(c)) this.active.set({ r, c });
  }

  /** A mouse leaving closes the reading; a finger lifting keeps it (it was a tap). */
  protected onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'mouse') this.active.set(null);
  }

  protected onFocus(): void {
    if (this.active() === null && this.rendered().length) this.move({ r: 0, c: 0 });
  }

  private move(next: { r: number; c: number }): void {
    this.active.set(next);
    this.spoken.set(this.cellReading(next.r, next.c));
  }

  protected onKey(event: KeyboardEvent): void {
    const rows = this.rendered();
    if (!rows.length) return;
    if (event.key === 'Escape') {
      this.active.set(null);
      return;
    }
    const at = this.active() ?? { r: 0, c: 0 };
    const lastR = rows.length - 1;
    const lastC = Math.max(0, (rows[at.r]?.cells.length ?? 1) - 1);
    const next =
      event.key === 'ArrowRight' ? { r: at.r, c: Math.min(lastC, at.c + 1) }
      : event.key === 'ArrowLeft' ? { r: at.r, c: Math.max(0, at.c - 1) }
      : event.key === 'ArrowDown' ? { r: Math.min(lastR, at.r + 1), c: at.c }
      : event.key === 'ArrowUp' ? { r: Math.max(0, at.r - 1), c: at.c }
      : event.key === 'Home' ? { r: at.r, c: 0 }
      : event.key === 'End' ? { r: at.r, c: lastC }
      : null;
    if (!next) return;
    event.preventDefault();
    this.move(next);
  }

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
