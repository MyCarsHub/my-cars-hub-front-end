import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormField, FieldControl } from '../../../../components/form-field/form-field';
import { ContractAiService } from '../ai/contract-ai.service';
import { FIELD_LABELS, safeText } from '../ai/contract-ai.messages';
import { SuggestionView } from '../ai/contract-ai.types';
import { ContractExistingFields } from '../contract-existing-fields';
import { FIELD_KEYS, plainFieldLabel } from '../contract-fields';
import { humanizeMasked } from '../contract-paper.model';
import { ContractIcon } from '../contract-icon';

export const KEEP_TEXT = '__none__';

interface Answer {
  value: string;
  label: string;
  suggested: boolean;
}

/** No máximo três respostas além de «Nenhum desses» (README: 3–4 respostas). */
const MAX_ANSWERS = 3;

/**
 * «Ajustar o meu contrato», etapa 3: uma pergunta por vez, sem selects. Cada toque grava a
 * decisão no `ContractAiService` (o PUT só sai no fim). A lista recolhida «Corrigir os N
 * dados» é para quem quer revisar o que a IA marcou sozinha.
 */
@Component({
  selector: 'app-contract-questions-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  imports: [FormField, FieldControl, ContractIcon, ContractExistingFields],
  // Trecho citado com a mesma fonte de documento do contrato ao vivo.
  styles: `
    .doc-serif {
      font-family: Cambria, 'Times New Roman', 'Noto Serif', serif;
    }
  `,
  template: `
    @if (index() === 0 && doubts().length > 0) {
      <div role="status" class="flex items-start gap-3 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3.5 text-[15px] leading-snug text-emerald-900 dark:text-emerald-200">
        <span aria-hidden="true" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
          <app-contract-icon name="sparkles" [size]="18" />
        </span>
        <span class="pt-1.5">{{ foundText() }}</span>
      </div>
    }

    @if (current(); as d) {
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-3">
          <span aria-live="polite" class="text-sm font-semibold text-primary-700 dark:text-primary-400">
            Pergunta {{ index() + 1 }} de {{ doubts().length }}
          </span>
          <span aria-hidden="true" class="flex gap-1">
            @for (q of doubts(); track q.id; let i = $index) {
              <span class="h-1.5 rounded-full transition-all duration-300"
                [class]="i < index() ? 'w-3 bg-emerald-500' : i === index() ? 'w-6 bg-primary-500' : 'w-3 bg-surface-strong'"></span>
            }
          </span>
        </div>
        <h3 data-step-heading tabindex="-1" class="m-0 text-xl font-bold leading-snug text-fg break-words focus:outline-none sm:text-2xl">
          O que é «{{ quote().hit }}» no seu contrato?
        </h3>
      </div>
      <figure class="m-0 flex flex-col gap-1.5">
        <figcaption class="text-[13px] font-semibold text-fg-muted">Está assim no seu contrato:</figcaption>
        <blockquote class="m-0 rounded-r-xl border-l-4 border-amber-400 bg-amber-50/50 dark:bg-amber-500/10 py-2.5 pl-3.5 pr-3 doc-serif text-base leading-relaxed text-fg-body break-words">
          {{ quote().before }}<mark class="rounded-[3px] border-b-2 border-amber-500 bg-amber-100 dark:bg-amber-500/15 px-0.5 font-bold text-fg">{{ quote().hit }}</mark>{{ quote().after }}
        </blockquote>
      </figure>
      <div role="radiogroup" aria-label="Escolha uma resposta" class="flex flex-col gap-2.5">
        @for (a of answers(); track a.value) {
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="choice() === a.value"
            (click)="pick(d, a.value)"
            class="flex min-h-[60px] w-full items-center gap-3.5 rounded-2xl border-2 px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            [class]="choice() === a.value ? 'border-primary-500 bg-surface shadow-sm' : 'border-edge bg-surface hover:border-neutral-400 dark:hover:border-neutral-500'"
          >
            <span aria-hidden="true"
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
              [class]="choice() === a.value ? 'border-primary-500 bg-primary-500' : 'border-neutral-400 dark:border-neutral-500 bg-surface'">
              @if (choice() === a.value) {
                <span class="h-2.5 w-2.5 rounded-full bg-surface"></span>
              }
            </span>
            <span class="flex flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              <span class="text-base font-semibold text-fg">{{ a.label }}</span>
              @if (a.suggested) {
                {{ ' ' }}<span class="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-[13px] font-semibold text-amber-900 dark:text-amber-200 ring-1 ring-amber-200 dark:ring-amber-500/30"><app-contract-icon name="sparkles" [size]="12" [stroke]="2.5" />Mais provável</span>
              }
            </span>
          </button>
        }
      </div>
    }

    <app-contract-existing-fields [fields]="existing()" />

    @if (certain().length > 0) {
      <div class="rounded-2xl bg-surface-muted px-1">
        <button type="button" (click)="open.set(!open())" [attr.aria-expanded]="open()"
          aria-controls="contract-ai-certain"
          class="flex min-h-[52px] w-full items-center gap-2.5 rounded-2xl px-3 text-left text-[15px] font-semibold text-fg-body focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
          <app-contract-icon name="pen" [size]="18" class="text-fg-muted" />
          <span class="flex-1">{{ correctLabel() }}</span>
          <app-contract-icon name="chevronDown" [size]="18" class="text-fg-muted transition-transform" [class.rotate-180]="open()" />
        </button>
        @if (open()) {
          <div id="contract-ai-certain" class="flex flex-col px-3 pb-2">
            @for (s of certain(); track s.id) {
              <div class="border-t border-edge py-2.5" (mouseenter)="focused.emit(s.id)">
                <app-form-field [label]="excerpt(s)">
                  <select
                    appFieldControl
                    class="min-h-[44px] w-full rounded-xl border bg-surface px-3 text-base text-fg focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400"
                    (focus)="focused.emit(s.id)"
                    (change)="correct(s, $any($event.target).value)"
                  >
                    @for (key of fieldKeys; track key) {
                      <option [value]="key" [selected]="certainValue(s) === key">{{ labels[key] }}</option>
                    }
                    <option [value]="keep" [selected]="certainValue(s) === keep">Não é campo, manter o texto</option>
                  </select>
                </app-form-field>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
})
export class ContractQuestionsStep {
  protected readonly svc = inject(ContractAiService);
  readonly index = input(0);
  readonly focused = output<string>();

  protected readonly keep = KEEP_TEXT;
  protected readonly fieldKeys = FIELD_KEYS;
  protected readonly labels = FIELD_LABELS;
  protected readonly open = signal(false);

  protected readonly doubts = computed<SuggestionView[]>(() => this.svc.draft()?.doubts ?? []);
  protected readonly certain = computed<SuggestionView[]>(() => this.svc.draft()?.certain ?? []);
  protected readonly existing = this.svc.existingFields;
  protected readonly current = computed(() => this.doubts()[this.index()] ?? null);

  protected readonly foundText = computed(() => {
    const had = this.existing().length;
    const n = this.certain().length;
    const q = this.doubts().length;
    const left = q === 1 ? 'Só falta 1 pergunta rápida.' : `Só faltam ${q} perguntas rápidas.`;
    if (had === 0) {
      const marked = n === 1 ? 'A IA marcou 1 dado sozinha.' : `A IA marcou ${n} dados sozinha.`;
      return `${marked} ${left}`;
    }
    const found = had === 1 ? 'Seu contrato já tinha 1 dado.' : `Seu contrato já tinha ${had} dados.`;
    if (n === 0) return `${found} ${left}`;
    return `${found} A IA marcou mais ${n}. ${left}`;
  });

  protected readonly correctLabel = computed(() => {
    const verb = this.open() ? 'Esconder' : 'Corrigir';
    const n = this.certain().length;
    return n === 1 ? `${verb} o dado que a IA já marcou` : `${verb} os ${n} dados que a IA já marcou`;
  });

  protected readonly answers = computed<Answer[]>(() => {
    const d = this.current();
    if (!d) return [];
    const fields = [d.field, ...(d.alternatives ?? []).map((a) => a.field)];
    const unique = [...new Set(fields)].slice(0, MAX_ANSWERS);
    const out: Answer[] = unique.map((field, i) => ({
      value: field,
      label: plainFieldLabel(field, field === d.field ? d.fieldLabel : null),
      suggested: i === 0,
    }));
    out.push({ value: KEEP_TEXT, label: 'Nenhum desses. Deixar sempre igual', suggested: false });
    return out;
  });

  /** A resposta gravada vence; sem resposta, a sugestão vem marcada (o «Próxima» a aceita). */
  protected readonly choice = computed(() => {
    const d = this.current();
    if (!d) return null;
    const prior = this.svc.decisions()[d.id];
    if (!prior) return d.field;
    return prior.accept ? prior.field : KEEP_TEXT;
  });

  protected readonly quote = computed(() => {
    const d = this.current();
    if (!d) return { before: '', hit: '', after: '' };
    const hit = humanizeMasked(safeText(d.excerpt));
    const context = humanizeMasked(safeText(d.context));
    const at = context.indexOf(hit);
    if (!hit || at < 0) return { before: '', hit, after: '' };
    const before = context.slice(0, at);
    const after = context.slice(at + hit.length);
    return {
      before: before.length > 70 ? '…' + before.slice(-70) : before,
      hit,
      after: after.length > 70 ? after.slice(0, 70) + '…' : after,
    };
  });

  protected pick(d: SuggestionView, value: string): void {
    this.focused.emit(d.id);
    this.svc.setDecision(
      value === KEEP_TEXT
        ? { id: d.id, field: d.field, accept: false }
        : { id: d.id, field: value, accept: true },
    );
  }

  protected excerpt(s: SuggestionView): string {
    return humanizeMasked(safeText(s.excerpt));
  }

  protected certainValue(s: SuggestionView): string {
    const d = this.svc.decisions()[s.id];
    if (!d) return s.field;
    return d.accept ? d.field : KEEP_TEXT;
  }

  protected correct(s: SuggestionView, value: string): void {
    this.svc.setDecision(
      value === KEEP_TEXT
        ? { id: s.id, field: s.field, accept: false }
        : { id: s.id, field: value, accept: true },
    );
  }
}
