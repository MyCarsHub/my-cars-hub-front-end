import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FieldOption } from './ai/contract-ai.types';
import { fieldLabel } from './ai/contract-ai.messages';
import { ContractIcon } from './contract-icon';

/** Amostra de rótulos que cabe na linha fechada, antes do «e mais N». */
const PREVIEW = 3;
/** Teto do atraso em cascata: lista longa não pode fazer o último chip demorar a aparecer. */
const STAGGER_MS = 14;
const STAGGER_MAX_MS = 140;

let nextId = 0;

/**
 * Os campos que o contrato enviado JÁ trazia como `{{campo}}`: não são perguntas, então não
 * disputam atenção com elas. Fechado mostra a contagem e uma amostra; abre para a lista inteira.
 */
@Component({
  selector: 'app-contract-existing-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block empty:hidden' },
  imports: [ContractIcon],
  styles: `
    @keyframes chip-in {
      from { opacity: 0; transform: translateY(6px) scale(0.97); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .chip-in { animation: chip-in 220ms var(--ease-out) both; }
    }
  `,
  template: `
    @if (fields().length > 0) {
      <div class="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10">
        <button
          type="button"
          (click)="open.set(!open())"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="listId"
          class="flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-transform duration-150 hover:bg-emerald-100/60 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 motion-reduce:transition-none motion-reduce:active:scale-100 dark:hover:bg-emerald-500/15"
        >
          <app-contract-icon name="checkCircle" [size]="20" class="shrink-0 text-emerald-700 dark:text-emerald-300" />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-[15px] font-semibold leading-snug text-emerald-900 dark:text-emerald-200">{{ title() }}</span>
            <span class="text-[13px] leading-snug text-emerald-900/80 dark:text-emerald-200/80">{{ preview() }}</span>
          </span>
          <app-contract-icon
            name="chevronDown"
            [size]="18"
            class="shrink-0 text-emerald-700 transition-transform duration-300 motion-reduce:transition-none dark:text-emerald-300"
            [class.rotate-180]="open()"
          />
        </button>
        @if (open()) {
          <ul [id]="listId" class="m-0 flex list-none flex-wrap gap-2 px-4 pb-4 pt-1">
            @for (f of labelled(); track f.field; let i = $index) {
              <li
                class="chip-in rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200"
                [style.animation-delay.ms]="delay(i)"
              >{{ f.label }}</li>
            }
          </ul>
        }
      </div>
    }
  `,
})
export class ContractExistingFields {
  readonly fields = input<readonly FieldOption[]>([]);

  protected readonly open = signal(false);
  protected readonly listId = `contract-existing-fields-${nextId++}`;

  protected readonly labelled = computed(() =>
    this.fields().map((f) => ({ field: f.field, label: fieldLabel(f.field, f.label) })),
  );

  protected readonly title = computed(() => {
    const n = this.fields().length;
    return n === 1 ? '1 dado já está no contrato' : `${n} dados já estão no contrato`;
  });

  protected readonly preview = computed(() => {
    const labels = this.labelled().map((f) => f.label);
    const shown = labels.slice(0, PREVIEW).join(', ');
    const rest = labels.length - PREVIEW;
    return rest > 0 ? `${shown} e mais ${rest}` : shown;
  });

  protected delay(index: number): number {
    return Math.min(index * STAGGER_MS, STAGGER_MAX_MS);
  }
}
