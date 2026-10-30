import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  TemplateRef,
  computed,
  input,
  output,
  viewChildren,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { CountBadge } from '../count-badge/count-badge';

export interface SegmentedTabsOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Contagem no segmento. Zero ou ausente não mostra nada. */
  readonly count?: number;
  /** Rótulo da contagem para leitor de tela: "7 pendências". */
  readonly countLabel?: string;
  readonly testId?: string;
}

/**
 * Segmentos de uma mesma coisa, com um polegar que desliza. Para ações use botões: aqui
 * só se troca de vista. O polegar anima por `transform`, e movimento reduzido o desliga.
 *
 * Com `idPrefix` os segmentos apontam para os painéis (`{prefix}-panel-{valor}`).
 */
@Component({
  selector: 'app-segmented-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [CountBadge, NgTemplateOutlet],
  template: `
    <div
      role="tablist"
      [attr.aria-label]="ariaLabel()"
      class="relative grid grid-flow-col auto-cols-fr p-[3px] rounded-xl bg-fg/[0.07]"
      (keydown)="onKeydown($event)"
    >
      <span
        data-thumb
        aria-hidden="true"
        class="absolute top-[3px] bottom-[3px] left-[3px] rounded-[9px] bg-surface
               dark:bg-surface-strong shadow-[0_1px_2px_rgb(0_0_0/0.1)]
               transition-transform duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)]
               motion-reduce:transition-none"
        [style.width]="thumbWidth()"
        [style.transform]="thumbTransform()"
      ></span>
      @for (option of options(); track option.value) {
        <button
          #segment
          type="button"
          role="tab"
          [attr.id]="tabId(option.value)"
          [attr.aria-selected]="option.value === value()"
          [attr.aria-controls]="panelId(option.value)"
          [attr.tabindex]="option.value === value() ? 0 : -1"
          [attr.data-testid]="option.testId ?? null"
          class="relative min-h-11 rounded-[9px] font-semibold text-[15px] inline-flex items-center
                 justify-center gap-2 cursor-pointer bg-transparent border-0 transition-colors
                 duration-200 motion-reduce:transition-none focus-visible:outline-2
                 focus-visible:-outline-offset-2 focus-visible:outline-primary-400"
          [class.text-fg]="option.value === value()"
          [class.text-fg-muted]="option.value !== value()"
          (click)="choose(option.value)"
        >
          @if (iconTemplate(); as icon) {
            <ng-container *ngTemplateOutlet="icon; context: { $implicit: option.value }" />
          }
          {{ option.label }}
          @if (option.count) {
            <app-count-badge [count]="option.count" [label]="option.countLabel ?? null" />
          }
        </button>
      }
    </div>
  `,
})
export class SegmentedTabs<T extends string> {
  readonly options = input.required<readonly SegmentedTabsOption<T>[]>();
  readonly value = input.required<T>();
  readonly ariaLabel = input.required<string>();
  readonly idPrefix = input<string | null>(null);
  /** Ícone de cada segmento; recebe o valor da opção como contexto implícito. */
  readonly iconTemplate = input<TemplateRef<{ $implicit: T }> | null>(null);
  readonly selected = output<T>();

  private readonly segments = viewChildren<ElementRef<HTMLButtonElement>>('segment');

  private readonly activeIndex = computed(() =>
    Math.max(
      0,
      this.options().findIndex((o) => o.value === this.value()),
    ),
  );

  protected readonly thumbWidth = computed(
    () => `calc((100% - 6px) / ${Math.max(1, this.options().length)})`,
  );
  protected readonly thumbTransform = computed(() => `translateX(${this.activeIndex() * 100}%)`);

  protected tabId(value: T): string | null {
    const prefix = this.idPrefix();
    return prefix ? `${prefix}-tab-${value}` : null;
  }

  protected panelId(value: T): string | null {
    const prefix = this.idPrefix();
    return prefix ? `${prefix}-panel-${value}` : null;
  }

  protected choose(value: T): void {
    if (value !== this.value()) this.selected.emit(value);
  }

  /** Setas e Home/End trocam de segmento: a troca é barata e o foco vai junto. */
  protected onKeydown(event: KeyboardEvent): void {
    const count = this.options().length;
    const current = this.activeIndex();
    const steps: Record<string, number> = {
      ArrowRight: (current + 1) % count,
      ArrowLeft: (current - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const next = steps[event.key];
    if (next === undefined) return;
    event.preventDefault();
    this.choose(this.options()[next].value);
    this.segments()[next]?.nativeElement.focus();
  }
}
