import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Abas de Empresas: "Todas" e "Converter testes" (admin v2, D5).
 *
 * <p>"Converter testes" é uma ABA e não um filtro da lista porque a pergunta é
 * outra: a lista responde "quem são as empresas"; a aba responde "com quem eu
 * falo hoje". Ela traz sinais de ativação que a lista não tem (veículo,
 * motorista, aluguel, último acesso), uma ordem própria (melhor para converter
 * primeiro) e uma mensagem de WhatsApp pronta. Como chip de filtro, cada linha
 * da lista geral teria de carregar esses sinais e a ordem por data de cadastro
 * esconderia os melhores candidatos.</p>
 */
@Component({
  selector: 'app-admin-companies-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <nav class="mb-4 flex gap-2 overflow-x-auto" aria-label="Visões de empresas">
      <a
        routerLink="/admin/companies"
        [attr.aria-current]="active() === 'all' ? 'page' : null"
        [class]="tabClass(active() === 'all')"
      >Todas</a>
      <a
        routerLink="/admin/companies/converter-testes"
        data-testid="tab-convert"
        [attr.aria-current]="active() === 'convert' ? 'page' : null"
        [class]="tabClass(active() === 'convert')"
      >Converter testes</a>
    </nav>
  `,
})
export class AdminCompaniesTabs {
  readonly active = input<'all' | 'convert'>('all');

  protected tabClass(selected: boolean): string {
    const base =
      'inline-flex items-center min-h-[44px] px-4 rounded-full text-sm font-medium whitespace-nowrap ' +
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ';
    return selected
      ? base + 'bg-primary-500 text-white'
      : base + 'border border-edge text-fg-soft hover:bg-canvas';
  }
}
