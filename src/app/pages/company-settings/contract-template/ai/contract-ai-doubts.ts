import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ContractAiService } from './contract-ai.service';
import { fieldLabel, safeText } from './contract-ai.messages';
import { FieldOption, SuggestionView } from './contract-ai.types';

const NONE = '__none__';

/**
 * Tela 3 — uma dúvida por vez. Trecho/contexto/motivo já chegam mascarados do backend; só
 * são exibidos como texto (interpolação escapa), nunca como HTML.
 */
@Component({
  selector: 'app-contract-ai-doubts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (current(); as d) {
      <div class="space-y-4">
        <p class="text-xs font-semibold text-neutral-500" aria-live="polite">
          Dúvida {{ index() + 1 }} de {{ doubts().length }}
        </p>

        <p
          class="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-800 break-words"
        >
          {{ parts().before }}<mark class="rounded bg-primary-100 px-1 font-semibold text-neutral-900">{{ parts().hit }}</mark>{{ parts().after }}
        </p>

        <fieldset class="space-y-2">
          <legend class="text-sm font-semibold text-neutral-900">
            Este trecho é qual campo?
          </legend>
          @for (opt of options(); track opt.field) {
            <label
              class="flex items-center gap-3 min-h-[48px] rounded-xl border px-3 cursor-pointer"
              [class.border-primary-500]="choice() === opt.field"
              [class.bg-primary-50]="choice() === opt.field"
              [class.border-neutral-200]="choice() !== opt.field"
            >
              <input
                type="radio"
                name="contract-ai-doubt"
                class="h-5 w-5 accent-primary-600"
                [value]="opt.field"
                [checked]="choice() === opt.field"
                (change)="choice.set(opt.field)"
              />
              <span class="text-sm text-neutral-900">{{ opt.label }}</span>
              @if (opt.field === d.field) {
                <span class="ml-auto text-xs text-neutral-500">sugerido</span>
              }
            </label>
          }
          <label
            class="flex items-center gap-3 min-h-[48px] rounded-xl border px-3 cursor-pointer"
            [class.border-primary-500]="choice() === none"
            [class.bg-primary-50]="choice() === none"
            [class.border-neutral-200]="choice() !== none"
          >
            <input
              type="radio"
              name="contract-ai-doubt"
              class="h-5 w-5 accent-primary-600"
              [value]="none"
              [checked]="choice() === none"
              (change)="choice.set(none)"
            />
            <span class="text-sm text-neutral-900">Não é um campo, manter o texto como está</span>
          </label>
        </fieldset>

        @if (d.reason) {
          <p class="text-xs text-neutral-500">Por que a IA ficou em dúvida: {{ reasonText() }}</p>
        }

        <div class="flex flex-col-reverse sm:flex-row gap-2">
          @if (index() > 0) {
            <button
              type="button"
              (click)="back()"
              [disabled]="svc.busy()"
              class="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Voltar
            </button>
          }
          <button
            type="button"
            (click)="next()"
            [disabled]="svc.busy()"
            class="w-full min-h-[48px] rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-[1.2rem] font-bold shadow-sm disabled:opacity-60"
          >
            @if (isLast()) { Ver como fica } @else { Próxima }
          </button>
        </div>
      </div>
    } @else {
      <p class="text-sm text-neutral-600">Não há dúvidas pendentes.</p>
    }
  `,
})
export class ContractAiDoubts {
  protected readonly svc = inject(ContractAiService);
  protected readonly none = NONE;

  protected readonly index = signal(0);
  protected readonly choice = signal<string | null>(null);

  protected readonly doubts = computed<SuggestionView[]>(() => this.svc.draft()?.doubts ?? []);
  protected readonly current = computed(() => this.doubts()[this.index()] ?? null);
  protected readonly isLast = computed(() => this.index() >= this.doubts().length - 1);

  protected readonly options = computed<FieldOption[]>(() => {
    const d = this.current();
    if (!d) return [];
    const list: FieldOption[] = [{ field: d.field, label: fieldLabel(d.field, d.fieldLabel) }];
    for (const alt of d.alternatives ?? []) {
      if (!list.some((o) => o.field === alt.field)) {
        list.push({ field: alt.field, label: fieldLabel(alt.field, alt.label) });
      }
    }
    return list;
  });

  /** Trecho destacado dentro do contexto; sem o trecho no contexto, mostra só o trecho. */
  protected readonly parts = computed(() => {
    const d = this.current();
    if (!d) return { before: '', hit: '', after: '' };
    const excerpt = safeText(d.excerpt);
    const context = safeText(d.context);
    const at = context.indexOf(excerpt);
    if (!excerpt || at < 0) return { before: '', hit: excerpt, after: '' };
    return {
      before: context.slice(0, at),
      hit: excerpt,
      after: context.slice(at + excerpt.length),
    };
  });

  protected reasonText(): string {
    return safeText(this.current()?.reason);
  }

  constructor() {
    this.syncChoice();
  }

  private syncChoice(): void {
    const d = this.current();
    if (!d) {
      this.choice.set(null);
      return;
    }
    const prior = this.svc.decisions()[d.id];
    // Sugestão pré-marcada; a resposta anterior vence quando o usuário volta.
    this.choice.set(prior ? (prior.accept ? prior.field : NONE) : d.field);
  }

  private record(): void {
    const d = this.current();
    const c = this.choice();
    if (!d || !c) return;
    this.svc.setDecision(
      c === NONE
        ? { id: d.id, field: d.field, accept: false }
        : { id: d.id, field: c, accept: true },
    );
  }

  protected next(): void {
    if (this.svc.busy()) return;
    this.record();
    if (!this.isLast()) {
      this.index.update((i) => i + 1);
      this.syncChoice();
      return;
    }
    // Certas sem decisão entram aceitas no backend; manda só o que o usuário respondeu.
    this.svc.commitDecisions();
  }

  protected back(): void {
    this.record();
    this.index.update((i) => Math.max(0, i - 1));
    this.syncChoice();
  }
}
