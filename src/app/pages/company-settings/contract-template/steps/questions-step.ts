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
import { FIELD_KEYS, plainFieldLabel } from '../contract-fields';
import { humanizeMasked } from '../contract-paper.model';

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
  imports: [FormField, FieldControl],
  template: `
    @if (index() === 0 && doubts().length > 0) {
      <div role="status" class="flex items-center gap-2.5 rounded-xl bg-emerald-50 px-4 py-3 text-[15px] text-emerald-900">
        <svg class="shrink-0" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" /></svg>
        <span>{{ foundText() }}</span>
      </div>
    }

    @if (current(); as d) {
      <div class="flex flex-col gap-1.5">
        <span aria-live="polite" class="text-sm font-semibold text-neutral-600">
          Pergunta {{ index() + 1 }} de {{ doubts().length }}
        </span>
        <h3 class="m-0 text-xl font-bold leading-snug text-neutral-900 break-words">
          O que é «{{ quote().hit }}» no seu contrato?
        </h3>
      </div>
      <p class="m-0 border-l-4 border-amber-200 py-1 pl-3.5 text-base leading-relaxed text-neutral-700 break-words">
        {{ quote().before }}<mark class="rounded bg-amber-100 px-1 font-bold text-neutral-900">{{ quote().hit }}</mark>{{ quote().after }}
      </p>
      <div role="radiogroup" aria-label="Escolha uma resposta" class="flex flex-col gap-2.5">
        @for (a of answers(); track a.value) {
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="choice() === a.value"
            (click)="pick(d, a.value)"
            class="flex min-h-[60px] w-full items-center gap-3.5 rounded-2xl border-2 px-4 py-3 text-left hover:border-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            [class]="choice() === a.value ? 'border-primary-500 bg-primary-50' : 'border-neutral-200 bg-white'"
          >
            <span aria-hidden="true"
              class="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2"
              [class]="choice() === a.value ? 'border-primary-500' : 'border-neutral-400'">
              @if (choice() === a.value) {
                <span class="h-2.5 w-2.5 rounded-full bg-primary-500"></span>
              }
            </span>
            <span class="flex flex-1 flex-col gap-0.5">
              <span class="text-base font-semibold text-neutral-900">{{ a.label }}</span>
              @if (a.suggested) {
                {{ ' ' }}<span class="text-[13px] font-semibold text-primary-700">Mais provável</span>
              }
            </span>
          </button>
        }
      </div>
    }

    @if (certain().length > 0) {
      <div class="border-t border-neutral-100 pt-1">
        <button type="button" (click)="open.set(!open())" [attr.aria-expanded]="open()"
          aria-controls="contract-ai-certain"
          class="flex min-h-[52px] w-full items-center gap-2 text-left text-[15px] font-semibold text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
          <span class="flex-1">{{ open() ? 'Esconder' : 'Corrigir' }} os {{ certain().length }} dados que a IA já marcou</span>
          <svg class="transition-transform" [class.rotate-180]="open()" xmlns="http://www.w3.org/2000/svg" width="18"
            height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        @if (open()) {
          <div id="contract-ai-certain" class="flex flex-col">
            @for (s of certain(); track s.id) {
              <div class="border-t border-neutral-100 py-2.5" (mouseenter)="focused.emit(s.id)">
                <app-form-field [label]="excerpt(s)">
                  <select
                    appFieldControl
                    class="min-h-[44px] w-full rounded-xl border bg-white px-3 text-base text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400"
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
  protected readonly current = computed(() => this.doubts()[this.index()] ?? null);

  protected readonly foundText = computed(() => {
    const n = this.certain().length;
    const q = this.doubts().length;
    const marked = n === 1 ? 'A IA marcou 1 dado sozinha.' : `A IA marcou ${n} dados sozinha.`;
    const left = q === 1 ? 'Só falta 1 pergunta rápida.' : `Só faltam ${q} perguntas rápidas.`;
    return `${marked} ${left}`;
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
