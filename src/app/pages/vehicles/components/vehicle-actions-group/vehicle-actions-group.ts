import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ListChevron, ListGroup, ListRow } from '../../../../components/core/list-group/list-group';
import { VehicleStatus } from '../../../../types/vehicle.types';
import { VehicleIcon } from '../vehicle-icon/vehicle-icon';

export type VehicleStatusTarget = 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE';

/** Por que Marcar em manutenção e Marcar inativo não respondem enquanto há aluguel. */
export const RENTED_LOCK_REASON = 'Encerre o aluguel para alterar';

/**
 * As ações do carro. Ação travada continua visível, cinza e com o motivo embaixo: esconder
 * faria o operador procurar um bug onde existe uma regra. Quem chama a API é a página.
 */
@Component({
  selector: 'app-vehicle-actions-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  imports: [RouterLink, ListGroup, ListRow, ListChevron, VehicleIcon],
  template: `
    <app-list-group heading="Ações">
      @if (lockReason(); as reason) {
        <a appListRow locked aria-disabled="true" [attr.title]="reason">
          <span class="tile" aria-hidden="true"><app-vehicle-icon name="pen" /></span>
          <span class="t"><b>Editar</b><small>{{ reason }}</small></span>
        </a>
      } @else {
        <a appListRow [routerLink]="['/veiculos', vehicleId(), 'editar']">
          <span class="tile" aria-hidden="true"><app-vehicle-icon name="pen" /></span>
          <span class="t"><b>Editar</b></span>
          <app-list-chevron />
        </a>
      }

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
            @if (lockReason(); as reason) { <small>{{ reason }}</small> }
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
            @if (statusLock(); as reason) { <small>{{ reason }}</small> }
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
            @if (statusLock(); as reason) { <small>{{ reason }}</small> }
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

      <button
        type="button"
        appListRow
        inset
        danger
        [locked]="!!deleteLock()"
        [disabled]="!!deleteLock()"
        [attr.title]="deleteLock()"
        (click)="remove.emit()"
      >
        <span class="t">
          <b>Excluir veículo</b>
          @if (deleteLock(); as reason) { <small>{{ reason }}</small> }
        </span>
      </button>
    </app-list-group>
  `,
})
export class VehicleActionsGroup {
  readonly vehicleId = input.required<string>();
  readonly status = input.required<VehicleStatus>();
  readonly sold = input(false);
  /** Motivo único do veículo vendido; nulo fora dele. */
  readonly lockReason = input<string | null>(null);
  readonly deleteLock = input<string | null>(null);
  readonly busy = input(false);
  readonly undoing = input(false);

  readonly transition = output<VehicleStatusTarget>();
  readonly sell = output<void>();
  readonly undoSale = output<void>();
  readonly remove = output<void>();

  protected readonly canGoAvailable = computed(() => {
    const s = this.status();
    return s === 'MAINTENANCE' || s === 'INACTIVE';
  });

  protected readonly statusLock = computed(
    () => this.lockReason() ?? (this.status() === 'RENTED' ? RENTED_LOCK_REASON : null),
  );
}
