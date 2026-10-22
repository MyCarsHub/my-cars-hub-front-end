import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FIELD_LABELS } from './ai/contract-ai.messages';
import { PaperParagraph } from './contract-paper.model';
import { fieldCode, fieldExample } from './contract-fields';

export type PaperMode = 'example' | 'names';

/**
 * O contrato ao vivo da esteira: uma folha com rolagem própria. Só desenha o que
 * `contract-paper.model.ts` montou; não há HTML vindo de fora (tudo é interpolação).
 */
@Component({
  selector: 'app-contract-paper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0 flex-col gap-3 bg-neutral-50 px-2 py-4 sm:p-6' },
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-[13px] font-semibold uppercase tracking-wide text-neutral-600">
        {{ title() }}
      </span>
      @if (showModeSwitch()) {
        <div
          role="radiogroup"
          aria-label="Mostrar no contrato"
          class="flex gap-1 rounded-xl bg-neutral-200/70 p-1"
        >
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="mode() === 'example'"
            (click)="modeChange.emit('example')"
            class="min-h-[44px] rounded-lg px-3 text-[13px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            [class]="mode() === 'example' ? onClass : offClass"
          >
            Com exemplo
          </button>
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="mode() === 'names'"
            (click)="modeChange.emit('names')"
            class="min-h-[44px] rounded-lg px-3 text-[13px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            [class]="mode() === 'names' ? onClass : offClass"
          >
            Com o nome dos campos
          </button>
        </div>
      }
    </div>

    @if (draft()) {
      <p
        class="self-start rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[13px] font-semibold text-amber-800"
      >
        Rascunho, aguardando revisão jurídica
      </p>
    }

    @if (loading()) {
      <div class="h-80 rounded-md bg-neutral-100 animate-pulse" aria-hidden="true"></div>
    } @else if (paragraphs().length === 0) {
      <div
        class="flex min-h-[320px] flex-1 items-center justify-center rounded-md border-2 border-dashed border-neutral-200 p-6 text-center text-[15px] text-neutral-600"
      >
        {{ emptyText() }}
      </div>
    } @else {
      <article
        [attr.aria-label]="title()"
        tabindex="0"
        class="mx-auto box-border flex w-full max-w-[760px] flex-1 flex-col gap-3.5 overflow-y-auto rounded bg-white px-4 py-6 shadow-sm sm:px-12 sm:py-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        [class]="split() ? 'max-h-[720px]' : 'max-h-[60vh]'"
      >
        @for (p of paragraphs(); track p.id) {
          <p
            class="m-0 rounded-md font-serif leading-[1.7] text-neutral-800 break-words transition-colors"
            [class]="paragraphClass(p)"
          >
            @for (s of p.segments; track $index) {
              @switch (s.kind) {
                @case ('text') {
                  <span [class.font-bold]="s.bold">{{ s.text }}</span>
                }
                @case ('field') {
                  @if (mode() === 'names') {
                    <span
                      [title]="label(s.field)"
                      class="rounded px-1 py-px font-mono text-[13px] font-semibold"
                      [class]="fieldClass(s.tone, s.focus)"
                    >{{ code(s.field) }}</span>
                  } @else {
                    <span
                      [title]="label(s.field)"
                      class="rounded px-1 py-px font-semibold"
                      [class]="fieldClass(s.tone, s.focus)"
                    >{{ example(s.field) }}</span>
                  }
                }
                @case ('hidden') {
                  <span class="rounded bg-neutral-200 px-1.5 py-px text-[13px] text-neutral-700">{{
                    s.label
                  }}</span>
                }
                @case ('kept') {
                  <span [class]="s.focus ? 'rounded outline-2 outline-amber-500' : ''">{{
                    s.text
                  }}</span>
                }
              }
            }
          </p>
        }
      </article>
    }
  `,
})
export class ContractPaper {
  readonly title = input('Contrato');
  readonly paragraphs = input<readonly PaperParagraph[]>([]);
  readonly mode = input<PaperMode>('example');
  readonly showModeSwitch = input(false);
  readonly emptyText = input('');
  readonly loading = input(false);
  readonly draft = input(false);
  /** Ao lado da etapa (rolagem até 720px) ou abaixo dela (até 60vh). */
  readonly split = input(false);
  readonly modeChange = output<PaperMode>();

  protected readonly onClass = 'bg-white text-neutral-900 shadow-sm';
  protected readonly offClass = 'bg-transparent text-neutral-600';

  protected paragraphClass(p: PaperParagraph): string {
    const base =
      p.role === 'title' ? 'text-center text-base font-bold' : 'text-left text-[15px]';
    return p.focus ? `${base} bg-primary-50 outline-2 outline-offset-4 outline-primary-200` : base;
  }

  protected fieldClass(tone: 'ok' | 'doubt', focus = false): string {
    const color =
      tone === 'doubt' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800';
    if (!focus) return color;
    return `${color} outline-2 ${tone === 'doubt' ? 'outline-amber-500' : 'outline-emerald-500'}`;
  }

  protected code(field: string): string {
    return fieldCode(field);
  }

  protected example(field: string): string {
    return fieldExample(field);
  }

  protected label(field: string): string {
    return FIELD_LABELS[field] ?? field;
  }
}
