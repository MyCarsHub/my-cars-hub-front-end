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
    status: 'APPROVED',
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
    onStatusChange: (v: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ALL') => void;
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
            // O filho `app-inspection-review` e renderizado DE VERDADE quando a
            // linha abre, entao o duble precisa do contrato dele tambem.
            photos: vi.fn().mockReturnValue(of([])),
            approve: vi.fn(),
            reject: vi.fn(),
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

  /** O botao de abrir/fechar DO CARTAO DE FILTROS, achado pelo titulo do cartao. */
  /**
   * O GATILHO EXATO, por `data-testid`.
   *
   * Procurar `button[aria-expanded]` dentro do cartao que contem a palavra
   * "Filtros" parou de funcionar quando a tela virou UM cartao so: o primeiro
   * botao com `aria-expanded` passou a ser "Fazer vistoria", entao o helper
   * abria o seletor de carro e o painel de filtros continuava fechado — e o
   * teste acusava o template em vez do proprio seletor. Mesmo hook que
   * `vehicles-list` usa.
   */
  function filtersToggle(fixture: ReturnType<typeof render>): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="filters-toggle"]',
    );
  }

  /**
   * Os filtros passaram a nascer FECHADOS (lista antes, filtro depois), entao os controles
   * nao estao no DOM na primeira pintura. `render()` abre o painel por padrao, porque e isso
   * que a maioria dos casos abaixo precisa; quem quer medir o estado INICIAL passa
   * `{ openFilters: false }`.
   */
  function render({ openFilters = true }: { openFilters?: boolean } = {}) {
    const fixture = TestBed.createComponent(InspectionsList);
    fixture.detectChanges();
    if (openFilters) {
      // ESCOPADO ao cartao de Filtros. Um seletor global de `button[aria-expanded]` pega o
      // botao "Revisar e decidir" DA LINHA, que tambem usa `aria-expanded` — e abria uma
      // revisao em vez do painel de filtros, derrubando um caso que nada tinha com isso.
      filtersToggle(fixture)?.click();
      fixture.detectChanges();
    }
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
    // `storageKey` do cartao de Filtros persiste aberto/fechado na sessao. O setup global
    // limpa no inicio do ARQUIVO, nao a cada caso, entao sem esta linha o primeiro caso que
    // abre o painel deixa os seguintes abertos: suite dependente de ORDEM.
    sessionStorage.clear();
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
  /**
   * FIX-0565 — a regiao viva anunciava uma frase FIXA de falha de carregamento, enquanto o
   * banner mostrava a causa que o servico apurou. Num 403 os dois canais contavam historias
   * diferentes sobre o MESMO evento, e so quem enxerga recebia a verdadeira. Quem usa leitor
   * de tela ouvia "nao foi possivel carregar" e ficava recarregando uma tela que nunca abriria.
   *
   * Os testes abaixo comparam os DOIS canais entre si em vez de conferir duas strings
   * esperadas: o que precisa valer e que eles nao possam divergir, e nao que cada um case com
   * um literal que o teste tambem escreveu.
   */
  describe('FIX-0565 — o aria-live diz a MESMA coisa que o banner', () => {
    function liveRegion(fixture: ReturnType<typeof render>): string {
      const el = (fixture.nativeElement as HTMLElement).querySelector('[aria-live]');
      if (!el) throw new Error('a regiao viva sumiu da tela');
      return (el.textContent ?? '').trim();
    }

    function bannerText(fixture: ReturnType<typeof render>): string {
      const el = (fixture.nativeElement as HTMLElement).querySelector('app-alert-banner');
      if (!el) throw new Error('o banner de erro nao esta na tela');
      return (el.textContent ?? '').trim();
    }

    it('403: anuncia a RECUSA, a mesma frase que o banner exibe', () => {
      const fixture = render();
      error.set('Você não tem permissão para ver as vistorias desta empresa.');
      fixture.detectChanges();

      expect(liveRegion(fixture)).toBe(bannerText(fixture));
      expect(liveRegion(fixture)).toContain('permissão');
      // O defeito: a recusa sendo anunciada como falha de carregamento.
      expect(liveRegion(fixture)).not.toContain('Não foi possível carregar');
    });

    /**
     * CONTRAPESO: a metade que ja estava certa. A falha generica continua sendo anunciada
     * como sempre foi — se isto ficar vermelho, o conserto quebrou o que funcionava.
     */
    it('falha generica: segue anunciando o erro de carregamento, igual ao banner', () => {
      const fixture = render();
      error.set('Não foi possível carregar as vistorias.');
      fixture.detectChanges();

      expect(liveRegion(fixture)).toBe(bannerText(fixture));
      expect(liveRegion(fixture)).toContain('Não foi possível carregar as vistorias.');
    });

    /** Qualquer causa NOVA que o servico venha a distinguir chega sozinha aos dois canais. */
    it('uma causa futura do servico atravessa sem ninguem tocar na tela', () => {
      const fixture = render();
      error.set('Uma causa que ainda nao existe.');
      fixture.detectChanges();

      expect(liveRegion(fixture)).toBe('Uma causa que ainda nao existe.');
    });

    it('sem erro, a regiao viva segue contando as vistorias', () => {
      const fixture = render();
      total.set(3);
      fixture.detectChanges();

      expect(liveRegion(fixture)).toBe('3 vistorias encontradas.');
    });
  });
  /**
   * A FILA DA APROVACAO dentro da listagem que ja existe — sem rota nova.
   *
   * Sem o filtro de situacao a aprovacao seria inalcancavel na pratica: o dono
   * teria a tela e nenhum caminho ate a vistoria que a espera.
   */
  describe('fila de aprovacao', () => {
    const submitted: InspectionListItem = { ...item, id: 'insp-sub', status: 'SUBMITTED' };

    it('o filtro de situacao chega na API', () => {
      configure();
      const fixture = render();
      (fixture.componentInstance as unknown as Internals).onStatusChange('SUBMITTED');
      fixture.detectChanges();

      expect(listSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'SUBMITTED' }),
      );
    });

    it('"Todas" NAO manda status — filtro ausente nao e filtro vazio', () => {
      configure();
      const fixture = render();
      (fixture.componentInstance as unknown as Internals).onStatusChange('ALL');
      fixture.detectChanges();

      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ status: null }));
    });

    it('so a vistoria ENVIADA oferece revisar', () => {
      configure();
      items.set([{ ...item, status: 'APPROVED' }]);
      total.set(1);
      const fixture = render();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-review-toggle]'),
      ).toBeNull();
    });

    it('a decisao abre NA LINHA, sem sair da listagem', () => {
      configure();
      items.set([submitted]);
      total.set(1);
      const fixture = render();
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('app-inspection-review')).toBeNull();
      host.querySelector<HTMLButtonElement>('[data-review-toggle]')?.click();
      fixture.detectChanges();

      expect(host.querySelector('app-inspection-review')).not.toBeNull();
    });
  });
  // ------------------------------------------------------------------- A PORTA
  /**
   * O ciclo manual inteiro — fazer, enviar, aprovar — ja funcionava em producao, e NENHUM
   * template apontava para `/vistorias/nova`: a funcionalidade existia e ninguem chegava
   * nela. Este caso NOMEIA os dois caminhos para que nao possam sumir em silencio, que e
   * exatamente como eles nunca existiram.
   *
   * Afirma DESTINO (`href`), nao texto de botao: rotulo muda por decisao de copy, destino e
   * contrato de rota. Ja perdi um pino por procurar o texto.
   */
  /**
   * AS DUAS PORTAS DESTA TELA, agora como ACOES e nao como links.
   *
   * O que mudou e por que o teste mudou com isso:
   *  - AGENDAR deixou de apontar para `/veiculos`. O agendamento nao mora mais
   *    na tela do veiculo — o card de la foi removido, e a regra se cria aqui,
   *    com alvo frota OU um carro. Mandar a pessoa para Veiculos agora seria
   *    mandar para um lugar onde a funcionalidade nao esta mais.
   *  - FAZER deixou de ser `<a href="/vistorias/nova">`. A captura exige
   *    `?vehicleId=`; um link cru chega la e so sabe dizer que falta um carro.
   *    O botao pergunta o carro ANTES de navegar.
   *
   * O invariante e o mesmo de antes: desta tela se alcanca o ciclo manual E se
   * descobre que a vistoria periodica existe. So o mecanismo deixou de ser href.
   */
  it('a tela oferece FAZER vistoria e um caminho para o AGENDAMENTO', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;

    expect(
      host.querySelector('[data-start-inspection]'),
      'sem isto o ciclo manual fica inalcancavel desta tela',
    ).not.toBeNull();
    expect(
      host.querySelector('[data-schedule-inspection]'),
      'quem abre Vistorias nao descobre que a vistoria periodica existe',
    ).not.toBeNull();
  });
  // ------------------------------------------- LISTA ANTES, FILTRO DEPOIS
  /**
   * Filtro em cima de tabela vazia era a pior coisa que esta tela podia exibir numa
   * demonstracao: quem abre quer VER as vistorias, e a tela respondia com um painel de
   * controles. O conteudo passou a vir primeiro, e o filtro fica fechado onde se procura
   * quando a lista ja e grande demais.
   */
  /**
   * A TELA VIROU UM CARD SO, no padrao de `vehicles-list`: nao ha mais um card
   * "Vistorias" e um card "Filtros" em sequencia.
   *
   * ATENCAO ao que isto troca, porque troca de verdade: no DESKTOP a grade de
   * filtros fica ACIMA da lista, como em Veiculos. O que preserva a decisao
   * anterior ("lista primeiro") e o recolhimento mobile-only: no celular — onde
   * a reclamacao nasceu, com o filtro comendo a primeira tela — os controles
   * comecam fechados e a lista e a primeira coisa visivel.
   *
   * Se o dono preferir a grade abaixo da lista tambem no desktop, e mover um
   * bloco; o teste que fixa isso e este, e nao a lembranca de ninguem.
   */
  it('e UM card, com os filtros recolhidos no celular acima da lista', () => {
    const fixture = render({ openFilters: false });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('app-page-card').length).toBe(1);

    const markup = host.innerHTML;
    expect(markup.indexOf('insp-filtros')).toBeGreaterThan(-1);
    // O gatilho de recolher existe e e so do celular.
    const toggle = host.querySelector('[data-testid="filters-toggle"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.closest('.sm\\:hidden')).not.toBeNull();
  });

  /**
   * FECHADOS ao nascer, no celular.
   *
   * O mecanismo mudou e vale dizer qual: antes os controles eram REMOVIDOS do
   * DOM; agora o painel e escondido por classe (`hidden`), que e o padrao do
   * FIX-0284 em `vehicles-list`. `display:none` tambem sai da arvore de
   * acessibilidade e do foco, entao a garantia para quem usa a tela e a mesma —
   * mas o `querySelector` passa a encontrar o elemento, e e por isso que este
   * teste mede a CLASSE e nao a ausencia.
   */
  it('os filtros nascem recolhidos, e abrem quando a pessoa pede', () => {
    const fechado = render({ openFilters: false });
    const painelFechado = (fechado.nativeElement as HTMLElement).querySelector('#insp-filtros');
    expect(painelFechado, 'o painel de filtros desapareceu do template').not.toBeNull();
    expect(
      painelFechado?.classList.contains('hidden'),
      'os controles de filtro aparecem antes de alguem pedir',
    ).toBe(true);

    const aberto = render();
    const painelAberto = (aberto.nativeElement as HTMLElement).querySelector('#insp-filtros');
    expect(painelAberto?.classList.contains('hidden')).toBe(false);
    expect((aberto.nativeElement as HTMLElement).querySelector('select')).not.toBeNull();
  });
  /**
   * A PRIMEIRA TELA QUE UM CLIENTE VE numa empresa sem vistoria nenhuma. A copy antiga
   * descrevia o vazio ("elas aparecem aqui assim que a primeira for feita") e nao dizia COMO
   * sair dele. O estado vazio agora oferece a acao, para o mesmo destino da porta no topo.
   */
  it('o estado vazio OFERECE a acao, nao so descreve o vazio', () => {
    const fixture = render({ openFilters: false });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('Nenhuma vistoria ainda');
    const cta = Array.from(host.querySelectorAll('a')).find((a) =>
      (a.textContent ?? '').includes('Fazer a primeira vistoria'),
    );
    expect(cta, 'o estado vazio descreve o problema e nao oferece saida').toBeDefined();
    expect(cta?.getAttribute('href')).toBe('/vistorias/nova');
  });
});
