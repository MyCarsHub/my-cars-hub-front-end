import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { InspectionsList } from './inspections-list';
import { InspectionsService } from '../../services/inspections.service';
import { VehiclesService } from '../../services/vehicles.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { InspectionListItem } from '../../types/inspection.types';

/**
 * `/vistorias` — a pagina que tira a vistoria de dentro do aluguel.
 *
 * O endpoint ainda nao existe; a tela consome o contrato PROPOSTO. Os testes
 * afirmam o comportamento da TELA (filtros combinados, estados vazios, link do
 * PDF), nao o formato do backend — se o contrato mudar, muda o service e estes
 * testes seguem valendo.
 */
describe('InspectionsList', () => {
  const item: InspectionListItem = {
    id: 'insp-1',
    rentalId: 'rent-1',
    rentalCode: 'LOC-0001',
    vehicleId: 'veh-1',
    vehiclePlate: 'ABC1D23',
    vehicleBrand: 'Fiat',
    vehicleModel: 'Argo',
    driverName: 'Fulano de Tal',
    kind: 'CHECKIN',
    performedAt: '2026-09-10T12:00:00Z',
    photoCount: 14,
    documentId: 'doc-1',
    documentSignedUrl: 'https://files.example/insp-1.pdf',
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

  it('cada vistoria leva ao PDF quando ele existe', () => {
    items.set([item]);
    total.set(1);
    const fixture = render();

    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      'a[target="_blank"]',
    );
    expect(link?.getAttribute('href')).toBe('https://files.example/insp-1.pdf');
  });

  /**
   * Vistoria sem PDF e estado LEGITIMO (o PDF e gerado sob demanda). Em vez de
   * link morto, a linha leva ao aluguel, que e onde se gera.
   */
  it('sem PDF, oferece ver no aluguel em vez de um link morto', () => {
    items.set([{ ...item, documentId: null, documentSignedUrl: null }]);
    total.set(1);
    const fixture = render();

    const body = text(fixture);
    expect(body).toContain('Ver no aluguel');
    expect(body).toContain('PDF ainda não gerado');
    expect((fixture.nativeElement as HTMLElement).querySelector('a[target="_blank"]')).toBeNull();
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
  it('vistoria de frota sem PDF nao oferece link para aluguel', () => {
    items.set([{ ...item, kind: 'FLEET', rentalId: null, documentId: null, documentSignedUrl: null }]);
    total.set(1);
    const fixture = render();

    const body = text(fixture);
    expect(body).toContain('PDF ainda não gerado');
    expect(body).not.toContain('Ver no aluguel');
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
});
