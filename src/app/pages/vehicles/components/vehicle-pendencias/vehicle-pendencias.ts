import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ListChevron, ListGroup, ListRow } from '../../../../components/core/list-group/list-group';
import { StatusChip } from '../../../../components/core/status-chip/status-chip';
import { VehiclePendencia } from '../../../../types/vehicle-pendencia.types';
import {
  brl,
  fullDate,
  overdueLabel,
  pendenciaChip,
  pendenciaDetail,
  pendenciaIcon,
  pendenciaKm,
  pendenciaRoute,
  pendenciaTile,
  pendenciaTitle,
} from '../../vehicle-page.model';
import { VehicleIcon } from '../vehicle-icon/vehicle-icon';

/**
 * Lista única, na ordem que o backend mandou. Cada linha abre onde a coisa se resolve:
 * esta tela nunca resolve nada. Linhas no celular, tabela a partir de `lg`.
 */
@Component({
  selector: 'app-vehicle-pendencias',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  imports: [RouterLink, ListGroup, ListRow, ListChevron, StatusChip, VehicleIcon],
  template: `
    <app-list-group heading="Pendências">
      @if (rows().length) {
        <span groupNote data-pendencias-note class="whitespace-nowrap pt-[22px] pb-2 px-1.5 text-[13px] font-semibold text-fg-muted">
          @if (lateNote(); as late) {
            <b class="font-semibold text-primary-700 dark:text-primary-300">{{ late }}</b>,
          }
          {{ rows().length }} no total
        </span>
      }

      @if (rows().length === 0) {
        <div appListRow data-pendencias-empty>
          <span class="tile" aria-hidden="true"><app-vehicle-icon name="check" /></span>
          <span class="t">
            <b>Nada a resolver</b>
            <small>Quando surgir multa, vencimento ou parcela, aparece aqui.</small>
          </span>
        </div>
      } @else {
        <table class="hidden lg:table w-full border-collapse">
          <caption class="sr-only">Pendências do veículo</caption>
          <thead>
            <tr>
              <th scope="col" [class]="th">Pendência</th>
              <th scope="col" [class]="th">Vencimento</th>
              <th scope="col" [class]="th">Situação</th>
              <th scope="col" [class]="th + ' text-right'">Valor</th>
              <th scope="col" [class]="th"><span class="sr-only">Resolver</span></th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr
                [attr.data-pendencia]="r.type"
                class="border-t border-edge first:border-t-0 hover:bg-surface-muted transition-colors"
              >
                <td [class]="td">
                  <span class="flex items-center gap-3">
                    <span [class]="tileClass(r.tile)" aria-hidden="true">
                      <app-vehicle-icon [name]="r.icon" />
                    </span>
                    <span class="min-w-0">
                      <b class="block font-semibold text-fg">{{ r.title }}</b>
                      <small class="block text-[13px] text-fg-muted">{{ r.description }}</small>
                    </span>
                  </span>
                </td>
                <td [class]="td + ' whitespace-nowrap'">{{ r.when }}</td>
                <td [class]="td">
                  <app-status-chip size="sm" [tone]="r.chip.tone">{{ r.chip.label }}</app-status-chip>
                </td>
                <td [class]="td + ' text-right whitespace-nowrap'">
                  @if (r.amount; as amount) {
                    <span
                      class="text-sm font-semibold tabular-nums"
                      [class.text-fg]="!r.late"
                      [class.text-primary-700]="r.late"
                      [class.dark:text-primary-300]="r.late"
                    >{{ amount }}</span>
                  } @else {
                    <span class="text-fg-muted">—</span>
                  }
                </td>
                <td [class]="td + ' text-right'">
                  <a
                    [routerLink]="r.route"
                    [attr.aria-label]="'Resolver ' + r.title + ', ' + r.description"
                    class="press inline-grid place-items-center size-11 rounded-[9px]
                           focus-visible:outline-2 focus-visible:outline-primary-400"
                  >
                    <span class="grid place-items-center size-8 rounded-[9px] bg-surface-sunken">
                      <app-list-chevron />
                    </span>
                  </a>
                </td>
              </tr>
            }
          </tbody>
        </table>

        <div class="lg:hidden">
          @for (r of rows(); track r.id) {
            <a
              appListRow
              [routerLink]="r.route"
              [attr.data-pendencia]="r.type"
              [attr.aria-label]="r.title + ', ' + r.description + ', ' + r.chip.label"
            >
              <span class="tile" [class.hot]="r.tile === 'hot'" [class.tint]="r.tile === 'tint'" aria-hidden="true">
                <app-vehicle-icon [name]="r.icon" />
              </span>
              <span class="t">
                <span class="l1">
                  <b>{{ r.title }}</b>
                  <app-status-chip size="sm" [tone]="r.chip.tone">{{ r.chip.label }}</app-status-chip>
                </span>
                <small>{{ r.detail }}</small>
              </span>
              <app-list-chevron />
            </a>
          }
        </div>
      }
    </app-list-group>
  `,
})
export class VehiclePendencias {
  readonly items = input.required<readonly VehiclePendencia[]>();

  protected readonly th =
    'text-left text-[12.5px] font-semibold text-fg-muted px-3 xl:px-4 pt-3.5 pb-2.5 border-b border-edge';
  protected readonly td =
    'px-3 xl:px-4 py-2.5 text-[14.5px] text-fg-body align-middle';

  protected readonly lateNote = computed(() => overdueLabel(this.items()));

  protected readonly rows = computed(() =>
    this.items().map((p) => ({
      id: p.id,
      type: p.type,
      title: pendenciaTitle(p),
      icon: pendenciaIcon(p),
      description: p.description,
      detail: pendenciaDetail(p),
      chip: pendenciaChip(p),
      tile: pendenciaTile(p),
      route: pendenciaRoute(p),
      late: p.urgency === 'OVERDUE',
      when: p.dueDate
        ? fullDate(p.dueDate)
        : p.dueHodometer !== null
          ? pendenciaKm(p.dueHodometer)
          : '—',
      amount: p.amountCents === null ? null : brl(p.amountCents),
    })),
  );

  /** Na tabela não há `[appListRow]`, então o quadro usa as mesmas medidas em utilitários. */
  protected tileClass(tile: 'hot' | 'tint' | ''): string {
    const color =
      tile === 'hot'
        ? 'bg-primary-500 text-white'
        : tile === 'tint'
          ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-500 dark:text-primary-400'
          : 'bg-surface-sunken text-fg';
    return `size-8 rounded-lg grid place-items-center flex-none ${color}`;
  }
}
