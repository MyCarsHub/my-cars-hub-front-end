import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Rota-pivo da TROCA DE EMPRESA. Nao desenha nada e nao e alcancavel por menu nem por link.
 *
 * ## Por que ela existe
 *
 * Trocar de empresa terminava em `router.navigate(['/dashboard'])`. Estando a pessoa JA no
 * dashboard — que e a tela inicial, logo o caso comum — essa navegacao e um NO-OP: o Angular
 * reaproveita o componente, `ngOnInit` nao roda outra vez e nada recarrega. O seletor passava
 * a dizer a empresa nova enquanto os numeros continuavam sendo os da anterior.
 *
 * Navegar para ESTA rota e depois para o destino forca a recriacao da arvore de componentes,
 * sem recarregar a pagina pela rede.
 *
 * ## Por que nao a rota '/'
 *
 * MEDIDO: `path: ''` deste app e a LANDING PAGE publica, com chunk proprio. Usa-la de pivo
 * montaria a pagina de marketing no meio da troca — flash visivel dentro do app, mais o custo
 * de carregar um chunk que nao se quer. Esta rota nao tem nada para montar.
 *
 * ## Por que o componente e vazio em vez de um spinner
 *
 * Ela vive por um tick: pintar qualquer coisa ali produziria um piscar. Quem precisa de
 * tela de espera e o destino, nao o pivo.
 *
 * Nao use esta rota para mais nada. Se um dia algo precisar de uma tela de transicao de
 * verdade, isso e outra rota com outro nome — esta e deliberadamente inerte.
 */
@Component({
  selector: 'app-tenant-switch-pivot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class TenantSwitchPivot {}
