import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MaintenancesList } from '../../maintenances/maintenances-list';

/**
 * Thin wrapper: renders the fleet-wide maintenances list scoped to a single vehicle.
 */
@Component({
  selector: 'app-gerencia-maintenances',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MaintenancesList],
  template: `
    <div class="mb-3">
      <a
        [routerLink]="['/veiculos', vehicleId(), 'gerencia']"
        class="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 font-medium"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Voltar à gerência
      </a>
    </div>
    @if (vehicleId(); as id) {
      <app-maintenances-list [vehicleIdPrefilter]="id" />
    }
  `,
})
export class GerenciaMaintenances {
  private readonly route = inject(ActivatedRoute);
  protected readonly vehicleId = signal<string>(this.route.snapshot.paramMap.get('id') ?? '');
}
