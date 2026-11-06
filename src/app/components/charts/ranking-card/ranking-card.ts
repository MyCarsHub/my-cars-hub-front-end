import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PageCard } from '../../core/page-card/page-card';

export interface RankingItem {
  readonly id: string;
  readonly name: string;
  /** Second line (plate, vehicle...). */
  readonly sub?: string;
  /** Value already formatted as text by the caller (money, count...). */
  readonly value: string;
}

interface RankedRow extends RankingItem {
  readonly rank: number;
  readonly isHero: boolean;
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
  host: { class: 'block min-w-0' },
  template: `
    <app-page-card [title]="title()">
      <div class="px-4 sm:px-6 pb-5 min-w-0">
        @if (subtitle()) {
          <p class="text-xs text-fg-muted mb-3">{{ subtitle() }}</p>
        }
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
      </div>
    </app-page-card>
  `,
})
export class RankingCard {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly items = input.required<readonly RankingItem[]>();
  /** How many rows to show. */
  readonly limit = input(5);
  /** Paint the first row. */
  readonly hero = input(false);

  protected readonly rows = computed<RankedRow[]>(() =>
    this.items()
      .slice(0, Math.max(0, this.limit()))
      .map((it, i) => ({ ...it, rank: i + 1, isHero: this.hero() && i === 0 })),
  );
}
