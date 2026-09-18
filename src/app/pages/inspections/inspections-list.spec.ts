import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { InspectionsList } from './inspections-list';
import { DateRangePicker } from '../../components/date-range-picker/date-range-picker';
import { InspectionsService } from '../../services/inspections.service';
import { VehiclesService } from '../../services/vehicles.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { InspectionListItem } from '../../types/inspection.types';

/**
 * `/vistorias` — a pagina que tira a vistoria de dentro do aluguel.
 *
 * `GET /v1/inspections` ja existe (V82), mas com contrato mais estreito que o
 * que esta tela manda — ver o javadoc de `services/inspections.service.ts`. Os
 * testes aqui afirmam o comportamento da TELA (filtros combinados, estados
 * vazios, caminho para o aluguel), nao o formato do backend.
 */
describe('InspectionsList', () => {
  const item: InspectionListItem = {
    id: 'insp-1',
    rentalId: 'rent-1',
    vehicleId: 'veh-1',
    vehiclePlate: 'ABC1D23',
    vehicleBrand: 'Fiat',
    vehicleModel: 'Argo',
    driverName: 'Fulano de Tal',
    kind: 'CHECKIN',
    performedAt: '2026-09-10T12:00:00Z',
    photoCount: 14,
  };

  let items: ReturnType<typeof signal<InspectionListItem[]>>;
  let total: ReturnType<typeof signal<number>>;
  let error: ReturnType<typeof signal<string | null>>;
  let listSpy: ReturnType<typeof vi.fn>;

  interface Internals {
    onVehicleChange: (v: string) => void;
    onRentalChange: (v: string) => void;
    onKindChange: (v: 'CHECKIN' | 'CHECKOUT' | 'FLEET' | 'ALL') => void;
    onRangeChange: (r: { from: string; to: string } | null) => void;
    clearFilters: () => void;
  }

  function configure(): void {
    TestBed.resetTestingModule();
    items = signal<InspectionListItem[]>([]);
    total = signal(0);
    error = signal<string | null>(null);
    listSpy = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));

    TestBed.configureTestingModule({
      imports: [InspectionsList],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: InspectionsService,
          useValue: {
            items,
            total,
            error,
            page: signal(0),
            size: signal(20),
            loading: signal(false),
            list: listSpy,
          },
        },
        {
          provide: VehiclesService,
          useValue: {
            list: vi.fn().mockReturnValue(
              of({ content: [{ id: 'veh-1', plate: 'ABC1D23', model: 'Argo' }], page: 0, size: 500, total: 1 }),
            ),
          },
        },
      ],
    });
  }

  function render() {
    const fixture = TestBed.createComponent(InspectionsList);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: ReturnType<typeof render>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  function internals(fixture: ReturnType<typeof render>): Internals {
    return fixture.componentInstance as unknown as Internals;
  }

  /** Os parametros da ULTIMA chamada ao service. */
  function lastQuery(): Record<string, unknown> {
    return listSpy.mock.calls[listSpy.mock.calls.length - 1][0] as Record<string, unknown>;
  }

  beforeEach(() => {
    configure();
  });

  it('carrega as vistorias ao abrir, sem filtro nenhum', () => {
    render();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toMatchObject({ page: 0, vehicleId: null, rentalId: null, kind: null });
  });

  /**
   * O PEDIDO DO DONO: os tres filtros valem AO MESMO TEMPO. Este teste aplica
   * os tres e afirma que a consulta leva os tres juntos — um filtro que zera o
   * anterior seria pior que nao ter filtro.
   */
  it('combina veiculo, locacao, tipo e periodo na mesma consulta', () => {
    const fixture = render();
    const api = internals(fixture);

    api.onVehicleChange('veh-1');
    api.onRentalChange('LOC-0001');
    api.onKindChange('CHECKOUT');
    api.onRangeChange({ from: '2026-09-01', to: '2026-09-30' });
    fixture.detectChanges();

    expect(lastQuery()).toMatchObject({
      vehicleId: 'veh-1',
      rentalId: 'LOC-0001',
      kind: 'CHECKOUT',
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('volta para a primeira pagina a cada troca de filtro', () => {
    const fixture = render();
    internals(fixture).onKindChange('CHECKIN');

    expect(lastQuery()).toMatchObject({ page: 0 });
  });

  /**
   * OS DOIS ESTADOS VAZIOS, que e o ponto do card: "nenhuma com estes filtros"
   * e "nenhuma ainda" sao coisas diferentes. A primeira se resolve limpando o
   * filtro; a segunda, fazendo uma vistoria. Mesma frase para as duas manda o
   * usuario procurar o problema no lugar errado.
   */
  /**
   * O ESTADO INICIAL MUDOU DE NATUREZA. Enquanto `rentalId` era obrigatorio no
   * servidor, abrir a pagina sem filtro so podia dar 400 — o caso de sucesso
   * sem filtro nao existia para ser testado. Com os cinco parametros opcionais
   * (backend PR #207), o ramo sem filtro passa a listar para dono e gerente, e
   * este e o caminho por onde TODO usuario entra na tela.
   *
   * Os dois testes de vazio abaixo continuam valendo e continuam distintos —
   * eles dependem de haver filtro, nao do contrato — mas nenhum deles prova que
   * a lista aparece. Sem este caso, uma tela que nunca renderizasse resultado
   * algum passaria em todos: os dois vazios e o de query afirmam ausencia.
   */
  it('sem filtro nenhum e com resultado, mostra a lista', () => {
    // Semeado ANTES do render: e assim que a tela abre em producao com o
    // contrato novo — a resposta chega e a lista ja nasce preenchida.
    items.set([item]);
    total.set(1);
    const fixture = render();

    expect(text(fixture)).toContain(item.vehiclePlate);
    expect(text(fixture)).not.toContain('Nenhuma vistoria registrada ainda');
    expect(text(fixture)).not.toContain('com estes filtros');
    expect(lastQuery()).toMatchObject({ vehicleId: null, rentalId: null, kind: null });
  });

  it('sem vistoria nenhuma e sem filtro, diz que ainda nao ha vistorias', () => {
    const fixture = render();

    expect(text(fixture)).toContain('Nenhuma vistoria registrada ainda');
    expect(text(fixture)).not.toContain('com estes filtros');
  });

  it('sem resultado MAS com filtro, diz que o filtro nao achou nada', () => {
    const fixture = render();
    internals(fixture).onVehicleChange('veh-1');
    fixture.detectChanges();

    expect(text(fixture)).toContain('Nenhuma vistoria encontrada com estes filtros');
    expect(text(fixture)).not.toContain('registrada ainda');
  });

  it('oferece limpar os filtros no vazio filtrado, e limpar recarrega sem eles', () => {
    const fixture = render();
    internals(fixture).onVehicleChange('veh-1');
    fixture.detectChanges();

    // Busca pelo TEXTO: o primeiro <button> da pagina e um chip de filtro, nao
    // o botao de limpar.
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Limpar filtros');
    expect(button, 'botao de limpar filtros nao encontrado').toBeDefined();

    internals(fixture).clearFilters();
    expect(lastQuery()).toMatchObject({ vehicleId: null, rentalId: null, kind: null, from: null });
  });

  /**
   * NAO HA COLUNA DE DOCUMENTO nesta tela, e a ausencia e o contrato: nao existe
   * tabela de documento de vistoria e o laudo e funcionalidade por construir
   * (ver `types/inspection.types.ts`). O que a linha oferece e o caminho para o
   * aluguel, que e onde a vistoria vive hoje.
   */
  it('a vistoria de um aluguel leva ao aluguel', () => {
    items.set([item]);
    total.set(1);
    const fixture = render();

    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      `a[href="/alugueis/${item.rentalId}"]`,
    );
    expect(link, 'link para o aluguel nao encontrado').not.toBeNull();
    expect(text(fixture)).toContain('Ver no aluguel');
  });

  /**
   * Nem link de PDF nem a legenda "PDF ainda nao gerado". A legenda era a metade
   * pior: prometia um pipeline que ninguem escreveu, e um estado de espera
   * permanente ensina o usuario a ignorar a coluna.
   */
  it('nao oferece PDF nem promete PDF futuro', () => {
    items.set([item]);
    total.set(1);
    const fixture = render();

    expect((fixture.nativeElement as HTMLElement).querySelector('a[target="_blank"]')).toBeNull();
    expect(text(fixture)).not.toContain('PDF');
    // CONTROLE POSITIVO: as duas afirmacoes acima sao de AUSENCIA e passariam a
    // vazio numa tela que nao renderizasse linha nenhuma.
    expect(text(fixture)).toContain(item.vehiclePlate);
  });

  /**
   * FLEET e vistoria de FROTA, sem aluguel — tipo que so existe depois do
   * PR #190 e nao tem equivalente no fluxo antigo, preso a locacao.
   */
  it('oferece o tipo Frota no filtro, alem de entrada e saida', () => {
    const fixture = render();
    // Escopado ao grupo de TIPO: a pagina tem outro grupo de chips (o seletor
    // de periodo), e um seletor solto por [role=radio] pegaria os dois.
    const chips = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[aria-labelledby="insp-kind-label"] [role="radio"]',
      ),
    ).map((c) => c.textContent?.trim());

    expect(chips).toEqual(['Todas', 'Entrada', 'Saída', 'Frota']);
  });

  it('filtra por Frota', () => {
    const fixture = render();
    internals(fixture).onKindChange('FLEET');

    expect(lastQuery()).toMatchObject({ kind: 'FLEET' });
  });

  /**
   * `rentalId` nulo E o significado de FLEET, nao dado faltando: nao ha aluguel
   * para onde mandar o usuario, entao a linha nao pode oferecer "ver no
   * aluguel" — seria link para lugar nenhum.
   */
  it('vistoria de frota nao oferece link para aluguel', () => {
    items.set([{ ...item, kind: 'FLEET', rentalId: null }]);
    total.set(1);
    const fixture = render();

    const body = text(fixture);
    expect(body).not.toContain('Ver no aluguel');
    // CONTROLE POSITIVO: a linha precisa existir, senao uma grade vazia passaria.
    expect(body).toContain(item.vehiclePlate);
  });

  it('mostra o erro inline quando a listagem falha', () => {
    listSpy.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    error.set('Não foi possível carregar as vistorias.');
    const fixture = render();

    expect(fixture.nativeElement.querySelector('app-alert-banner')).not.toBeNull();
  });

  /**
   * Item de grade nasce com `min-width:auto` e NAO encolhe abaixo do conteudo:
   * sem `min-w-0` uma placa longa empurra a grade e a pagina rola para o lado
   * no celular. Foi assim que o dashboard quebrou hoje.
   */
  it('todo item de grade dos filtros tem min-w-0', () => {
    const fixture = render();
    const grid = (fixture.nativeElement as HTMLElement).querySelector('.grid');
    const children = Array.from(grid?.children ?? []);

    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.className, `item de grade sem min-w-0: ${child.className}`).toContain('min-w-0');
    }
  });

  /**
   * OS CONTROLES, PELO DOM.
   *
   * Os casos acima chamam `internals().onVehicleChange(...)` e companhia, que e
   * a API do COMPONENTE. Isso prova que o componente filtra; nao prova que o
   * usuario consegue filtrar — apagar os tres controles do template deixaria
   * todos eles verdes. Aqui a acao parte do elemento renderizado, entao sumir
   * com o controle derruba o teste.
   *
   * Os chips de tipo ja estavam presos assim; faltavam veiculo, locacao e
   * periodo.
   */
  describe('os controles renderizados alimentam a consulta', () => {
    it('o select de veiculo filtra', () => {
      const fixture = render();
      const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
        '#insp-vehicle',
      )!;

      // CONTROLE POSITIVO: sem a opcao no DOM, atribuir o value nao pega e o
      // teste passaria a vazio. Exigir a opcao antes fecha essa porta.
      expect(Array.from(select.options).map((o) => o.value)).toContain('veh-1');

      select.value = 'veh-1';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(lastQuery()).toMatchObject({ vehicleId: 'veh-1' });
    });

    it('o campo de locacao filtra', () => {
      const fixture = render();
      const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '#insp-rental',
      )!;

      input.value = 'LOC-0001';
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(lastQuery()).toMatchObject({ rentalId: 'LOC-0001' });
    });

    /**
     * O periodo vem de `app-date-range-picker`, reaproveitado do dashboard.
     * Dirigir a data pelos inputs DELE amarraria esta tela ao desenho interno
     * de outro componente; o que esta tela precisa provar e que o seletor esta
     * MONTADO e que a saida dele esta ligada. Tirar o elemento do template faz
     * a consulta abaixo devolver null e o teste cai.
     */
    it('o seletor de periodo filtra', () => {
      const fixture = render();
      const picker = fixture.debugElement.query(By.directive(DateRangePicker));

      expect(picker).not.toBeNull();
      picker.componentInstance.rangeChange.emit({ from: '2026-09-01', to: '2026-09-30' });
      fixture.detectChanges();

      expect(lastQuery()).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    });

    it('os tres, pelo DOM, valem ao mesmo tempo', () => {
      const fixture = render();
      const host = fixture.nativeElement as HTMLElement;

      const select = host.querySelector<HTMLSelectElement>('#insp-vehicle')!;
      select.value = 'veh-1';
      select.dispatchEvent(new Event('change'));

      const input = host.querySelector<HTMLInputElement>('#insp-rental')!;
      input.value = 'LOC-0001';
      input.dispatchEvent(new Event('change'));

      fixture.debugElement
        .query(By.directive(DateRangePicker))
        .componentInstance.rangeChange.emit({ from: '2026-09-01', to: '2026-09-30' });
      fixture.detectChanges();

      expect(lastQuery()).toMatchObject({
        vehicleId: 'veh-1',
        rentalId: 'LOC-0001',
        from: '2026-09-01',
        to: '2026-09-30',
      });
    });
  });
});
