import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { SearchSelect, SearchSelectOption } from '../../../../components/search-select/search-select';

/**
 * Card 1 · Motorista e veículo (pranchas MvCombo D1–D4 / E1–E3). Duas listas com busca; quem
 * está com outro aluguel no período escolhido aparece apagado, com o motivo. O estado é da
 * página (`RentalCreate`): aqui só se mostra e se avisa.
 */
@Component({
  selector: 'app-rc-driver-vehicle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SearchSelect],
  host: { class: 'rc-cb rc-cols' },
  template: `
    @if (failed()) {
      <div class="rc-span" data-testid="pickers-failed">
        <p class="rc-err text-rose-700 dark:text-rose-300" role="alert">
          Não deu para carregar os motoristas e os carros.
        </p>
        <button type="button" class="rc-link" (click)="retry.emit()">Tentar de novo</button>
      </div>
    }
    <div class="rc-stack">
      <app-search-select
        label="Motorista"
        [required]="true"
        placeholder="Selecione o motorista"
        searchPlaceholder="Buscar pelo nome"
        [foundWords]="['motorista encontrado', 'motoristas encontrados']"
        emptyText="Nenhum motorista encontrado."
        testId="driver"
        [options]="drivers()"
        [value]="driverId()"
        [error]="driverError()"
        (valueChange)="driverChange.emit($event)"
        (closed)="touched.emit('driverId')"
      />
      @if (driverLost()) {
        <p class="rc-err text-rose-700 dark:text-rose-300" role="alert">
          O motorista escolhido não está livre nessas datas. Escolha outro.
        </p>
      }
    </div>
    <div class="rc-stack">
      <app-search-select
        label="Veículo"
        [required]="true"
        placeholder="Selecione o veículo"
        searchPlaceholder="Buscar pela placa ou modelo"
        [foundWords]="['veículo encontrado', 'veículos encontrados']"
        emptyText="Nenhum veículo encontrado."
        testId="vehicle"
        [options]="vehicles()"
        [value]="vehicleId()"
        [error]="vehicleError()"
        (valueChange)="vehicleChange.emit($event)"
        (closed)="touched.emit('vehicleId')"
      />
      @if (vehicleLost()) {
        <p class="rc-err text-rose-700 dark:text-rose-300" role="alert">
          O veículo escolhido não está livre nessas datas. Escolha outro.
        </p>
      }
    </div>
  `,
})
export class CardDriverVehicle {
  readonly drivers = input<readonly SearchSelectOption[]>([]);
  readonly vehicles = input<readonly SearchSelectOption[]>([]);
  readonly driverId = input('');
  readonly vehicleId = input('');
  readonly driverError = input<string | null>(null);
  readonly vehicleError = input<string | null>(null);
  readonly driverLost = input(false);
  readonly vehicleLost = input(false);
  readonly failed = input(false);

  readonly driverChange = output<string>();
  readonly vehicleChange = output<string>();
  readonly touched = output<string>();
  readonly retry = output<void>();
}
