import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { RovingFocusTracker, resolveRovingKey } from '../../roving-focus/roving-focus';

export interface PillTabOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Rótulo curto, só abaixo de `sm`, para quando a fileira não cabe em 375px. */
  readonly shortLabel?: string;
  /** Contagem ao lado do rótulo; zero aparece (é informação). */
  readonly count?: number;
  readonly testId?: string;
}

interface Thumb {
  x: number;
  width: number;
  height: number;
  ready: boolean;
}

const PAD = 4;

/**
 * Filtro em pílulas com contagem. A pílula ativa é um polegar laranja que DESLIZA entre as
 * posições (`transform`, curva de mola) em vez de trocar de cor no lugar. A fileira rola na
 * horizontal se não couber, então nada é cortado; movimento reduzido tira o deslize.
 *
 * Semântica de `role="radiogroup"` como o `FilterChipGroup`: troca o CONTEÚDO exibido, a
 * seleção é única, setas movem o foco e Enter/Espaço confirmam.
 */
@Component({
  selector: 'app-pill-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styles: `
    .no-bar {
      scrollbar-width: none;
    }
    .no-bar::-webkit-scrollbar {
      display: none;
    }
  `,
  template: `
    <div
      #track
      role="radiogroup"
      [attr.aria-label]="ariaLabel()"
      class="no-bar relative flex gap-1.5 sm:gap-2 overflow-x-auto p-1 -m-1"
      (keydown)="onKeydown($event)"
      (focusin)="onFocusIn($event)"
      (focusout)="onFocusOut($event)"
    >
      <span
        data-thumb
        aria-hidden="true"
        class="pill-thumb absolute top-1 left-1 rounded-full bg-primary-500 pointer-events-none"
        [class.opacity-0]="!thumb().ready"
        [style.width.px]="thumb().width"
        [style.height.px]="thumb().height"
        [style.transform]="'translate3d(' + thumb().x + 'px,0,0)'"
      ></span>
      @for (option of options(); track option.value; let i = $index) {
        <button
          #pill
          type="button"
          role="radio"
          [attr.aria-checked]="option.value === value()"
          [attr.tabindex]="i === rovingIndex() ? 0 : -1"
          [attr.aria-label]="option.shortLabel ? option.label + (option.count !== undefined ? ', ' + option.count : '') : null"
          [attr.data-testid]="option.testId ?? null"
          class="press press-soft relative z-10 shrink-0 min-h-10 px-3 sm:px-4 rounded-full border text-[13px] sm:text-sm
                 font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors duration-200
                 motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-primary-400
                 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          [class]="
            option.value === value()
              ? 'text-white border-transparent bg-transparent'
              : 'text-fg-soft border-edge bg-surface hover:bg-surface-muted'
          "
          (click)="select(option.value)"
        >
          @if (option.shortLabel) {
            <span class="sm:hidden">{{ option.shortLabel }}</span>
            <span class="hidden sm:inline">{{ option.label }}</span>
          } @else {
            <span>{{ option.label }}</span>
          }
          @if (option.count !== undefined) {
            <span
              class="text-xs tabular-nums"
              [class]="option.value === value() ? 'text-white/85' : 'text-fg-subtle'"
              >{{ option.count }}</span
            >
          }
        </button>
      }
    </div>
  `,
})
export class PillTabs<T extends string> {
  readonly options = input.required<readonly PillTabOption<T>[]>();
  readonly value = input.required<T>();
  readonly ariaLabel = input.required<string>();
  readonly selected = output<T>();

  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');
  private readonly pills = viewChildren<ElementRef<HTMLButtonElement>>('pill');
  private readonly focus = new RovingFocusTracker();
  private readonly destroyRef = inject(DestroyRef);

  protected readonly thumb = signal<Thumb>({ x: 0, width: 0, height: 0, ready: false });

  private readonly selectedIndex = computed(() =>
    Math.max(
      0,
      this.options().findIndex((o) => o.value === this.value()),
    ),
  );
  protected readonly rovingIndex = computed(() => this.focus.index() ?? this.selectedIndex());

  constructor() {
    // Mede de novo quando a seleção, as opções (contagens mudam a largura) ou as pílulas mudam.
    afterRenderEffect(() => {
      this.value();
      this.options();
      this.pills();
      this.measure();
    });
    afterNextRender(() => {
      if (typeof ResizeObserver !== 'function') return;
      const observer = new ResizeObserver(() => this.measure());
      observer.observe(this.track().nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  private measure(): void {
    const pill = this.pills()[this.selectedIndex()]?.nativeElement;
    if (!pill || pill.offsetWidth === 0) return;
    const next: Thumb = {
      x: pill.offsetLeft - PAD,
      width: pill.offsetWidth,
      height: pill.offsetHeight,
      ready: true,
    };
    const prev = this.thumb();
    if (prev.x === next.x && prev.width === next.width && prev.height === next.height && prev.ready) return;
    this.thumb.set(next);
    // Só a fileira rola (nunca a página): mantém a pílula marcada à vista.
    const box = this.track().nativeElement;
    if (pill.offsetLeft < box.scrollLeft) box.scrollLeft = pill.offsetLeft - PAD;
    else if (pill.offsetLeft + pill.offsetWidth > box.scrollLeft + box.clientWidth)
      box.scrollLeft = pill.offsetLeft + pill.offsetWidth - box.clientWidth + PAD;
  }

  protected select(value: T): void {
    if (value !== this.value()) this.selected.emit(value);
  }

  protected onFocusIn(event: FocusEvent): void {
    this.focus.onFocusIn(event, this.pills());
  }

  protected onFocusOut(event: FocusEvent): void {
    this.focus.onFocusOut(event, this.pills());
  }

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
    this.pills()[action.index]?.nativeElement.focus();
  }
}
