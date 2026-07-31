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

/**
 * Uma opção do toggle. Além do `label`, cada opção carrega o SEU acento visual
 * (gradiente + sombra do estado ativo) e um badge opcional — nada disso é
 * hard-coded aqui, quem usa é que informa.
 */
export interface SegmentedToggleOption<T> {
  readonly value: T;
  readonly label: string;
  /** Texto do badge dentro do botão (ex.: `-17%`). Ausente/vazio = sem badge. */
  readonly badge?: string;
  /** `background` CSS aplicado enquanto a opção está selecionada. */
  readonly activeBackground?: string;
  /** `box-shadow` CSS aplicado enquanto a opção está selecionada. */
  readonly activeShadow?: string;
  /** Classe do badge com a opção selecionada. */
  readonly badgeActiveClass?: string;
  /** Classe do badge com a opção não selecionada. */
  readonly badgeInactiveClass?: string;
}

const CONTAINER_BASE = 'inline-flex items-center gap-1 rounded-full p-1';
const CONTAINER_CHROME = 'bg-neutral-100 border border-neutral-200';

/**
 * Sem `text-*` aqui de propósito: o tamanho vem do `textClass`, senão duas
 * classes de font-size disputariam por ordem de folha, não por ordem no atributo.
 */
const SEGMENT_BASE =
  'relative border-none bg-transparent px-5 py-2 rounded-full font-body font-semibold ' +
  'cursor-pointer inline-flex items-center gap-2 min-h-[44px] transition-colors duration-200 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2';
const SEGMENT_ACTIVE = 'text-white';
const SEGMENT_INACTIVE = 'text-neutral-500 hover:text-neutral-900';

const BADGE_BASE = 'text-[10.5px] font-bold px-2 py-0.5 rounded-full tracking-[0.04em] text-white';
const BADGE_ACTIVE = 'bg-white/25';
const BADGE_INACTIVE = 'bg-emerald-600';

/**
 * Toggle segmentado de seleção única — o seletor de ciclo de cobrança
 * (Mensal / Anual) de `/billing` e da landing.
 *
 * Semântica: `role="radiogroup"` + `role="radio"` + `aria-checked`. Não existe
 * `tabpanel` algum sob o controle e nada de `aria-controls`: ele só troca o
 * DADO exibido (preço, sufixo do período), e a seleção é sempre única — logo
 * radiogroup, não `tablist`, que exige painéis de verdade. Mesma leitura que o
 * `FilterChipGroup` já faz.
 *
 * Teclado: setas / Home / End movem SOMENTE o foco, Enter / Espaço confirmam —
 * a variante "selection does not follow focus" do APG, coerente com o
 * `FilterChipGroup`, porque confirmar aqui repreça a grade de planos inteira.
 */
@Component({
  selector: 'app-segmented-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block' },
  template: `
    <div
      role="radiogroup"
      [class]="containerClasses()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-labelledby]="ariaLabelledby()"
      (keydown)="onKeydown($event)"
      (focusin)="onFocusIn($event)"
      (focusout)="onFocusOut($event)"
    >
      @for (option of options(); track option.value; let i = $index) {
        <button
          #segment
          type="button"
          role="radio"
          [attr.aria-checked]="option.value === value()"
          [attr.tabindex]="i === rovingIndex() ? 0 : -1"
          [class]="segmentClass(option)"
          [style.background]="segmentBackground(option)"
          [style.box-shadow]="segmentShadow(option)"
          (click)="select(option.value)"
        >
          {{ option.label }}
          @if (option.badge) {
            <span [class]="badgeClass(option)">{{ option.badge }}</span>
          }
        </button>
      }
    </div>
  `,
})
export class SegmentedToggle<T> {
  readonly options = input.required<readonly SegmentedToggleOption<T>[]>();
  /** Valor selecionado. Um valor fora da lista deixa o grupo sem opção marcada. */
  readonly value = input.required<T>();
  readonly ariaLabel = input<string | null>(null);
  /** Alternativa ao `ariaLabel` quando já existe rótulo visível na página. */
  readonly ariaLabelledby = input<string | null>(null);
  /** Moldura do trilho (fundo/borda/sombra) — muda entre app e landing. */
  readonly containerClass = input(CONTAINER_CHROME);
  /** Cor do texto da opção não selecionada, incluindo o hover. */
  readonly inactiveClass = input(SEGMENT_INACTIVE);
  /** Tamanho do texto das opções. Substitui, não acumula. */
  readonly textClass = input('text-sm');

  readonly selectionChange = output<T>();

  private readonly segments = viewChildren<ElementRef<HTMLButtonElement>>('segment');
  private readonly focus = new RovingFocusTracker();

  protected readonly containerClasses = computed(
    () => `${CONTAINER_BASE} ${this.containerClass()}`,
  );

  /**
   * Índice da opção marcada. Sem seleção válida cai na primeira — senão o grupo
   * inteiro sairia da ordem de tabulação.
   */
  private readonly selectedIndex = computed(() => {
    const index = this.options().findIndex((option) => option.value === this.value());
    return index < 0 ? 0 : index;
  });

  /** Com foco dentro segue o item focado; fora, volta pro marcado. */
  protected readonly rovingIndex = computed(() => this.focus.index() ?? this.selectedIndex());

  protected segmentClass(option: SegmentedToggleOption<T>): string {
    const state = option.value === this.value() ? SEGMENT_ACTIVE : this.inactiveClass();
    return `${SEGMENT_BASE} ${this.textClass()} ${state}`;
  }

  protected segmentBackground(option: SegmentedToggleOption<T>): string {
    return option.value === this.value()
      ? (option.activeBackground ?? 'transparent')
      : 'transparent';
  }

  protected segmentShadow(option: SegmentedToggleOption<T>): string {
    return option.value === this.value() ? (option.activeShadow ?? 'none') : 'none';
  }

  protected badgeClass(option: SegmentedToggleOption<T>): string {
    const state =
      option.value === this.value()
        ? (option.badgeActiveClass ?? BADGE_ACTIVE)
        : (option.badgeInactiveClass ?? BADGE_INACTIVE);
    return `${BADGE_BASE} ${state}`;
  }

  protected select(optionValue: T): void {
    this.selectionChange.emit(optionValue);
  }

  protected onFocusIn(event: FocusEvent): void {
    this.focus.onFocusIn(event, this.segments());
  }

  protected onFocusOut(event: FocusEvent): void {
    this.focus.onFocusOut(event, this.segments());
  }

  /**
   * `preventDefault` no Enter/Espaço evita o clique nativo do `<button>` — sem
   * isso a seleção sairia duplicada.
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
    this.segments()[action.index]?.nativeElement.focus();
  }
}
