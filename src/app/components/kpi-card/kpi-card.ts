import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The four looks of the Dashboard KPI strip. Nothing else exists: no new colour, no new radius. */
export type KpiCardVariant = 'primary' | 'emerald' | 'emerald-dark' | 'white';

interface KpiCardLook {
  /** Card surface, radius and padding. */
  card: string;
  label: string;
  value: string;
  detail: string;
  skeleton: string;
}

/*
 * Whole class strings, spelled out: Tailwind finds a utility by scanning the source for it,
 * so a name assembled at runtime would silently never be generated.
 */
const LOOKS: Record<KpiCardVariant, KpiCardLook> = {
  primary: {
    card: 'block min-w-0 rounded-2xl bg-primary-500 text-white p-4',
    label: 'text-[11px] sm:text-xs text-white/70 uppercase tracking-wide truncate',
    value: 'text-xl sm:text-2xl font-semibold text-white mt-1 tabular-nums truncate',
    detail: 'text-[11px] sm:text-xs text-white/70 mt-1 truncate',
    skeleton: 'h-8 mt-2 w-16 rounded bg-white/20 animate-pulse',
  },
  emerald: {
    card: 'block min-w-0 rounded-2xl bg-emerald-600 text-white p-4',
    label: 'text-[11px] sm:text-xs text-white/70 uppercase tracking-wide truncate',
    value: 'text-xl sm:text-2xl font-semibold text-white mt-1 tabular-nums truncate',
    detail: 'text-[11px] sm:text-xs text-white/70 mt-1 truncate',
    skeleton: 'h-8 mt-2 w-16 rounded bg-white/20 animate-pulse',
  },
  'emerald-dark': {
    card: 'block min-w-0 rounded-2xl bg-emerald-700 text-white p-4',
    label: 'text-[11px] sm:text-xs text-white/70 uppercase tracking-wide truncate',
    value: 'text-xl sm:text-2xl font-semibold text-white mt-1 tabular-nums truncate',
    detail: 'text-[11px] sm:text-xs text-white/70 mt-1 truncate',
    skeleton: 'h-8 mt-2 w-16 rounded bg-white/20 animate-pulse',
  },
  white: {
    card: 'block min-w-0 rounded-2xl bg-white border border-gray-200 p-4',
    label: 'text-[11px] sm:text-xs text-gray-500 uppercase tracking-wide truncate',
    value: 'text-xl sm:text-2xl font-semibold text-gray-900 mt-1 tabular-nums truncate',
    detail: 'text-[11px] sm:text-xs text-gray-500 mt-1 truncate',
    skeleton: 'h-8 mt-2 w-16 rounded bg-gray-100 animate-pulse',
  },
};

/**
 * One KPI of a strip: small uppercase label, big number, small caption. The single source of
 * the Dashboard's KPI look — the Dashboard and the Members page both render it, so a colour
 * or radius changes in one place.
 *
 * The host IS the card (`<div app-kpi-card ...>`), so it stays a direct grid child and a
 * `div`, like the hand-written cards it replaces. Lay the strip out in the page
 * (`grid gap-3 grid-cols-2 lg:grid-cols-N`); the card owns only its own surface.
 *
 * `value` and `detail` are text. `null` renders nothing, which is what a card that has no
 * number yet (or whose source failed) shows: the label alone.
 */
@Component({
  selector: 'div[app-kpi-card]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'look().card' },
  template: `
    <p [class]="look().label">{{ label() }}</p>
    @if (loading()) {
      <div [class]="look().skeleton"></div>
    } @else {
      @if (value() !== null) {
        <p [class]="look().value">{{ value() }}</p>
      }
      @if (detail() !== null) {
        <p data-kpi-detail [class]="look().detail">{{ detail() }}</p>
      }
    }
  `,
})
export class KpiCard {
  readonly variant = input<KpiCardVariant>('white');
  readonly label = input.required<string>();
  readonly value = input<string | number | null>(null);
  readonly detail = input<string | null>(null);
  /** Shows a bar where the number goes, keeping the label: the card never changes height. */
  readonly loading = input(false);

  protected readonly look = computed(() => LOOKS[this.variant()]);
}
