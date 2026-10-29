import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface ReasonOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
}

let nextId = 0;

/**
 * Motivo de LISTA FECHADA + observação opcional — o padrão das ações de admin
 * (regra da V45: a trilha guarda só o código; a nota livre fica fora dela).
 *
 * Reutilizável: `reason` e `note` são `model()`s, então funciona com
 * `[(reason)]`/`[(note)]` em qualquer formulário.
 * - opções como cartões de rádio NATIVOS (setas do teclado, leitor de tela e
 *   foco visível de graça), alvo de 48px, texto de 16px (evita o zoom do iOS);
 * - selecionado: borda e marcador na cor da marca;
 * - a observação some com `showNote=false`.
 */
@Component({
  selector: 'app-reason-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset data-testid="reason-picker">
      <legend class="text-sm font-medium text-fg-muted">{{ legend() }}</legend>
      <div class="mt-2 grid gap-2 sm:grid-cols-2">
        @for (opt of options(); track opt.value) {
          <label
            class="press flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5
                   transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-400"
            [class]="reason() === opt.value
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10'
              : 'border-edge hover:bg-canvas'"
            [attr.data-testid]="'reason-' + opt.value"
          >
            <input
              type="radio"
              class="mt-1 h-4 w-4 shrink-0 accent-primary-500"
              [name]="name"
              [value]="opt.value"
              [checked]="reason() === opt.value"
              (change)="reason.set(opt.value)"
            />
            <span class="min-w-0">
              <span class="block text-base text-fg">{{ opt.label }}</span>
              @if (opt.hint) {
                <span class="block text-xs text-fg-subtle">{{ opt.hint }}</span>
              }
            </span>
          </label>
        }
      </div>
    </fieldset>
    @if (showNote()) {
      <label class="mt-4 flex flex-col gap-1">
        <span class="text-sm font-medium text-fg-muted">Observação interna (opcional)</span>
        <textarea
          rows="2"
          maxlength="500"
          data-testid="reason-note"
          class="rounded-xl border border-edge-field bg-surface px-3 py-2 text-base text-fg
                 focus:outline-none focus:ring-2 focus:ring-primary-400"
          [value]="note()"
          (input)="note.set($any($event.target).value)"
        ></textarea>
        <span class="text-xs text-fg-subtle">Não vai para o cliente nem para a trilha de auditoria.</span>
      </label>
    }
  `,
})
export class ReasonPicker {
  readonly options = input.required<ReasonOption[]>();
  readonly legend = input('Motivo');
  readonly showNote = input(true);
  readonly reason = model<string | null>(null);
  readonly note = model('');

  protected readonly name = `reason-picker-${++nextId}`;
}
