import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { FeatureFlagsService } from '../../services/feature-flags.service';
import { RentalForm } from './rental-form';
import { RentalWizard } from './rental-wizard/rental-wizard';

/**
 * `/alugueis/novo`. Com `CHARGES_FLEX`, o Novo aluguel passo a passo (carregado à parte, só
 * para quem tem a chave); sem ela, o formulário de hoje, sem nenhuma mudança. A edição
 * (`/alugueis/:id/editar`) continua indo direto ao formulário de hoje.
 *
 * A chave é lida uma vez: a troca de empresa destrói esta tela.
 */
@Component({
  selector: 'app-rental-new',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RentalForm, RentalWizard],
  host: { style: 'display: contents' },
  template: `
    @if (wizard) {
      @defer (on immediate) {
        <app-rental-wizard />
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
  protected readonly wizard = inject(FeatureFlagsService).chargesFlex();
}
