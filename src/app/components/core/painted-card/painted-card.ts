import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type PaintedTone = 'orange' | 'green';

const FILL: Record<PaintedTone, string> = {
  orange: 'bg-primary-500',
  green: 'bg-emerald-700',
};

/**
 * Cartão pintado: cor sólida e texto branco, como o hero do motorista e o ARR do admin.
 * Degradê só na Assinatura. Uma ou duas por tela; os cartões de apoio ficam neutros.
 */
@Component({
  selector: 'app-painted-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClass()',
    '[attr.data-tone]': 'tone()',
  },
  template: `<ng-content />`,
})
export class PaintedCard {
  readonly tone = input.required<PaintedTone>();

  protected readonly hostClass = computed(
    () =>
      'enter-up rounded-2xl text-white p-4 sm:p-6 flex flex-col gap-4 min-w-0 ' +
      `transition-colors duration-300 motion-reduce:transition-none ${FILL[this.tone()]}`,
  );
}

/** Anel do hero: arco branco sobre branco translúcido, com o miolo na cor do cartão. */
@Component({
  selector: 'app-painted-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': 'ariaLabel()',
    class: 'shrink-0 relative block size-[72px] sm:size-[88px] rounded-full',
    '[style.background]': 'background()',
  },
  template: `
    <div
      class="absolute inset-[7px] rounded-full flex flex-col items-center justify-center"
      [class]="fill()"
    >
      <span class="text-base sm:text-xl font-bold tabular-nums leading-none">{{ value() }}</span>
      <span class="text-[10.5px] sm:text-xs leading-4 text-white/85 mt-0.5">{{ unit() }}</span>
    </div>
  `,
})
export class PaintedRing {
  readonly tone = input.required<PaintedTone>();
  /** Fração preenchida, de 0 a 100. */
  readonly percent = input.required<number>();
  readonly value = input.required<string>();
  readonly unit = input.required<string>();
  readonly ariaLabel = input.required<string>();

  protected readonly fill = computed(() => FILL[this.tone()]);
  protected readonly background = computed(() => {
    const deg = Math.round((Math.min(100, Math.max(0, this.percent())) / 100) * 360);
    return `conic-gradient(var(--color-white) ${deg}deg, rgb(255 255 255 / 0.25) 0)`;
  });
}

export interface PaintedStat {
  readonly label: string;
  readonly value: string;
}

/** Linha de números no pé do cartão. Quatro colunas não cabem em 375px com centavos. */
@Component({
  selector: 'dl[appPaintedStats]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'm-0 grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-3 sm:gap-2 border-t border-white/25 pt-3',
  },
  template: `
    @for (stat of stats(); track stat.label) {
      <div class="min-w-0 flex flex-col-reverse gap-0.5">
        <dt class="text-xs text-white/85 truncate">{{ stat.label }}</dt>
        <dd class="m-0 text-sm sm:text-lg font-semibold tabular-nums truncate">{{ stat.value }}</dd>
      </div>
    }
  `,
})
export class PaintedStats {
  readonly stats = input.required<readonly PaintedStat[]>();
}

/** O único botão do cartão: fundo de superfície, texto na cor da marca. */
@Component({
  selector: 'a[appPaintedAction]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClass()' },
  template: `<ng-content />`,
})
export class PaintedAction {
  readonly tone = input.required<PaintedTone>();

  protected readonly hostClass = computed(() => {
    const text =
      this.tone() === 'green'
        ? 'text-emerald-700 dark:text-emerald-300 focus-visible:ring-offset-emerald-700'
        : 'text-primary-700 dark:text-primary-400 focus-visible:ring-offset-primary-500';
    return (
      'press self-stretch sm:self-start min-h-11 px-5 rounded-xl bg-surface text-sm font-semibold ' +
      'inline-flex items-center justify-center gap-2 cursor-pointer no-underline ' +
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-surface ' +
      `focus-visible:ring-offset-2 ${text}`
    );
  });
}
