import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { COMPANY_IDENTITY } from '../../company-identity';

@Component({
  selector: 'app-landing-footer',
  imports: [RouterModule],
  templateUrl: './landing-footer.component.html',
  styleUrls: ['./landing-footer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingFooterComponent {
  readonly year = new Date().getFullYear();

  /**
   * Identidade legal da empresa. Hoje só o CNPJ real; razão social e endereço
   * saem quando o dono fornecer. `null` esconde o bloco inteiro. Ver
   * `company-identity.ts`: inventar um CNPJ seria publicar documento falso.
   */
  protected readonly identity = inject(COMPANY_IDENTITY);
}
