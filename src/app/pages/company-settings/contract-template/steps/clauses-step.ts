import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ContractBaseClause } from '../base/contract-base.types';

/**
 * «Montar do zero», etapa 1: as fixas como etiquetas e as opcionais com checkbox. Tocar ou
 * passar o mouse numa opcional põe a cláusula em foco no contrato ao vivo.
 */
@Component({
  selector: 'app-contract-clauses-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-5' },
  template: `
    <div class="flex flex-col gap-2">
      <span class="text-[13px] font-semibold uppercase tracking-wide text-neutral-600">Sempre no contrato</span>
      <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
        @for (c of fixed(); track c.id) {
          <li class="flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" /></svg>
            {{ c.title }}
          </li>
        }
      </ul>
    </div>
    <fieldset class="m-0 flex flex-col gap-2 border-0 p-0">
      <legend class="mb-2 p-0 text-[13px] font-semibold uppercase tracking-wide text-neutral-600">
        Escolha o que mais entra
      </legend>
      @for (c of optional(); track c.id) {
        <label
          (mouseenter)="focused.emit(c.id)"
          class="flex min-h-[64px] cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 focus-within:ring-2 focus-within:ring-primary-400"
          [class]="selected().has(c.id) ? 'border-primary-200 bg-primary-50' : 'border-neutral-200 bg-white'"
        >
          <input
            type="checkbox"
            class="mt-0.5 h-[22px] w-[22px] shrink-0 accent-primary-600"
            [checked]="selected().has(c.id)"
            (focus)="focused.emit(c.id)"
            (change)="toggled.emit(c.id)"
          />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-base font-semibold text-neutral-900">{{ c.title }}</span>
            <span class="text-sm leading-snug text-neutral-600">{{ c.description }}</span>
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
}
