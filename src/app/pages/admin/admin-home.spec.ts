import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminHome } from './admin-home';
import { AdminMetricsService } from '../../services/admin-metrics.service';
import { NotificationService } from '../../services/notification.service';
import type { AdminOverviewResponse } from '../../types/admin-overview.types';

/**
 * Consolidado de aluguéis/contratos no painel de Administração.
 *
 * Duas armadilhas do contrato do backend estão cobertas aqui:
 *  - "fechado" (`closedTotal`) NÃO é "concluído": inclui RESERVED + ACTIVE +
 *    COMPLETED e exclui apenas CANCELED. Os dois recortes são exibidos com
 *    rótulos distintos;
 *  - `byStatus` é ESPARSO — status sem nenhum registro some do mapa. A ausência
 *    tem de virar zero, nunca `undefined` na tela.
 */
describe('AdminHome — consolidado de aluguéis e contratos', () => {
  const EMPTY_OVERVIEW: AdminOverviewResponse = {
    users: { total: 0, activeTotal: 0, newLast30Days: 0, newByDay: [] },
    companies: { total: 0, activeTotal: 0, newLast30Days: 0 },
    vehicles: { total: 0, activeTotal: 0 },
    subscriptions: {
      total: 0,
      active: 0,
      trialing: 0,
      byStatus: {},
      mrrCents: 0,
      mrrActiveOnlyCents: 0,
      arrCents: 0,
    },
    feedback: { total: 0, pending: 0, byStatus: {} },
    rentals: {
      closedTotal: 0,
      closedAmountCents: 0,
      completedTotal: 0,
      completedAmountCents: 0,
      byStatus: {},
    },
    contracts: { total: 0, signedTotal: 0 },
  };

  const POPULATED_OVERVIEW: AdminOverviewResponse = {
    ...EMPTY_OVERVIEW,
    rentals: {
      closedTotal: 42,
      closedAmountCents: 1_234_56,
      completedTotal: 30,
      completedAmountCents: 900_00,
      // COMPLETED e CANCELED omitidos de propósito: mapa esparso do backend.
      byStatus: { RESERVED: 7, ACTIVE: 5 },
    },
    contracts: { total: 25, signedTotal: 9 },
  };

  let overview: ReturnType<typeof signal<AdminOverviewResponse | null>>;

  function configure(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminHome],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AdminMetricsService,
          useValue: {
            overview,
            loading: signal(false),
            error: signal<string | null>(null),
            loadOverview: vi.fn().mockReturnValue(of(overview())),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            error: vi.fn(),
            success: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
  }

  /** Valor renderizado logo abaixo de um rótulo de card do consolidado. */
  function statValue(host: HTMLElement, label: string): string {
    const labels = Array.from(host.querySelectorAll('p'));
    const found = labels.find((p) => p.textContent?.trim() === label);
    expect(found, `rótulo "${label}" não encontrado`).toBeTruthy();
    return found?.nextElementSibling?.textContent?.trim() ?? '';
  }

  /** Texto da página com quebras de linha do template colapsadas. */
  function flatText(host: HTMLElement): string {
    return (host.textContent ?? '').replace(/\s+/g, ' ');
  }

  /** Contagem exibida na barra de um status de aluguel. */
  function barCount(host: HTMLElement, label: string): string {
    const spans = Array.from(host.querySelectorAll('span'));
    const found = spans.find((s) => s.textContent?.trim() === label);
    expect(found, `barra "${label}" não encontrada`).toBeTruthy();
    return found?.nextElementSibling?.textContent?.trim() ?? '';
  }

  function render(): HTMLElement {
    configure();
    const fixture = TestBed.createComponent(AdminHome);
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  beforeEach(() => {
    overview = signal<AdminOverviewResponse | null>(null);
  });

  it('exibe valor e quantidade de aluguéis fechados, concluídos e de contratos', () => {
    overview.set(POPULATED_OVERVIEW);
    const host = render();

    // Centavos -> BRL pelo mesmo formatador já usado pelo MRR/ARR da página.
    expect(statValue(host, 'Aluguéis fechados')).toContain('1.234,56');
    expect(flatText(host)).toContain('42 aluguéis');

    expect(statValue(host, 'Aluguéis concluídos')).toContain('900,00');
    expect(flatText(host)).toContain('30 aluguéis');

    expect(statValue(host, 'Contratos de locação')).toBe('25');
    expect(statValue(host, 'Contratos assinados')).toBe('9');
  });

  /**
   * A nota "Como ler os números de volume" foi REMOVIDA a pedido do dono
   * (FIX-0421) — não se perdeu por descuido, e este teste não deve ser usado
   * para ressuscitá-la.
   *
   * O que ele protege continua sendo o mesmo e continua valendo: os números de
   * volume não podem se apresentar de forma enganosa. Sem a nota, quem carrega
   * a ressalva é o PRÓPRIO cartão — e é isso que se afirma aqui. Se alguém
   * apagar também a legenda do cartão, este teste cai, que era a função da
   * versão anterior.
   *
   * Ficou de fora, e é consequência declarada da remoção: a DEFINIÇÃO de
   * "fechados" (reservado + em andamento + concluído) não está mais escrita em
   * lugar nenhum da tela. O cartão diz o que exclui, não o que soma.
   */
  it('não rotula o consolidado de forma enganosa nem mostra assinados como total', () => {
    overview.set(POPULATED_OVERVIEW);
    const host = render();
    const text = flatText(host);

    // "fechado" e "concluído" são recortes diferentes, e cada cartão diz o seu.
    expect(text).toContain('exclui cancelados');
    expect(text).toContain('aluguéis finalizados');
    // Assinados NUNCA aparece como se fosse o total.
    expect(text).toContain('de 25 contratos');
    expect(text).not.toContain('undefined');
  });

  /**
   * O pedido foi "igual aos cards existentes": os quatro números vivem na MESMA
   * grade de indicadores, não numa seção própria.
   */
  it('renderiza os números de volume dentro da grade de indicadores', () => {
    overview.set(POPULATED_OVERVIEW);
    const host = render();

    const grid = host.querySelector('div.grid.grid-cols-2');
    expect(grid, 'grade de indicadores não encontrada').toBeTruthy();

    const gridText = (grid?.textContent ?? '').replace(/\s+/g, ' ');
    for (const label of [
      'Usuários',
      'Aluguéis fechados',
      'Aluguéis concluídos',
      'Contratos de locação',
      'Contratos assinados',
    ]) {
      expect(gridText, `"${label}" fora da grade`).toContain(label);
    }
    expect(host.textContent).not.toContain('Volume consolidado');
  });

  it('trata status ausente do mapa esparso como zero', () => {
    overview.set(POPULATED_OVERVIEW);
    const host = render();

    expect(barCount(host, 'Reservado')).toBe('7');
    expect(barCount(host, 'Em andamento')).toBe('5');
    // Ausentes do payload: precisam renderizar 0, não sumir nem virar undefined.
    expect(barCount(host, 'Concluído')).toBe('0');
    expect(barCount(host, 'Cancelado')).toBe('0');
  });

  it('renderiza zeros em base vazia, sem undefined', () => {
    overview.set(EMPTY_OVERVIEW);
    const host = render();

    expect(statValue(host, 'Aluguéis fechados')).toContain('0,00');
    expect(statValue(host, 'Aluguéis concluídos')).toContain('0,00');
    expect(statValue(host, 'Contratos de locação')).toBe('0');
    expect(statValue(host, 'Contratos assinados')).toBe('0');
    expect(host.textContent).toContain('0 aluguéis');
    expect(host.textContent).not.toContain('undefined');
    expect(host.textContent).not.toContain('NaN');

    for (const label of ['Reservado', 'Em andamento', 'Concluído', 'Cancelado']) {
      expect(barCount(host, label)).toBe('0');
    }
  });

  it('mantém zeros quando a carga falha e o overview segue nulo', () => {
    const host = render();

    expect(statValue(host, 'Contratos de locação')).toBe('0');
    expect(statValue(host, 'Aluguéis fechados')).toContain('0,00');
    expect(host.textContent).not.toContain('undefined');
  });

  /**
   * FEAT-0121 — o grafico de novos usuarios deixou de ser SVG desenhado a mao e
   * passou a ser componente de biblioteca. O que a pagina deve garantir aqui e
   * que ela ENTREGA a serie certa e continua legivel sem o desenho (o canvas
   * nao renderiza no JSDOM, e e de proposito que a tabela carregue o dado).
   */
  describe('grafico de novos usuarios', () => {
    const COM_SERIE: AdminOverviewResponse = {
      ...POPULATED_OVERVIEW,
      users: {
        ...POPULATED_OVERVIEW.users,
        newByDay: [
          { date: '2026-09-01', count: 0 },
          { date: '2026-09-02', count: 3 },
          { date: '2026-09-03', count: 1 },
        ],
      },
    };

    it('entrega a serie ao grafico, legivel como texto', () => {
      overview.set(COM_SERIE);
      const host = render();

      expect(host.querySelector('app-line-chart'), 'grafico nao renderizou').not.toBeNull();

      const rows = Array.from(host.querySelectorAll('app-line-chart tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('th, td')).map((c) => c.textContent?.trim()),
      );
      expect(rows).toHaveLength(3);
      expect(rows[1]?.[1]).toBe('3');
    });

    /**
     * O pico agora e dito em TEXTO. Antes ele so existia como altura do
     * desenho — e a altura era sempre a mesma, qualquer que fosse o numero.
     */
    it('diz o pico do periodo em texto', () => {
      overview.set(COM_SERIE);

      expect(flatText(render())).toContain('Pico de 3 no período');
    });

    it('mostra o estado vazio quando nao ha serie', () => {
      overview.set(POPULATED_OVERVIEW);
      const host = render();

      expect(host.querySelector('app-line-chart')).toBeNull();
      expect(flatText(host)).toContain('Sem dados no período');
    });
  });
});
