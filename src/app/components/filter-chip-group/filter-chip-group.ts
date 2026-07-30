import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChildren,
} from '@angular/core';
import { RovingFocusTracker, resolveRovingKey } from '../roving-focus/roving-focus';

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
 * tabindex e navegação por setas/Home/End. Os três consumidores trocam o
 * CONTEÚDO exibido sem existir `tabpanel` algum, e a seleção é sempre única —
 * por isso `radiogroup` e não `tablist` nem `aria-pressed`.
 *
 * Variante "a seleção NÃO acompanha o foco": setas/Home/End movem só o foco e
 * Enter/Espaço confirmam. É a mesma variante que o APG descreve para radio
 * group dentro de toolbar ("the button that is checked does not change") e que
 * a prática de teclado recomenda quando selecionar dispara requisição de rede —
 * aqui cada seleção dispara `reload()`/`load()` nos consumidores.
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
      (focusin)="onFocusIn($event)"
      (focusout)="onFocusOut($event)"
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

  /** Chip com foco enquanto o grupo está focado; `null` quando o foco está fora. */
  private readonly focus = new RovingFocusTracker();

  /**
   * Índice do chip marcado. Sem seleção válida cai no primeiro chip — senão o
   * grupo inteiro sairia da ordem de tabulação.
   */
  private readonly selectedIndex = computed(() => {
    const index = this.options().findIndex((option) => option.value === this.value());
    return index < 0 ? 0 : index;
  });

  /**
   * Índice tabbable. Enquanto o grupo tem foco segue o chip focado (que pode
   * não ser o marcado); ao sair, volta pro marcado — assim o Tab de retorno
   * cai no chip selecionado, como manda o APG.
   */
  protected readonly rovingIndex = computed(() => this.focus.index() ?? this.selectedIndex());

  protected chipClass(optionValue: T): string {
    const state = optionValue === this.value() ? CHIP_ACTIVE : CHIP_INACTIVE;
    const snap = this.scrollable() ? ' snap-start shrink-0' : '';
    return `${CHIP_BASE} ${state}${snap}`;
  }

  protected select(optionValue: T): void {
    this.selectionChange.emit(optionValue);
  }

  /** Mantém o roving tabindex no chip realmente focado. */
  protected onFocusIn(event: FocusEvent): void {
    this.focus.onFocusIn(event, this.chips());
  }

  /** Foco saiu do grupo: devolve o tabindex ao chip marcado. */
  protected onFocusOut(event: FocusEvent): void {
    this.focus.onFocusOut(event, this.chips());
  }

  /**
   * Setas/Home/End movem SOMENTE o foco (a lista circula nas pontas); Enter e
   * Espaço confirmam o chip focado. `preventDefault` no Enter/Espaço evita o
   * clique nativo do `<button>` — sem isso a seleção sairia duplicada.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const options = this.options();
    const current = this.rovingIndex();
    const action = resolveRovingKey(event.key, current, options.length);
    if (action === null) return;

    event.preventDefault();

    if (action.kind === 'confirm') {
      this.select(options[current].value);
      return;
    }

    this.focus.set(action.index);
    this.chips()[action.index]?.nativeElement.focus();
  }
}
