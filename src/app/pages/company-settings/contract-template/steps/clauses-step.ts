import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ContractBaseClause } from '../base/contract-base.types';
import { ContractIcon } from '../contract-icon';

/**
 * «Montar do zero», etapa 1: as fixas como etiquetas e as opcionais com checkbox. Tocar ou
 * passar o mouse numa opcional põe a cláusula em foco no contrato ao vivo.
 */
@Component({
  selector: 'app-contract-clauses-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-5' },
  imports: [ContractIcon],
  template: `
    <div class="flex flex-col gap-1.5">
      <h3 data-step-heading tabindex="-1" class="m-0 text-xl font-bold leading-snug text-fg focus:outline-none">
        O que entra no seu contrato?
      </h3>
      <p class="m-0 text-[15px] leading-relaxed text-fg-muted">
        Marque as regras que você usa hoje. O contrato muda na hora.
      </p>
    </div>
    <div class="flex flex-col gap-2">
      <span class="text-[13px] font-semibold uppercase tracking-wide text-fg-muted">Sempre no contrato</span>
      <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
        @for (c of fixed(); track c.id) {
          <li class="flex items-center gap-1.5 rounded-full border border-edge bg-surface-muted px-3 py-1.5 text-sm font-medium text-fg-body">
            <app-contract-icon name="check" [size]="14" [stroke]="2.5" class="text-emerald-700 dark:text-emerald-300" />
            {{ c.title }}
          </li>
        }
      </ul>
    </div>
    <fieldset class="m-0 flex flex-col gap-2 border-0 p-0">
      <legend class="mb-2 flex w-full items-center justify-between gap-3 p-0">
        <span class="text-[13px] font-semibold uppercase tracking-wide text-fg-muted">Escolha o que mais entra</span>
        <span class="text-[13px] font-medium text-fg-muted tabular-nums">{{ chosen() }} de {{ optional().length }}</span>
      </legend>
      @for (c of optional(); track c.id) {
        <label
          (mouseenter)="focused.emit(c.id)"
          class="flex min-h-[64px] cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-3.5 transition-colors focus-within:ring-2 focus-within:ring-primary-400 hover:border-neutral-400 dark:hover:border-neutral-500"
          [class]="selected().has(c.id) ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10' : 'border-edge bg-surface'"
        >
          <input
            type="checkbox"
            class="mt-0.5 h-6 w-6 shrink-0 accent-emerald-700 focus:outline-none"
            [checked]="selected().has(c.id)"
            (focus)="focused.emit(c.id)"
            (change)="toggled.emit(c.id)"
          />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-base font-semibold text-fg">{{ c.title }}</span>
            <span class="text-sm leading-snug text-fg-muted">{{ c.description }}</span>
          </span>
        </label>
      }
    </fieldset>
  `,
})
export class ContractClausesStep {
  readonly clauses = input<readonly ContractBaseClause[]>([]);
  readonly selected = input<ReadonlySet<string>>(new Set());
  readonly toggled = output<string>();
  readonly focused = output<string>();

  protected readonly fixed = computed(() => this.clauses().filter((c) => c.fixed));
  protected readonly optional = computed(() => this.clauses().filter((c) => !c.fixed));
  protected readonly chosen = computed(() => this.optional().filter((c) => this.selected().has(c.id)).length);
}
