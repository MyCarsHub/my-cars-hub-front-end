import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';

/** Duração da contagem de 0 até o número final. */
const COUNT_UP_MS = 700;

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
    card: 'block min-w-0 rounded-2xl bg-surface border border-gray-200 dark:border-edge p-4',
    label: 'text-[11px] sm:text-xs text-gray-500 dark:text-fg-subtle uppercase tracking-wide truncate',
    value: 'text-xl sm:text-2xl font-semibold text-gray-900 dark:text-fg mt-1 tabular-nums truncate',
    detail: 'text-[11px] sm:text-xs text-gray-500 dark:text-fg-subtle mt-1 truncate',
    skeleton: 'h-8 mt-2 w-16 rounded bg-gray-100 dark:bg-surface-sunken animate-pulse',
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
  host: { '[class]': 'hostClass()' },
  template: `
    <p [class]="labelClass()">
      <ng-content select="[kpiIcon]" />
      <span class="truncate">{{ label() }}</span>
    </p>
    @if (loading()) {
      <div [class]="look().skeleton"></div>
    } @else {
      @if (view(); as v) {
        <p [class]="valueClass()">
          @if (v.compact !== null) {
            <span class="md:hidden">{{ v.compact }}</span>
            <span class="hidden md:inline">{{ v.full }}</span>
          } @else {
            {{ v.full }}
          }
        </p>
      }
      @if (detail() !== null) {
        <p data-kpi-detail [class]="detailCompact() !== null ? look().detail + ' hidden md:block' : look().detail">
          {{ detail() }}
        </p>
      }
      @if (detailCompact() !== null) {
        <p data-kpi-detail [class]="look().detail + ' md:hidden'">{{ detailCompact() }}</p>
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

  /** Legenda mais curta para telas abaixo de `md`; sem ela, `detail` vale em todas. */
  readonly detailCompact = input<string | null>(null);
  /** Número que o cartão CONTA de 0 até aqui (uma vez, na primeira carga); vence `value`. */
  readonly countTo = input<number | null>(null);
  /** Como o número vira texto durante e depois da contagem. */
  readonly format = input<(n: number) => string>((n) => String(Math.round(n)));
  /** Texto do número abaixo de `md`; sem ele, `format` vale em todas as telas. */
  readonly formatCompact = input<((n: number) => string) | null>(null);
  /** Número ancorado no pé do cartão e altura mínima, para uma fileira de cartões iguais. */
  readonly anchored = input(false);

  protected readonly look = computed(() => LOOKS[this.variant()]);

  protected readonly hostClass = computed(
    () => this.look().card + (this.anchored() ? ' flex! flex-col min-h-[112px]' : ''),
  );
  /** Cartão ancorado (com ícone): rótulo em caixa normal, que cabe inteiro em 375px. */
  protected readonly labelClass = computed(
    () =>
      this.look().label +
      ' flex items-center gap-1.5' +
      (this.anchored() ? ' normal-case! tracking-normal! text-xs! sm:text-xs!' : ''),
  );
  protected readonly valueClass = computed(
    () => this.look().value + (this.anchored() ? ' mt-auto' : ''),
  );

  private readonly platformId = inject(PLATFORM_ID);
  private readonly shown = signal<number | null>(null);
  private counted = false;
  private frame = 0;

  protected readonly view = computed<{ full: string; compact: string | null } | null>(() => {
    if (this.countTo() === null) {
      const v = this.value();
      return v === null ? null : { full: String(v), compact: null };
    }
    const n = this.shown();
    if (n === null) return null;
    const compact = this.formatCompact();
    return { full: this.format()(n), compact: compact ? compact(n) : null };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
    effect(() => {
      const target = this.countTo();
      if (target === null || this.loading()) return;
      untracked(() => this.run(target));
    });
  }

  /** Sem `requestAnimationFrame`/`matchMedia` (SSR, jsdom) ou com movimento reduzido, salta ao final. */
  private canAnimate(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    if (typeof requestAnimationFrame !== 'function' || typeof matchMedia !== 'function') return false;
    return !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private run(target: number): void {
    this.cancel();
    if (this.counted || !this.canAnimate() || target <= 0) {
      this.counted = true;
      this.shown.set(target);
      return;
    }
    this.counted = true;
    this.shown.set(0);
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min((now - start) / COUNT_UP_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      this.shown.set(t >= 1 ? target : target * eased);
      if (t < 1) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private cancel(): void {
    if (this.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
