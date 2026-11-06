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
  output,
  signal,
  untracked,
} from '@angular/core';
import { Router, type Params } from '@angular/router';

/** Duração da contagem. */
const COUNT_UP_MS = 700;

/**
 * The looks of a KPI strip. Nothing else exists: no new colour, no new radius.
 * `primary`/`emerald`/`emerald-dark` are PAINTED (solid, white text); `white` is the plain
 * surface; `muted` is the dashed "forecast" surface; `warning` is the tinted amber surface.
 */
export type KpiCardVariant = 'primary' | 'emerald' | 'emerald-dark' | 'white' | 'muted' | 'warning';

/** Colour of the number on the unpainted variants. Painted cards are always white. */
export type KpiCardTone = 'default' | 'success' | 'danger' | 'warning' | 'primary' | 'muted';

/** `regular` is the strip card; `compact` is the tighter one for calendars and summaries. */
export type KpiCardSize = 'regular' | 'compact';

/**
 * How a numeric `value`/`countTo` becomes text. The count-up animates the NUMBER and formats
 * every frame, so the last frame is exactly the final formatted value.
 *
 * - `integer`: 1.234
 * - `decimal`: 1.234,5 (see `decimals`, default 1)
 * - `brl`: value in reais  -> R$ 1.234,00
 * - `brl-cents`: value in cents -> R$ 12,34
 * - `brl-cents-compact`: cents as an axis label (150000 -> R$ 1,5k; 1000000 -> R$ 10k; 5000 -> R$ 50)
 * - `percent`: value is already in percent points (62.5 -> 62,5%; 50 -> 50%; `decimals` fixes the digits)
 * - `ratio`: value is 0..1 (0.625 -> 63%)
 */
export type KpiNumberFormat = 'integer' | 'decimal' | 'brl' | 'brl-cents' | 'brl-cents-compact' | 'percent' | 'ratio';

export interface KpiDelta {
  readonly text: string;
  /** `good`/`bad` colour the text; `neutral` is the quiet caption colour. No dot, no icon. */
  readonly tone: 'good' | 'bad' | 'neutral';
  /** Prototype delta chip ("↗ 8%") drawn before `text` as a tinted pill; `text` is then the caption. */
  readonly chip?: string;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const decimalFormatter = (digits: number, min = digits): Intl.NumberFormat =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: digits });
/** Percent without `decimals`: up to one decimal, none when whole (50%, 66,7%). */
const percentText = (n: number, decimals: number | null): string =>
  `${(decimals === null ? decimalFormatter(1, 0) : decimalFormatter(decimals)).format(n)}%`;

/** R$ 10k / R$ 1,5k / R$ 50: one decimal at most, none when whole. */
function compactBrl(reais: number): string {
  const abs = Math.abs(reais);
  const sign = reais < 0 ? '-' : '';
  if (abs >= 1000) return `${sign}R$ ${decimalFormatter(1, 0).format(Math.round(abs / 100) / 10)}k`;
  return `${sign}R$ ${decimalFormatter(0).format(Math.round(abs))}`;
}

/** Pure: the text of `n` in `kind`. Exported so specs and pages share the one rule. */
export function formatKpiNumber(kind: KpiNumberFormat, n: number, decimals: number | null = null): string {
  switch (kind) {
    case 'integer':
      return decimalFormatter(0).format(Math.round(n));
    case 'decimal':
      return decimalFormatter(decimals ?? 1).format(n);
    case 'brl':
      return BRL.format(n);
    case 'brl-cents':
      return BRL.format(Math.round(n) / 100);
    case 'brl-cents-compact':
      return compactBrl(n / 100);
    case 'percent':
      return percentText(n, decimals);
    case 'ratio':
      return percentText(n * 100, decimals);
  }
}

interface KpiCardLook {
  /** Card surface and radius. Padding comes from the size. */
  card: string;
  label: string;
  value: string;
  detail: string;
  skeleton: string;
  bar: string;
  barFill: string;
}

const PAINTED_LABEL = 'text-[11px] sm:text-xs text-white/70 uppercase tracking-wide truncate';
const PAINTED_VALUE = 'font-semibold text-white mt-1 tabular-nums truncate';
const PAINTED_DETAIL = 'text-[11px] sm:text-xs text-white/70 mt-1 truncate';
const PAINTED_SKELETON = 'h-8 mt-2 w-16 rounded bg-white/20 animate-pulse';
const PAINTED_BAR = 'mt-2 h-1.5 bg-white/20 rounded-full overflow-hidden';
const PAINTED_FILL = 'h-full rounded-full bg-white';

const PLAIN_LABEL = 'text-[11px] sm:text-xs text-gray-500 dark:text-fg-subtle uppercase tracking-wide truncate';
const PLAIN_DETAIL = 'text-[11px] sm:text-xs text-gray-500 dark:text-fg-subtle mt-1 truncate';
const PLAIN_SKELETON = 'h-8 mt-2 w-16 rounded bg-gray-100 dark:bg-surface-sunken animate-pulse';
const PLAIN_BAR = 'mt-2 h-1.5 bg-gray-100 dark:bg-surface-sunken rounded-full overflow-hidden';
const PLAIN_FILL = 'h-full rounded-full bg-primary-500';

/*
 * Whole class strings, spelled out: Tailwind finds a utility by scanning the source for it,
 * so a name assembled at runtime would silently never be generated.
 */
const LOOKS: Record<KpiCardVariant, KpiCardLook> = {
  primary: {
    card: 'block min-w-0 rounded-2xl bg-primary-500 text-white',
    label: PAINTED_LABEL,
    value: PAINTED_VALUE,
    detail: PAINTED_DETAIL,
    skeleton: PAINTED_SKELETON,
    bar: PAINTED_BAR,
    barFill: PAINTED_FILL,
  },
  emerald: {
    card: 'block min-w-0 rounded-2xl bg-emerald-600 text-white',
    label: PAINTED_LABEL,
    value: PAINTED_VALUE,
    detail: PAINTED_DETAIL,
    skeleton: PAINTED_SKELETON,
    bar: PAINTED_BAR,
    barFill: PAINTED_FILL,
  },
  'emerald-dark': {
    card: 'block min-w-0 rounded-2xl bg-emerald-700 text-white',
    label: PAINTED_LABEL,
    value: PAINTED_VALUE,
    detail: PAINTED_DETAIL,
    skeleton: PAINTED_SKELETON,
    bar: PAINTED_BAR,
    barFill: PAINTED_FILL,
  },
  white: {
    card: 'block min-w-0 rounded-2xl bg-surface border border-gray-200 dark:border-edge',
    label: PLAIN_LABEL,
    value: 'font-semibold mt-1 tabular-nums truncate',
    detail: PLAIN_DETAIL,
    skeleton: PLAIN_SKELETON,
    bar: PLAIN_BAR,
    barFill: PLAIN_FILL,
  },
  muted: {
    card: 'block min-w-0 rounded-2xl bg-canvas border border-dashed border-gray-200 dark:border-edge',
    label: PLAIN_LABEL,
    value: 'font-semibold mt-1 tabular-nums truncate',
    detail: PLAIN_DETAIL,
    skeleton: PLAIN_SKELETON,
    bar: PLAIN_BAR,
    barFill: PLAIN_FILL,
  },
  warning: {
    card: 'block min-w-0 rounded-2xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10',
    label: 'text-[11px] sm:text-xs text-amber-800 dark:text-amber-200 uppercase tracking-wide truncate',
    value: 'font-semibold mt-1 tabular-nums truncate text-amber-900 dark:text-amber-100',
    detail: 'text-[11px] sm:text-xs text-amber-800 dark:text-amber-200 mt-1 truncate',
    skeleton: 'h-8 mt-2 w-16 rounded bg-amber-200/60 dark:bg-amber-500/20 animate-pulse',
    bar: 'mt-2 h-1.5 bg-amber-200/60 dark:bg-amber-500/20 rounded-full overflow-hidden',
    barFill: 'h-full rounded-full bg-amber-500',
  },
};

const PAINTED: ReadonlySet<KpiCardVariant> = new Set(['primary', 'emerald', 'emerald-dark']);

const TONES: Record<KpiCardTone, string> = {
  default: 'text-gray-900 dark:text-fg',
  success: 'text-emerald-700 dark:text-emerald-300',
  danger: 'text-rose-700 dark:text-rose-300',
  warning: 'text-amber-700 dark:text-amber-300',
  primary: 'text-primary-700 dark:text-primary-400',
  muted: 'text-gray-600 dark:text-fg-muted',
};

const DELTA_PLAIN: Record<KpiDelta['tone'], string> = {
  good: 'text-emerald-700 dark:text-emerald-300',
  bad: 'text-rose-700 dark:text-rose-300',
  neutral: 'text-gray-500 dark:text-fg-subtle',
};

const SIZES: Record<KpiCardSize, { pad: string; value: string }> = {
  regular: { pad: 'p-4', value: 'text-xl sm:text-2xl' },
  compact: { pad: 'p-3', value: 'text-base sm:text-lg' },
};

/** Press feedback shared by every clickable card: 44px target, iOS-like squeeze, visible focus. */
const INTERACTIVE =
  ' min-h-[44px] cursor-pointer select-none transition-transform duration-150 active:scale-[0.98]' +
  ' motion-reduce:transition-none motion-reduce:active:scale-100 outline-none' +
  ' focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2';

/**
 * THE KPI card: small uppercase label, big number, small caption. Every page renders its
 * stat numbers with it, so a colour, radius, number format or motion changes in one place.
 *
 * The host IS the card (`<div app-kpi-card ...>`), so it stays a direct grid child and a
 * `div`. Lay the strip out in the page (`grid gap-3 grid-cols-2 lg:grid-cols-N`); the card
 * owns only its own surface.
 *
 * The number:
 * - a `string` value is shown as is;
 * - a `number` value with `numberFormat` (or a `format` function), or `countTo`, is formatted
 *   and COUNTS to the number (from 0 on first load, from the previous number on later
 *   changes). Turn it off with `[countUp]="false"` for numbers that change often; it is also
 *   off under `prefers-reduced-motion`;
 * - `null` shows nothing (`placeholder="none"`), a dash (`"dash"`) or the bar (`"skeleton"`).
 *   `loading` always shows the bar and keeps the label, so the card never changes height.
 *
 * `link` (route) or `pressable` (+ `(pressed)`) makes the whole card a keyboard-operable
 * link/button with press feedback.
 */
@Component({
  selector: 'div[app-kpi-card]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClass()',
    '[attr.role]': 'role()',
    '[attr.tabindex]': 'interactive() ? 0 : null',
    '[attr.aria-label]': 'ariaLabel()',
    '[style.--stagger-i]': 'stagger()',
    '(click)': 'activate()',
    '(keydown.enter)': 'onKey($event)',
    '(keydown.space)': 'onKey($event)',
  },
  template: `
    <p [class]="labelClass()">
      <ng-content select="[kpiIcon]" />
      <span class="truncate">{{ label() }}</span>
    </p>
    @if (loading() || (view() === null && placeholder() === 'skeleton')) {
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
      } @else if (placeholder() === 'dash') {
        <p [class]="valueClass()">—</p>
      }
      @if (delta(); as d) {
        @if (d.chip) {
          <p data-kpi-delta class="mt-1.5 flex items-center gap-1.5 min-w-0 text-[11px] sm:text-xs" [class]="captionClass(d)">
            <span data-kpi-chip class="shrink-0 rounded-full px-2 py-0.5 font-semibold tabular-nums" [class]="chipClass(d)">{{ d.chip }}</span>
            <span class="truncate">{{ d.text }}</span>
          </p>
        } @else {
          <p data-kpi-delta [class]="deltaClass(d)">{{ d.text }}</p>
        }
      }
      @if (detail() !== null) {
        <p data-kpi-detail [class]="detailCompact() !== null ? look().detail + ' hidden md:block' : look().detail">
          {{ detail() }}
        </p>
      }
      @if (detailCompact() !== null) {
        <p data-kpi-detail [class]="look().detail + ' md:hidden'">{{ detailCompact() }}</p>
      }
      @if (progress() !== null) {
        <div [class]="look().bar" aria-hidden="true" data-kpi-progress>
          <div [class]="look().barFill" [style.width.%]="progressPct()"></div>
        </div>
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
  /** Número que o cartão CONTA; vence `value`. Sem `numberFormat`/`format`, inteiro pt-BR. */
  readonly countTo = input<number | null>(null);
  /** Formato pronto do número (veja `KpiNumberFormat`); `format` vence quando informado. */
  readonly numberFormat = input<KpiNumberFormat | null>(null);
  /** Casas decimais de `decimal`/`percent`/`ratio`. */
  readonly decimals = input<number | null>(null);
  /** Texto colado antes/depois do número formatado (ex.: `≈`, ` dias`). */
  readonly prefix = input('');
  readonly suffix = input('');
  /** Formatação própria do número (vence `numberFormat`). */
  readonly format = input<((n: number) => string) | null>(null);
  /** Texto do número abaixo de `md`; sem ele, o formato vale em todas as telas. */
  readonly formatCompact = input<((n: number) => string) | null>(null);
  /** Conta o número até o valor. Desligue para números que mudam toda hora. */
  readonly countUp = input(true);
  /** O que mostrar quando não há número (`value` null). */
  readonly placeholder = input<'none' | 'dash' | 'skeleton'>('none');
  /** Número ancorado no pé do cartão e altura mínima, para uma fileira de cartões iguais. */
  readonly anchored = input(false);
  readonly size = input<KpiCardSize>('regular');
  /** Cor do número nas variantes não pintadas (as pintadas são sempre brancas). */
  readonly tone = input<KpiCardTone>('default');
  /** Linha de variação (texto colorido, sem bolinha). */
  readonly delta = input<KpiDelta | null>(null);
  /** Barra de progresso 0..1 no pé do cartão. */
  readonly progress = input<number | null>(null);
  /** Índice da entrada em escada (40ms por índice); liga `enter-up lift`. */
  readonly stagger = input<number | null>(null);

  /** Rota que o cartão inteiro abre (vira `role="link"`). */
  readonly link = input<string | readonly unknown[] | null>(null);
  readonly linkQueryParams = input<Params | null>(null);
  /** Cartão-botão: emite `pressed` no clique/Enter/Espaço (`role="button"`). */
  readonly pressable = input(false);
  /** Nome acessível do cartão clicável (o padrão é o conteúdo). */
  readonly ariaLabel = input<string | null>(null);
  readonly pressed = output<void>();

  protected readonly look = computed(() => LOOKS[this.variant()]);
  protected readonly interactive = computed(() => this.link() !== null || this.pressable());
  protected readonly role = computed(() =>
    this.link() !== null ? 'link' : this.pressable() ? 'button' : null,
  );

  protected readonly hostClass = computed(
    () =>
      this.look().card +
      ' ' +
      SIZES[this.size()].pad +
      (this.anchored() ? ' flex! flex-col min-h-[112px]' : '') +
      (this.stagger() !== null ? ' enter-up lift' : '') +
      (this.interactive() ? INTERACTIVE : ''),
  );
  /** Cartão ancorado (com ícone): rótulo em caixa normal, que cabe inteiro em 375px. */
  protected readonly labelClass = computed(
    () =>
      this.look().label +
      ' flex items-center gap-1.5' +
      (this.anchored() ? ' normal-case! tracking-normal! text-xs! sm:text-xs!' : ''),
  );
  protected readonly valueClass = computed(
    () =>
      this.look().value +
      ' ' +
      SIZES[this.size()].value +
      (PAINTED.has(this.variant()) || this.variant() === 'warning' ? '' : ' ' + TONES[this.tone()]) +
      (this.anchored() ? ' mt-auto' : ''),
  );
  protected readonly progressPct = computed(() =>
    Math.max(0, Math.min(1, this.progress() ?? 0)) * 100,
  );

  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly shown = signal<number | null>(null);
  private frame = 0;

  /** The number to show, when the card has one (else the value is plain text or absent). */
  private readonly numeric = computed<number | null>(() => {
    const target = this.countTo();
    if (target !== null) return target;
    const v = this.value();
    const hasFormat = this.numberFormat() !== null || this.format() !== null;
    return typeof v === 'number' && hasFormat ? v : null;
  });

  private readonly formatter = computed<(n: number) => string>(() => {
    const custom = this.format();
    const kind = this.numberFormat() ?? 'integer';
    const decimals = this.decimals();
    const prefix = this.prefix();
    const suffix = this.suffix();
    const base = custom ?? ((n: number) => formatKpiNumber(kind, n, decimals));
    return (n) => prefix + base(n) + suffix;
  });

  protected readonly view = computed<{ full: string; compact: string | null } | null>(() => {
    if (this.numeric() === null) {
      const v = this.value();
      return v === null ? null : { full: this.prefix() + String(v) + this.suffix(), compact: null };
    }
    const n = this.shown();
    if (n === null) return null;
    const compact = this.formatCompact();
    const prefix = this.prefix();
    const suffix = this.suffix();
    return {
      full: this.formatter()(n),
      compact: compact ? prefix + compact(n) + suffix : null,
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
    effect(() => {
      const target = this.numeric();
      const animate = this.countUp();
      if (target === null) {
        untracked(() => this.cancel());
        untracked(() => this.shown.set(null));
        return;
      }
      if (this.loading()) return;
      untracked(() => this.run(target, animate));
    });
  }

  protected deltaClass(d: KpiDelta): string {
    const base = 'text-[11px] sm:text-xs mt-1 truncate ';
    return base + (PAINTED.has(this.variant()) ? 'text-white/90' : DELTA_PLAIN[d.tone]);
  }

  protected captionClass(_d: KpiDelta): string {
    return PAINTED.has(this.variant()) ? 'text-white/90' : 'text-gray-500 dark:text-fg-subtle';
  }

  protected chipClass(d: KpiDelta): string {
    if (PAINTED.has(this.variant())) return 'bg-white/20 text-white';
    return d.tone === 'good'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
      : d.tone === 'bad'
        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
        : 'bg-surface-muted text-fg-muted';
  }

  protected activate(): void {
    if (!this.interactive()) return;
    this.pressed.emit();
    const link = this.link();
    if (link !== null) {
      void this.router.navigate(typeof link === 'string' ? [link] : [...link], {
        queryParams: this.linkQueryParams() ?? undefined,
      });
    }
  }

  protected onKey(event: Event): void {
    if (!this.interactive()) return;
    event.preventDefault();
    this.activate();
  }

  /** Sem `requestAnimationFrame`/`matchMedia` (SSR, jsdom) ou com movimento reduzido, salta ao final. */
  private canAnimate(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    if (typeof requestAnimationFrame !== 'function' || typeof matchMedia !== 'function') return false;
    return !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private run(target: number, animate: boolean): void {
    this.cancel();
    const from = this.shown() ?? 0;
    if (!animate || !this.canAnimate() || from === target) {
      this.shown.set(target);
      return;
    }
    this.shown.set(from);
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min((now - start) / COUNT_UP_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      this.shown.set(t >= 1 ? target : from + (target - from) * eased);
      if (t < 1) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private cancel(): void {
    if (this.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
