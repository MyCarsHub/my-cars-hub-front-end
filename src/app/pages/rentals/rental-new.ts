import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { FeatureFlagsService } from '../../services/feature-flags.service';
import { RentalForm } from './rental-form';
import { RentalCreate } from './rental-create/rental-create';

/**
 * `/alugueis/novo`. Com `CHARGES_FLEX`, o Novo aluguel em uma página (carregado à parte, só
 * para quem tem a chave); sem ela, o formulário de hoje, sem nenhuma mudança. A edição
 * (`/alugueis/:id/editar`) continua indo direto ao formulário de hoje.
 *
 * O passo a passo (`rental-wizard/`) saiu daqui e só é apagado depois da liberação.
 *
 * A chave é lida uma vez: a troca de empresa destrói esta tela.
 */
@Component({
  selector: 'app-rental-new',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RentalForm, RentalCreate],
  host: { style: 'display: contents' },
  template: `
    @if (flex) {
      @defer (on immediate) {
        <app-rental-create />
      } @error {
        <p role="alert" style="padding: 16px; font-size: 16px">
          Não deu para abrir o Novo aluguel. Recarregue a página.
        </p>
      }
    } @else {
      <app-rental-form />
    }
  `,
})
export class RentalNew {
  protected readonly flex = inject(FeatureFlagsService).chargesFlex();
}
