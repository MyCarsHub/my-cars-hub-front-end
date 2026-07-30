import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChildren,
} from '@angular/core';

/** Uma opção do grupo de chips. `value` é o que sai no `selectionChange`. */
export interface FilterChipOption<T> {
  readonly value: T;
  readonly label: string;
}

/** Classe canônica do chip de filtro — fonte única para dashboard/relatórios/alertas. */
const CHIP_BASE =
  'min-h-[44px] px-4 py-2 rounded-full text-sm font-medium border transition-colors ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2';
const CHIP_ACTIVE = 'bg-primary-500 text-white border-primary-500';
const CHIP_INACTIVE = 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50';

const GROUP_WRAP = 'flex flex-wrap gap-2';
/** Mobile: carrossel com snap; ≥lg volta a quebrar linha como os demais. */
const GROUP_SCROLL =
  'flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1 lg:overflow-visible lg:flex-wrap';

/**
 * Grupo de chips de filtro mutuamente exclusivo.
 *
 * Semântica: `role="radiogroup"` + `role="radio"` + `aria-checked`, com roving
 * tabindex (só o chip selecionado é tabbable) e navegação por setas/Home/End,
 * conforme o padrão APG de radio group. Os três consumidores trocam o CONTEÚDO
 * exibido sem existir `tabpanel` algum, e a seleção é sempre única — por isso
 * `radiogroup` e não `tablist` nem `aria-pressed`.
 */
@Component({
  selector: 'app-filter-chip-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="radiogroup"
      [class]="containerClass()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-labelledby]="ariaLabelledby()"
      (keydown)="onKeydown($event)"
    >
      @for (option of options(); track option.value; let i = $index) {
        <button
          #chip
          type="button"
          role="radio"
          [attr.aria-checked]="option.value === value()"
          [attr.tabindex]="i === rovingIndex() ? 0 : -1"
          [class]="chipClass(option.value)"
          (click)="select(option.value)"
        >
          {{ option.label }}
        </button>
      }
    </div>
  `,
})
export class FilterChipGroup<T> {
  readonly options = input.required<readonly FilterChipOption<T>[]>();
  /** Valor selecionado. Um valor fora da lista deixa o grupo sem chip marcado. */
  readonly value = input.required<T>();
  readonly ariaLabel = input<string | null>(null);
  /** Alternativa ao `ariaLabel` quando já existe um rótulo visível na página. */
  readonly ariaLabelledby = input<string | null>(null);
  /** Carrossel horizontal no mobile — usado onde a lista de chips é longa. */
  readonly scrollable = input(false);

  readonly selectionChange = output<T>();

  private readonly chips = viewChildren<ElementRef<HTMLButtonElement>>('chip');

  protected readonly containerClass = computed(() =>
    this.scrollable() ? GROUP_SCROLL : GROUP_WRAP,
  );

  /**
   * Índice tabbable. Sem seleção válida cai no primeiro chip — senão o grupo
   * inteiro sairia da ordem de tabulação.
   */
  protected readonly rovingIndex = computed(() => {
    const index = this.options().findIndex((option) => option.value === this.value());
    return index < 0 ? 0 : index;
  });

  protected chipClass(optionValue: T): string {
    const state = optionValue === this.value() ? CHIP_ACTIVE : CHIP_INACTIVE;
    const snap = this.scrollable() ? ' snap-start shrink-0' : '';
    return `${CHIP_BASE} ${state}${snap}`;
  }

  protected select(optionValue: T): void {
    this.selectionChange.emit(optionValue);
  }

  /**
   * Setas movem o foco E selecionam (comportamento APG de radio group);
   * Home/End vão às extremidades. A lista circula nas pontas.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const options = this.options();
    if (options.length === 0) return;

    const current = this.rovingIndex();
    let next: number | null = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (current + 1) % options.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (current - 1 + options.length) % options.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = options.length - 1;
    }

    if (next === null) return;
    event.preventDefault();
    this.chips()[next]?.nativeElement.focus();
    this.selectionChange.emit(options[next].value);
  }
}
