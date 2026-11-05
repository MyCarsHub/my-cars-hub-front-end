import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Subject, catchError, debounceTime, distinctUntilChanged, map, merge, of, switchMap } from 'rxjs';
import { AlertBanner } from '../../alert-banner/alert-banner';
import { ApiErrorService } from '../../../services/api-error.service';
import { FleetFinanceService } from '../../../services/fleet-finance.service';
import { VehiclePickerFilter } from '../../../types/fleet-finance.types';
import { VehicleListItem } from '../../../types/vehicle.types';

/** Espera depois da última tecla antes de perguntar ao servidor. */
export const PICKER_DEBOUNCE_MS = 250;

/** `ABC1D23` → `ABC-1D23`; o resto sai como veio. */
export function pickerPlate(plate: string | null | undefined): string {
  const p = (plate ?? '').toUpperCase();
  return p.length === 7 ? `${p.slice(0, 3)}-${p.slice(3)}` : p || '—';
}

type Load = { readonly state: 'loading' } | { readonly state: 'error'; readonly message: string } | {
  readonly state: 'ready';
  readonly items: readonly VehicleListItem[];
  readonly total: number;
};

/**
 * Corpo do seletor de veículo das folhas "Adicionar …" (IPVA, financiamento, seguro): busca e
 * lista, sem folha própria — quem usa decide o que vem depois da escolha. O servidor já devolve
 * só os carros que ainda não têm aquilo (`filter`).
 */
@Component({
  selector: 'app-vehicle-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [ReactiveFormsModule, AlertBanner],
  template: `
    <div class="space-y-3" data-testid="vehicle-picker">
      <div class="relative">
        <label for="vehicle-picker-search" class="sr-only">Buscar veículo</label>
        <span class="absolute inset-y-0 left-3 flex items-center text-fg-faint" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          id="vehicle-picker-search"
          type="search"
          inputmode="search"
          autocomplete="off"
          [formControl]="search"
          placeholder="Placa, marca ou modelo…"
          data-testid="picker-search"
          class="w-full min-h-[48px] pl-9 pr-3 text-base border border-edge-field rounded-xl bg-surface
                 text-fg focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
      </div>

      @switch (load().state) {
        @case ('loading') {
          <div class="space-y-2" role="status" aria-label="Carregando veículos" data-testid="picker-loading">
            @for (i of [1, 2, 3]; track i) {
              <div class="h-14 rounded-xl bg-surface-sunken animate-pulse motion-reduce:animate-none"></div>
            }
          </div>
        }
        @case ('error') {
          <app-alert-banner variant="error" data-testid="picker-error">
            {{ errorMessage() }}
            <button type="button" class="ml-2 underline font-semibold min-h-11 px-1" (click)="retry()">
              Tentar novamente
            </button>
          </app-alert-banner>
        }
        @default {
          @if (items().length === 0) {
            <p class="rounded-xl border border-dashed border-edge-strong p-5 text-center text-sm font-semibold text-fg" data-testid="picker-empty">
              {{ search.value.trim() ? 'Nenhum veículo encontrado com essa busca.' : emptyText() }}
            </p>
          } @else {
            <ul class="flex flex-col gap-1" aria-label="Veículos">
              @for (v of items(); track v.id; let i = $index) {
                <li>
                  <button
                    type="button"
                    data-testid="picker-option"
                    (click)="picked.emit(v)"
                    class="enter-up press press-soft w-full min-h-[56px] px-3 py-2 rounded-xl text-left flex items-center gap-3
                           hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    [style.--stagger-i]="i"
                  >
                    <span class="min-w-0 flex-1">
                      <b class="block text-base font-semibold text-fg tabular-nums tracking-wider">{{ plate(v.plate) }}</b>
                      <small class="block text-xs text-fg-subtle truncate">{{ v.brand }} {{ v.model }} · {{ v.yearModel }}</small>
                    </span>
                    <svg class="shrink-0 text-fg-faint" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </li>
              }
            </ul>
            @if (total() > items().length) {
              <p class="text-xs text-fg-subtle text-center" data-testid="picker-more">
                Mostrando {{ items().length }} de {{ total() }}. Busque pela placa para achar os outros.
              </p>
            }
          }
        }
      }
    </div>
  `,
})
export class VehiclePicker implements OnInit {
  private readonly service = inject(FleetFinanceService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly filter = input.required<VehiclePickerFilter>();
  readonly emptyText = input('Todos os veículos da frota já têm esse cadastro.');
  readonly picked = output<VehicleListItem>();

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly load = signal<Load>({ state: 'loading' });
  protected readonly items = signal<readonly VehicleListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly errorMessage = signal('');
  private readonly retry$ = new Subject<void>();

  protected readonly plate = pickerPlate;

  ngOnInit(): void {
    const typed = this.search.valueChanges.pipe(debounceTime(PICKER_DEBOUNCE_MS), distinctUntilChanged());
    merge(of(''), typed, this.retry$.pipe(map(() => this.search.value)))
      .pipe(
        switchMap((q) => {
          this.load.set({ state: 'loading' });
          return this.service.pickVehicles(this.filter(), q).pipe(
            map((res): Load => ({ state: 'ready', items: res.content ?? [], total: res.total ?? 0 })),
            catchError((err: unknown) =>
              of<Load>({
                state: 'error',
                message: this.apiErrors.messageFor(err, 'Não foi possível carregar os veículos.'),
              }),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.load.set(result);
        if (result.state === 'ready') {
          this.items.set(result.items);
          this.total.set(result.total);
        } else if (result.state === 'error') {
          this.errorMessage.set(result.message);
        }
      });
  }

  protected retry(): void {
    this.retry$.next();
  }
}
