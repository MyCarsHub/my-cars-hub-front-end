import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { formatPersonName } from '../../../utils/display-format';

/** O mínimo que o seletor precisa de um motorista. */
export interface DriverPickerItem {
  readonly id: string;
  readonly name: string;
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Filtra por nome, sem acento nem caixa; busca vazia devolve tudo. */
export function filterDrivers<T extends DriverPickerItem>(items: readonly T[], query: string): T[] {
  const q = fold(query.trim());
  return q ? items.filter((d) => fold(d.name ?? '').includes(q)) : [...items];
}

/**
 * Corpo do seletor de motorista: busca e lista, sem folha própria — quem usa coloca dentro de
 * `app-bottom-sheet` (folha no celular, diálogo no desktop), como o `app-vehicle-picker`.
 *
 * Existe porque o `<select>` nativo deixa a lista aberta por conta do navegador: no Chrome do
 * desktop em tema escuro ela abriu mais estreita que o campo e com o texto cortado à esquerda.
 * A lista já vem carregada por quem usa; a busca é local.
 */
@Component({
  selector: 'app-driver-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="space-y-3" data-testid="driver-picker">
      <div class="relative">
        <label [for]="searchId" class="sr-only">Buscar motorista</label>
        <span class="absolute inset-y-0 left-3 flex items-center text-fg-faint" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          [id]="searchId"
          type="search"
          inputmode="search"
          autocomplete="off"
          placeholder="Nome do motorista…"
          data-testid="driver-picker-search"
          [value]="query()"
          (input)="onSearch($event)"
          class="w-full min-h-[48px] pl-9 pr-3 text-base border border-edge-field rounded-xl bg-surface
                 text-fg focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
      </div>

      @if (visible().length === 0) {
        <p class="rounded-xl border border-dashed border-edge-strong p-5 text-center text-sm font-semibold text-fg"
           data-testid="driver-picker-empty">
          {{ query().trim() ? 'Nenhum motorista encontrado com essa busca.' : emptyText() }}
        </p>
      } @else {
        <ul class="flex flex-col gap-1" aria-label="Motoristas">
          @for (d of visible(); track d.id; let i = $index) {
            <li>
              <button
                type="button"
                data-testid="driver-picker-option"
                [attr.aria-current]="d.id === selectedId() ? 'true' : null"
                (click)="picked.emit(d)"
                class="enter-up press press-soft w-full min-h-[56px] px-3 py-2 rounded-xl text-left flex items-center gap-3
                       hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                [class.bg-primary-50]="d.id === selectedId()"
                [class.dark:bg-primary-500/10]="d.id === selectedId()"
                [style.--stagger-i]="i"
              >
                <span class="min-w-0 flex-1 block text-base font-semibold text-fg truncate">{{ label(d.name) }}</span>
                @if (d.id === selectedId()) {
                  <svg class="shrink-0 text-primary-600 dark:text-primary-400" xmlns="http://www.w3.org/2000/svg" width="18" height="18"
                       viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
                       stroke-linejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                }
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class DriverPicker {
  readonly drivers = input.required<readonly DriverPickerItem[]>();
  readonly selectedId = input<string>('');
  readonly emptyText = input('Nenhum motorista cadastrado nesta empresa.');
  readonly picked = output<DriverPickerItem>();

  private static nextId = 0;
  protected readonly searchId = `driver-picker-search-${++DriverPicker.nextId}`;
  protected readonly query = signal('');
  protected readonly visible = computed(() => filterDrivers(this.drivers(), this.query()));
  protected readonly label = formatPersonName;

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
}
