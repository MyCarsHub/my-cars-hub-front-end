import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

let nextId = 0;

/** Hoje (yyyy-MM-dd) no fuso do negócio — o mesmo "hoje" que o backend usa. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  // en-CA formata como yyyy-MM-dd.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Campo de UMA data (yyyy-MM-dd), reutilizável. `value` é `model()` — use `[(value)]`.
 *
 * - `<input type="date">` nativo: o seletor do iOS/Android de graça, teclado e leitor de tela;
 * - 16px e alvo de 48px (abaixo de 16px o iOS dá zoom no foco);
 * - `min`/`max` limitam o seletor; fora deles o campo mostra o erro em texto e
 *   `valid` (sinal público) fica falso — quem usa decide o botão de confirmar.
 */
@Component({
  selector: 'app-date-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="flex flex-col gap-1" [attr.for]="id">
      <span class="text-sm font-medium text-fg-muted">{{ label() }}</span>
      <input
        type="date"
        [id]="id"
        data-testid="date-field-input"
        class="min-h-12 w-full sm:max-w-xs rounded-xl border bg-surface px-3 text-base text-fg tabular-nums
               focus:outline-none focus:ring-2 focus:ring-primary-400"
        [class]="error() ? 'border-rose-500' : 'border-edge-field'"
        [value]="value()"
        [attr.min]="min()"
        [attr.max]="max()"
        [attr.aria-invalid]="error() ? true : null"
        [attr.aria-describedby]="id + '-help'"
        (input)="value.set($any($event.target).value)"
      />
      <span [id]="id + '-help'" class="text-xs" [class]="error() ? 'text-rose-700 dark:text-rose-300' : 'text-fg-subtle'"
            data-testid="date-field-help">
        {{ error() ?? hint() }}
      </span>
    </label>
  `,
})
export class DateField {
  readonly label = input.required<string>();
  readonly hint = input<string>('');
  /** yyyy-MM-dd */
  readonly min = input<string | null>(null);
  /** yyyy-MM-dd */
  readonly max = input<string | null>(null);
  readonly value = model('');

  protected readonly id = `date-field-${++nextId}`;

  /** Mensagem de erro, ou null. Comparação de texto: yyyy-MM-dd ordena como data. */
  readonly error = computed<string | null>(() => {
    const v = this.value();
    if (!v) return 'Informe a data.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Data inválida.';
    const max = this.max();
    const min = this.min();
    if (max && v > max) return 'A data não pode ser depois de ' + br(max) + '.';
    if (min && v < min) return 'A data não pode ser antes de ' + br(min) + '.';
    return null;
  });

  readonly valid = computed(() => this.error() === null);
}

function br(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
