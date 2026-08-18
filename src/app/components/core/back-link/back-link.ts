import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Onde o link mora na página — é o que decide o respiro vertical. */
export type BackLinkPlacement = 'top' | 'bottom' | 'none';

/**
 * Link "← Voltar" padrão das telas internas.
 *
 * Existiu em 21 cópias manuais com quatro espaçamentos diferentes e, em 20
 * delas, sem alvo de toque de 44px e sem anel de foco visível. Todas foram
 * migradas: hoje são 24 usos em 21 templates, e não sobrou nenhuma cópia
 * manual do "← Voltar". Nas telas migradas, portanto, o piso de 44px e o anel
 * de foco valem — não em toda a aplicação (ver a dívida logo abaixo). Este
 * componente é a única fonte desse tratamento: quem consome escolhe destino,
 * rótulo e posição — nunca as classes.
 *
 * DÍVIDA ABERTA, já registrada na fila: quatro links de recuperação em cartão
 * de erro seguem com o styling antigo (`text-sm text-primary-700
 * hover:text-primary-800 font-medium`), sem alvo de 44px e sem anel de foco —
 * `financing-detail.html:9`, `fine-detail.html:9`, `insurance-detail.html:9` e
 * `maintenance-detail.html:9`. Adotá-lo ali é mudança de design, não migração,
 * e sai em item próprio.
 *
 * Fora do escopo dele fica o link de recuperação dentro do banner de erro do
 * `vehicle-detail`: não tem seta, herda o rose do `app-alert-banner` e é um
 * padrão diferente — não é cópia deste. (O `rental-detail` não entra na lista:
 * o controle de saída de lá é um `<button (click)="backToList()">`, não um
 * link.)
 *
 * ## Espaçamento
 *
 * O respiro é do **host**, não de um `<div>` do consumidor:
 *
 * - `placement="top"` → `mb-2` (8px). O link precede o conteúdo e tem que ler
 *   como preso a ele; o box de 44px já rende ~12px de folga ótica embaixo.
 * - `placement="bottom"` → `mt-6` (24px). Encerra a página, então se destaca.
 * - `placement="none"` → sem margem, para quando o link divide uma linha flex
 *   com outros controles e o espaçamento é do wrapper.
 *
 * Por isso o componente **não pode** ficar dentro de um `space-y-*`: a margem
 * do container somaria à do host e o valor deixaria de ser uniforme. Coloque-o
 * como irmão, fora do container.
 *
 * @example
 * ```html
 * <app-back-link link="/configuracoes" label="Voltar para Configurações" placement="top" />
 * <app-back-link [link]="['/veiculos', vehicleId()]" label="Voltar ao veículo" />
 * ```
 */
@Component({
  selector: 'app-back-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './back-link.html',
  host: {
    class: 'block',
    '[class.mb-2]': "placement() === 'top'",
    '[class.mt-6]': "placement() === 'bottom'",
  },
})
export class BackLink {
  /** Destino: string (`'/admin'`) ou array de segmentos (`['/veiculos', id]`). */
  readonly link = input.required<string | readonly unknown[]>();

  /** Texto depois da seta. A seta `←` é decorativa e vem do componente. */
  readonly label = input.required<string>();

  readonly placement = input<BackLinkPlacement>('bottom');
}
