import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type StatusChipTone = 'green' | 'orange' | 'amber' | 'neutral' | 'blue' | 'red' | 'white';

/** As mesmas classes de `status-maps.ts`, para o chip dizer a mesma coisa em todo lugar. */
const TONE: Record<StatusChipTone, string> = {
  green: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
  orange: 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300',
  amber: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200',
  neutral: 'bg-surface-sunken text-fg-muted',
  blue: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300',
  red: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-200',
  white: 'bg-white/15 text-white',
};

const BASE =
  'inline-flex items-center rounded-full font-semibold whitespace-nowrap flex-none ' +
  'transition-colors duration-300 motion-reduce:transition-none';

/**
 * Chip de situação: só texto sobre o fundo tingido. Sem bolinha, por decisão do dono:
 * a cor já diz o estado, e o texto já diz qual.
 *
 * `colorClass` existe para quem já tem a classe pronta em `status-maps.ts`, que
 * continua sendo a fonte das cores de status (`Alugado`, `Disponível`...).
 */
@Component({
  selector: 'app-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClass()' },
  template: `<ng-content />`,
})
export class StatusChip {
  readonly tone = input<StatusChipTone>('neutral');
  readonly size = input<'sm' | 'md'>('md');
  readonly colorClass = input<string | null>(null);

  protected readonly hostClass = computed(() => {
    const size = this.size() === 'sm' ? 'h-[22px] px-2 text-xs' : 'h-[26px] px-2.5 text-[12.5px]';
    return `${BASE} ${size} ${this.colorClass() ?? TONE[this.tone()]}`;
  });
}
