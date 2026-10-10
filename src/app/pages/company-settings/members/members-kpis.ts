import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { KpiCard } from '../../../components/kpi-card/kpi-card';

/**
 * The four numbers of the page, in the Dashboard KPI-strip pattern (2x2 on phones, 4x1 on
 * lg), drawn by the Dashboard's own `KpiCard` and its existing looks: Total is the orange
 * fill, Gestão the dark-green fill, Motoristas the green fill and Convites pendentes the
 * white card. They describe the WHOLE company: the list's search and filters never change
 * them.
 */
@Component({
  selector: 'app-members-kpis',
  imports: [KpiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="grid gap-3 grid-cols-2 lg:grid-cols-4"
      aria-label="Resumo da equipe"
      [attr.aria-busy]="loading() ? 'true' : null"
    >
      <div
        app-kpi-card
        data-kpi="total"
        variant="primary"
        label="Total"
        [loading]="loading()"
        [value]="total()"
        detail="com acesso à empresa"
      ></div>
      <div
        app-kpi-card
        data-kpi="management"
        variant="emerald-dark"
        label="Gestão"
        [loading]="loading()"
        [value]="management()"
        detail="dono e gerenciadores"
      ></div>
      <div
        app-kpi-card
        data-kpi="drivers"
        variant="emerald"
        label="Motoristas"
        [loading]="loading()"
        [value]="drivers()"
        detail="com acesso pelo celular"
      ></div>
      <div
        app-kpi-card
        data-kpi="pending"
        variant="white"
        label="Convites pendentes"
        [loading]="loading()"
        [value]="pending() ?? '–'"
        [detail]="pendingDetail()"
      ></div>
    </section>
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
