import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { PillTabs, type PillTabOption } from '../../../components/core/pill-tabs/pill-tabs';

export type CompaniesView = 'all' | 'convert';

const ROUTES: Record<CompaniesView, string> = {
  all: '/admin/companies',
  convert: '/admin/companies/converter-testes',
};

/** Fora do template: `options` é input do `app-pill-tabs` (OnPush) e um literal viraria array novo a cada ciclo. */
const OPTIONS: readonly PillTabOption<CompaniesView>[] = [
  { value: 'all', label: 'Todas', testId: 'tab-all' },
  { value: 'convert', label: 'Converter testes', testId: 'tab-convert' },
];

/**
 * Abas de Empresas: "Todas" e "Converter testes" (admin v2, D5), no `app-pill-tabs` da
 * plataforma (polegar laranja que desliza; padrão de lista, 18/11/2026).
 *
 * <p>"Converter testes" é uma ABA e não um filtro da lista porque a pergunta é
 * outra: a lista responde "quem são as empresas"; a aba responde "com quem eu
 * falo hoje". Ela traz sinais de ativação que a lista não tem (veículo,
 * motorista, aluguel, último acesso), uma ordem própria (melhor para converter
 * primeiro) e uma mensagem de WhatsApp pronta. Como chip de filtro, cada linha
 * da lista geral teria de carregar esses sinais e a ordem por data de cadastro
 * esconderia os melhores candidatos.</p>
 *
 * <p>Cada aba é uma rota: tocar troca a URL (o voltar do navegador volta para a aba anterior).</p>
 */
@Component({
  selector: 'app-admin-companies-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PillTabs],
  host: { class: 'block mb-4' },
  template: `
    <app-pill-tabs
      [options]="options"
      [value]="active()"
      ariaLabel="Visões de empresas"
      (selected)="go($event)"
    />
  `,
})
export class AdminCompaniesTabs {
  private readonly router = inject(Router);

  readonly active = input<CompaniesView>('all');
  protected readonly options = OPTIONS;

  protected go(view: CompaniesView): void {
    void this.router.navigateByUrl(ROUTES[view]);
  }
}
