import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ListChevron, ListGroup, ListRow } from '../../../../components/core/list-group/list-group';
import { VehicleStatus } from '../../../../types/vehicle.types';
import { VehicleIcon } from '../vehicle-icon/vehicle-icon';

export type VehicleStatusTarget = 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE';

/** Por que Marcar em manutenção e Marcar inativo não respondem enquanto há aluguel. */
export const RENTED_LOCK_REASON = 'Encerre o aluguel para alterar';

/** No vendido a frase longa fica no `title`; aqui ela se repetiria em cada linha. */
export const SOLD_LOCK_HINT = 'Desfaça a venda para alterar';

/**
 * As ações de operação do carro; Editar e Excluir ficam em `app-detail-actions`, no topo
 * da página. Ação travada continua visível, cinza e com o motivo embaixo: esconder
 * faria o operador procurar um bug onde existe uma regra. Quem chama a API é a página.
 */
@Component({
  selector: 'app-vehicle-actions-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  imports: [ListGroup, ListRow, ListChevron, VehicleIcon],
  template: `
    <app-list-group heading="Ações">
      @if (canGoAvailable()) {
        <button
          type="button"
          appListRow
          [locked]="!!lockReason()"
          [disabled]="busy() || !!lockReason()"
          [attr.title]="lockReason()"
          (click)="transition.emit('AVAILABLE')"
        >
          <span class="tile" aria-hidden="true"><app-vehicle-icon name="check" /></span>
          <span class="t">
            <b>Marcar disponível</b>
            @if (lockReason()) { <small>{{ soldHint }}</small> }
          </span>
          @if (!lockReason()) { <app-list-chevron /> }
        </button>
      }
      @if (status() !== 'MAINTENANCE') {
        <button
          type="button"
          appListRow
          [locked]="!!statusLock()"
          [disabled]="busy() || !!statusLock()"
          [attr.title]="statusLock()"
          (click)="transition.emit('MAINTENANCE')"
        >
          <span class="tile" aria-hidden="true"><app-vehicle-icon name="maintenance" /></span>
          <span class="t">
            <b>Marcar em manutenção</b>
            @if (statusHint(); as hint) { <small>{{ hint }}</small> }
          </span>
          @if (!statusLock()) { <app-list-chevron /> }
        </button>
      }
      @if (status() !== 'INACTIVE') {
        <button
          type="button"
          appListRow
          [locked]="!!statusLock()"
          [disabled]="busy() || !!statusLock()"
          [attr.title]="statusLock()"
          (click)="transition.emit('INACTIVE')"
        >
          <span class="tile" aria-hidden="true"><app-vehicle-icon name="pause" /></span>
          <span class="t">
            <b>Marcar inativo</b>
            @if (statusHint(); as hint) { <small>{{ hint }}</small> }
          </span>
          @if (!statusLock()) { <app-list-chevron /> }
        </button>
      }

      @if (sold()) {
        <button type="button" appListRow [disabled]="undoing()" (click)="undoSale.emit()">
          <span class="tile" aria-hidden="true"><app-vehicle-icon name="tag" /></span>
          <span class="t"><b>{{ undoing() ? 'Desfazendo…' : 'Desfazer venda' }}</b></span>
          <app-list-chevron />
        </button>
      } @else {
        <button type="button" appListRow (click)="sell.emit()">
          <span class="tile" aria-hidden="true"><app-vehicle-icon name="tag" /></span>
          <span class="t"><b>Vender</b></span>
          <app-list-chevron />
        </button>
      }

    </app-list-group>
  `,
})
export class VehicleActionsGroup {
  readonly status = input.required<VehicleStatus>();
  readonly sold = input(false);
  /** Motivo único do veículo vendido; nulo fora dele. */
  readonly lockReason = input<string | null>(null);
  readonly busy = input(false);
  readonly undoing = input(false);

  readonly transition = output<VehicleStatusTarget>();
  readonly sell = output<void>();
  readonly undoSale = output<void>();

  protected readonly soldHint = SOLD_LOCK_HINT;

  protected readonly canGoAvailable = computed(() => {
    const s = this.status();
    return s === 'MAINTENANCE' || s === 'INACTIVE';
  });

  protected readonly statusLock = computed(
    () => this.lockReason() ?? (this.status() === 'RENTED' ? RENTED_LOCK_REASON : null),
  );

  protected readonly statusHint = computed(() =>
    this.lockReason() ? SOLD_LOCK_HINT : this.statusLock(),
  );
}
