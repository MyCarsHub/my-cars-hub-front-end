import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ListChevron, ListGroup, ListRow } from '../../../../components/core/list-group/list-group';
import { VehicleIcon, VehicleIconName } from '../vehicle-icon/vehicle-icon';

interface HistoryRow {
  readonly title: string;
  readonly hint: string;
  readonly icon: VehicleIconName;
  readonly link: string[];
  readonly query: Record<string, string> | null;
}

/** As listas completas continuam nas páginas delas; aqui ficam só os caminhos até lá. */
@Component({
  selector: 'app-vehicle-history-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  imports: [RouterLink, ListGroup, ListRow, ListChevron, VehicleIcon],
  template: `
    <app-list-group heading="Histórico">
      @for (row of rows(); track row.title) {
        <a appListRow [routerLink]="row.link" [queryParams]="row.query">
          <span class="tile" aria-hidden="true"><app-vehicle-icon [name]="row.icon" /></span>
          <span class="t"><b>{{ row.title }}</b><small>{{ row.hint }}</small></span>
          <app-list-chevron />
        </a>
      }
    </app-list-group>
  `,
})
export class VehicleHistoryGroup {
  readonly vehicleId = input.required<string>();
  /** `null` enquanto o resumo não respondeu: o caminho continua lá. */
  readonly financed = input<boolean | null>(null);
  readonly sold = input(false);

  protected readonly rows = computed<HistoryRow[]>(() => {
    const id = this.vehicleId();
    const under = (path: string) => ['/veiculos', id, 'gerencia', path];
    return [
      {
        title: 'Aluguéis',
        hint: 'Contratos deste carro',
        icon: 'key',
        link: ['/alugueis'],
        query: { vehicleId: id },
      },
      {
        title: 'Manutenções',
        hint: 'Serviços registrados',
        icon: 'maintenance',
        link: under('manutencoes'),
        query: null,
      },
      { title: 'Multas', hint: 'Todas as multas', icon: 'fine', link: under('multas'), query: null },
      {
        title: 'Seguros',
        hint: 'Apólices do carro',
        icon: 'insurance',
        link: under('seguros'),
        query: null,
      },
      ...this.financingRow(id),
    ];
  });

  /**
   * A lista de financiamentos não cria nada: quem cadastra é o formulário do veículo, que
   * trava no carro vendido. Por isso o carro à vista vendido não tem esta linha. Sem resumo
   * ainda não se sabe se há contrato, e a lista é o destino que não promete nada.
   */
  private financingRow(id: string): HistoryRow[] {
    const icon = 'money';
    const title = 'Financiamento';
    if (this.financed() === false) {
      if (this.sold()) return [];
      return [
        { title, icon, hint: 'Cadastrar financiamento', link: ['/veiculos', id, 'editar'], query: null },
      ];
    }
    const link = ['/veiculos', id, 'gerencia', 'financiamentos'];
    return [{ title, icon, hint: 'Contrato e parcelas', link, query: null }];
  }
}
