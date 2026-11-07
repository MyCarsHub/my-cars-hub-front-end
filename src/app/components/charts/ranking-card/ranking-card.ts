import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PageCard } from '../../core/page-card/page-card';

export interface RankingItem {
  readonly id: string;
  readonly name: string;
  /** Second line (plate, vehicle...). */
  readonly sub?: string;
  /** Value already formatted as text by the caller (money, count...). */
  readonly value: string;
  /** Bars layout: the label above the bar when `value` is too long for a narrow column. */
  readonly short?: string;
  /** Bars layout: height basis (bars are drawn relative to the largest). */
  readonly amount?: number;
}

interface RankedRow extends RankingItem {
  readonly rank: number;
  readonly isHero: boolean;
  readonly initials: string;
  readonly heightPct: number;
}

/** Pure: up to two initials of a name (`Carlos Mendes` -> `CM`). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : (parts[0][1] ?? '');
  return (first + last).toUpperCase();
}

/** Pure: bar height as a share of the tallest (min 22% so the rank number always fits). */
function heightOf(it: RankingItem, all: readonly RankingItem[]): number {
  const max = Math.max(0, ...all.map((x) => x.amount ?? 0));
  if (max <= 0) return 100;
  return Math.max(22, Math.round(((it.amount ?? 0) / max) * 100));
}

/**
 * Top-N ranking. With `hero` the first row is a painted brand row (solid orange, white text);
 * the rest are quiet rows with a rank badge. Value is text from the caller, so money, counts
 * and percentages all fit. Shell is `app-page-card`.
 */
@Component({
  selector: 'app-ranking-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard],
  host: { class: 'block min-w-0 h-full' },
  template: `
    <app-page-card [title]="title()" [fill]="true" [truncateTitle]="!reserveTitle()" [reserveTitleLines]="reserveTitle()">
      <div class="px-4 sm:px-6 pb-5 min-w-0 flex-1">
        @if (subtitle()) {
          <p class="text-xs text-fg-muted mb-3">{{ subtitle() }}</p>
        }
        @if (layout() === 'bars') {
          @if (rows().length) {
            <ol data-rank-bars class="flex items-end gap-2 h-44 min-w-0">
              @for (row of rows(); track row.id; let i = $index) {
                <li data-rank-row class="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1.5">
                  <span class="text-[11px] font-semibold text-fg tabular-nums whitespace-nowrap">{{ row.short ?? row.value }}</span>
                  <span
                    class="bar-rise w-full rounded-t-xl rounded-b-md grid place-items-start justify-items-center pt-1.5 text-xs font-bold text-white min-h-8"
                    [style.--stagger-i]="i"
                    [class.bg-primary-500]="row.rank === 1"
                    [class.bg-primary-500/60]="row.rank === 2"
                    [class.bg-primary-500/45]="row.rank === 3"
                    [class.bg-primary-500/35]="row.rank > 3"
                    [style.height.%]="row.heightPct"
                    ><span aria-hidden="true">{{ row.rank }}</span
                    ><span class="sr-only">{{ row.rank }}º lugar</span></span
                  >
                  <span class="text-xs text-fg-muted truncate max-w-full" [title]="row.name">{{ row.name }}</span>
                </li>
              }
            </ol>
          } @else {
            <p class="text-sm text-fg-subtle text-center py-6">Sem dados no período.</p>
          }
        } @else if (layout() === 'podium') {
          @if (rows().length) {
            <div data-rank-podium class="space-y-2 min-w-0">
              <div
                data-rank-row
                class="flex items-center gap-3 min-w-0 h-14 rounded-2xl bg-emerald-600 text-white px-3"
              >
                <span class="size-9 shrink-0 grid place-items-center rounded-full bg-white/20 text-xs font-bold" aria-hidden="true">{{ rows()[0].initials }}</span>
                <span class="flex flex-col min-w-0 flex-1">
                  <span class="text-sm font-semibold truncate" data-hero-name [title]="rows()[0].name">{{ rows()[0].name }}</span>
                  <span class="text-xs text-white/80 truncate"><span class="sr-only">1º lugar </span>1º{{ rows()[0].sub ? ' · ' + rows()[0].sub : '' }}</span>
                </span>
                <span class="shrink-0 text-sm font-semibold tabular-nums">{{ rows()[0].value }}</span>
              </div>
              <ol class="grid grid-cols-2 gap-2 min-w-0">
                @for (row of rows().slice(1); track row.id) {
                  <li data-rank-row data-rank-chip class="flex items-center gap-2 min-w-0 h-12 rounded-xl bg-surface-muted px-2.5 text-xs">
                    <span class="size-6 shrink-0 grid place-items-center rounded-full bg-surface-sunken text-[10px] font-bold text-fg-body" aria-hidden="true">{{ row.initials }}</span>
                    <span class="flex flex-col min-w-0 flex-1">
                      <span class="truncate font-medium text-fg" [title]="row.name">{{ row.name }}</span>
                      <span class="truncate text-fg-muted tabular-nums">{{ row.value }}</span>
                    </span>
                  </li>
                }
              </ol>
            </div>
          } @else {
            <p class="text-sm text-fg-subtle text-center py-6">Sem dados no período.</p>
          }
        } @else {
        <ol class="space-y-1.5 min-w-0">
          @for (row of rows(); track row.id) {
            <li
              data-rank-row
              class="flex items-center gap-3 min-w-0 rounded-xl px-3 py-2"
              [class.bg-primary-500]="row.isHero"
              [class.text-white]="row.isHero"
              [class.bg-surface-muted]="!row.isHero"
              [class.text-fg]="!row.isHero"
            >
              <span
                data-rank-badge
                class="size-7 shrink-0 grid place-items-center rounded-full text-xs font-bold"
                [class.bg-white/20]="row.isHero"
                [class.bg-surface-sunken]="!row.isHero"
                [class.text-fg-body]="!row.isHero"
                ><span aria-hidden="true">{{ row.rank }}</span
                ><span class="sr-only">{{ row.rank }}º lugar</span></span
              >
              <span class="flex flex-col min-w-0 flex-1">
                <span class="text-sm font-semibold truncate">{{ row.name }}</span>
                @if (row.sub) {
                  <span
                    class="text-xs truncate"
                    [class.text-white/90]="row.isHero"
                    [class.text-fg-muted]="!row.isHero"
                    >{{ row.sub }}</span
                  >
                }
              </span>
              <span class="shrink-0 text-sm font-semibold tabular-nums">{{ row.value }}</span>
            </li>
          } @empty {
            <li class="text-sm text-fg-subtle text-center py-6">Sem dados no período.</li>
          }
        </ol>
        }
      </div>
    </app-page-card>
  `,
})
export class RankingCard {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  /** Wrap the title on up to two lines and reserve both (cards side by side stay aligned). */
  readonly reserveTitle = input(false);
  readonly items = input.required<readonly RankingItem[]>();
  /** How many rows to show. */
  readonly limit = input(5);
  /** Paint the first row. */
  readonly hero = input(false);
  /** `list` (default), `bars` (vertical bars with rank) or `podium` (painted first place + small chips). */
  readonly layout = input<'list' | 'bars' | 'podium'>('list');

  protected readonly rows = computed<RankedRow[]>(() =>
    this.items()
      .slice(0, Math.max(0, this.limit()))
      .map((it, i, all) => ({
        ...it,
        rank: i + 1,
        isHero: this.hero() && i === 0,
        initials: initialsOf(it.name),
        heightPct: heightOf(it, all),
      })),
  );
}
