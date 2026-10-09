import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The four numbers of the page, in the Dashboard KPI-strip pattern (2x2 on phones, 4x1 on
 * lg). They describe the WHOLE company: the list's search and filters never change them.
 */
@Component({
  selector: 'app-members-kpis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (loading()) {
      <section class="grid gap-3 grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Resumo da equipe">
        @for (i of [1, 2, 3, 4]; track i) {
          <div class="rounded-2xl bg-white border border-neutral-200 p-4 min-w-0">
            <div class="h-3 w-14 rounded bg-neutral-100 animate-pulse"></div>
            <div class="h-8 mt-2 w-10 rounded bg-neutral-100 animate-pulse"></div>
          </div>
        }
      </section>
    } @else {
      <section class="grid gap-3 grid-cols-2 lg:grid-cols-4" aria-label="Resumo da equipe">
        <div data-kpi="total" class="rounded-2xl bg-primary-500 text-white p-4 min-w-0">
          <p class="text-[11px] sm:text-xs text-white/80 uppercase tracking-wide truncate">Total</p>
          <p class="text-xl sm:text-2xl font-semibold mt-1 tabular-nums truncate">{{ total() }}</p>
          <p class="text-[11px] sm:text-xs text-white/80 mt-1 truncate">com acesso à empresa</p>
        </div>
        <div data-kpi="management" class="rounded-2xl bg-emerald-700 text-white p-4 min-w-0">
          <p class="text-[11px] sm:text-xs text-white/80 uppercase tracking-wide truncate">Gestão</p>
          <p class="text-xl sm:text-2xl font-semibold mt-1 tabular-nums truncate">{{ management() }}</p>
          <p class="text-[11px] sm:text-xs text-white/80 mt-1 truncate">dono e gerenciadores</p>
        </div>
        <div
          data-kpi="drivers"
          class="rounded-2xl bg-success-100 text-success-900 p-4 min-w-0"
        >
          <p class="text-[11px] sm:text-xs text-success-900 uppercase tracking-wide truncate">Motoristas</p>
          <p class="text-xl sm:text-2xl font-semibold mt-1 tabular-nums truncate">{{ drivers() }}</p>
          <p class="text-[11px] sm:text-xs text-success-900 mt-1 truncate">com acesso pelo celular</p>
        </div>
        <div data-kpi="pending" class="rounded-2xl bg-white border border-neutral-200 p-4 min-w-0">
          <p class="text-[11px] sm:text-xs text-neutral-500 uppercase tracking-wide truncate">
            Convites pendentes
          </p>
          <p
            class="text-xl sm:text-2xl font-semibold mt-1 tabular-nums truncate"
            [class]="(pending() ?? 0) > 0 ? 'text-amber-700' : 'text-neutral-900'"
          >
            {{ pending() ?? '–' }}
          </p>
          <p data-kpi-detail class="text-[11px] sm:text-xs text-neutral-500 mt-1 truncate">
            {{ pendingDetail() }}
          </p>
        </div>
      </section>
    }
  `,
})
export class MembersKpis {
  readonly loading = input(false);
  readonly total = input.required<number>();
  readonly management = input.required<number>();
  readonly drivers = input.required<number>();
  /** `null` while the invites have not loaded. */
  readonly pending = input<number | null>(null);
  /** Expired invites waiting to be resent. */
  readonly expired = input(0);

  protected readonly pendingDetail = computed(() => {
    const n = this.expired();
    if (n === 0) return 'aguardando aceite';
    return n === 1 ? '1 expirado para reenviar' : n + ' expirados para reenviar';
  });
}
