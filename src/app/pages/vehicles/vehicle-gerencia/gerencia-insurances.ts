import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { InsurancesList } from '../../insurances/insurances-list';

/**
 * Thin wrapper: renders the fleet-wide insurances list scoped to a single vehicle.
 */
@Component({
  selector: 'app-gerencia-insurances',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, InsurancesList],
  template: `
    <div class="mb-3">
      <a
        [routerLink]="['/veiculos', vehicleId(), 'gerencia']"
        class="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 font-medium"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Voltar à gerência
      </a>
    </div>
    @if (vehicleId(); as id) {
      <app-insurances-list [vehicleIdPrefilter]="id" />
    }
  `,
})
export class GerenciaInsurances {
  private readonly route = inject(ActivatedRoute);

  /**
   * Derivado de `paramMap`, não de `snapshot`: navegar da gerência de um veículo
   * para a de outro reusa esta instância (mesma configuração de rota), e o
   * snapshot lido no inicializador de campo congelaria o primeiro id — a lista
   * continuaria filtrada pelo veículo anterior.
   */
  protected readonly vehicleId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: '' },
  );
}
