import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { VehiclesList } from './vehicles-list';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import type { VehicleListItem } from '../../types/vehicle.types';

/**
 * Cobre as ações do menu "Ações" da listagem de veículos:
 *  - Gerenciar / Editar / Remover presentes no menu (mobile e desktop);
 *  - "Remover" só chama o service depois da confirmação no diálogo;
 *  - erro do servidor mantém o item na lista e mostra a mensagem do backend inline.
 */
describe('VehiclesList — menu de ações', () => {
  const vehicle: VehicleListItem = {
    id: 'v-1',
    plate: 'ABC1D23',
    type: 'CAR',
    brand: 'Fiat',
    model: 'Argo',
    yearModel: 2022,
    licensingExpiration: null,
    status: 'AVAILABLE',
    createdDate: '2024-01-01',
    sold: false,
  };

  let items: ReturnType<typeof signal<VehicleListItem[]>>;
  let removeSpy: ReturnType<typeof vi.fn>;
  let listSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    items = signal<VehicleListItem[]>([vehicle]);
    removeSpy = vi.fn().mockReturnValue(of(void 0));
    listSpy = vi.fn().mockReturnValue(of({ content: [vehicle], totalElements: 1 }));
    errorSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [VehiclesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: VehiclesService,
          useValue: {
            items,
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(1),
            list: listSpy,
            remove: removeSpy,
            updateStatus: vi.fn().mockReturnValue(of(vehicle)),
          },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: errorSpy } },
      ],
    });
  }

  /** Abre o menu de ações do escopo informado e devolve seus itens já renderizados. */
  function openMenuItems(
    fixture: { nativeElement: unknown; detectChanges: () => void },
    scope: 'mobile' | 'desktop',
  ): HTMLElement[] {
    const host = fixture.nativeElement as HTMLElement;
    const containers = Array.from(host.querySelectorAll('app-actions-menu'));
    // Os cards mobile vêm antes da tabela desktop no template.
    const container = scope === 'mobile' ? containers[0] : containers[containers.length - 1];
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    configure();
  });

  it.each(['mobile', 'desktop'] as const)(
    'expõe Gerenciar, Editar e Remover no menu (%s)',
    (scope) => {
      const fixture = TestBed.createComponent(VehiclesList);
      fixture.detectChanges();

      const menuItems = openMenuItems(fixture, scope);
      const labels = menuItems.map((el) => el.textContent?.trim());

      expect(menuItems.length).toBeGreaterThan(0);
      expect(labels).toContain('Gerenciar');
      expect(labels).toContain('Editar');
      expect(labels).toContain('Remover');
    },
  );

  it('Gerenciar e Editar apontam para as rotas de gerência e edição', () => {
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();

    const hrefs = openMenuItems(fixture, 'mobile')
      .filter((el): el is HTMLAnchorElement => el.tagName === 'A')
      .map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/veiculos/v-1/gerencia');
    expect(hrefs).toContain('/veiculos/v-1/editar');
  });

  it('"Remover" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      deletingVehicle: () => VehicleListItem | null;
      deleteMessage: () => string;
      confirmDelete: () => void;
    };

    const remove = openMenuItems(fixture, 'mobile').find(
      (el) => el.textContent?.trim() === 'Remover',
    );
    remove?.click();
    fixture.detectChanges();

    expect(component.deletingVehicle()?.id).toBe('v-1');
    expect(component.deleteMessage()).toContain('ABC-1D23');
    expect(component.deleteMessage()).toContain('não pode ser desfeita');
    expect(removeSpy).not.toHaveBeenCalled();

    component.confirmDelete();
    expect(removeSpy).toHaveBeenCalledWith('v-1');
  });

  it('erro do servidor mantém o veículo na lista e mostra a mensagem inline, sem toast', () => {
    removeSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Veículo possui aluguel ativo.' },
          }),
      ),
    );

    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      askDelete: (v: VehicleListItem) => void;
      confirmDelete: () => void;
    };

    component.askDelete(vehicle);
    component.confirmDelete();
    fixture.detectChanges();

    expect(removeSpy).toHaveBeenCalledWith('v-1');
    expect(items()).toHaveLength(1);

    // Feedback standard: banner inline, nunca toast.
    const banner = (fixture.nativeElement as HTMLElement).querySelector('app-alert-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Veículo possui aluguel ativo.');
    expect(banner?.querySelector('[role="alert"]')).not.toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // Padrão de listagem acessível (mesmo contrato de FinesList / TopOffendersTable).
  it('card mobile expõe role="button", nome acessível e micro-labels em neutral-500 (AA)', () => {
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const card = host.querySelector('article');
    expect(card?.getAttribute('role')).toBe('button');
    expect(card?.getAttribute('tabindex')).toBe('0');
    expect(card?.getAttribute('aria-label')).toContain('ABC1D23');

    expect(host.querySelectorAll('article span.text-neutral-500').length).toBeGreaterThan(0);
    // Nada de neutral-400 (2,98:1) em texto dentro do card — só o ícone decorativo da busca usa.
    expect(card?.querySelector('.text-neutral-400')).toBeNull();
  });

  /**
   * FEAT-0072 — vendidos FORA da listagem operacional.
   *
   * A ausência do parâmetro é o contrato: `sold` só viaja quando o operador
   * pede os vendidos. Mandar `sold: false` faria o backend receber um filtro
   * que ele interpreta como "explicitamente não vendidos" — mesmo resultado
   * hoje, mas é acoplamento que não precisa existir.
   */
  it('não manda `sold` na listagem operacional e manda `true` no filtro Vendidos', () => {
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    // Carga inicial: nada de `sold`.
    expect(listSpy).toHaveBeenCalled();
    const firstCall = listSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(firstCall['sold']).toBeUndefined();

    const select = host.querySelector<HTMLSelectElement>('#veiculos-sold');
    expect(select).not.toBeNull();
    // FIX-0264: prefixo como os irmãos "Tipo:"/"Status:" — o modo se anuncia.
    expect(Array.from(select?.options ?? []).map((o) => o.textContent?.trim())).toEqual([
      'Frota: atual',
      'Frota: vendidos',
    ]);

    listSpy.mockClear();
    select!.value = 'true';
    select!.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalled();
    const soldCall = listSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(soldCall['sold']).toBe(true);
  });
});
/**
 * FIX-0264 — modo Vendidos explícito na lista.
 *
 *  - chip "Vendido" por linha guiado pela flag `sold` do item (FIX-0263);
 *  - trocar para Vendidos zera o filtro de status e desabilita o select
 *    (os filtros compõem por AND; um status herdado esvaziaria a lista);
 *  - empty-state próprio no modo Vendidos, SEM o CTA de cadastro.
 */
describe('VehiclesList — modo Vendidos (FIX-0264)', () => {
  const base: VehicleListItem = {
    id: 'v-1',
    plate: 'ABC1D23',
    type: 'CAR',
    brand: 'Fiat',
    model: 'Argo',
    yearModel: 2022,
    licensingExpiration: null,
    status: 'AVAILABLE',
    createdDate: '2024-01-01',
    sold: false,
  };

  let items: ReturnType<typeof signal<VehicleListItem[]>>;
  let listSpy: ReturnType<typeof vi.fn>;

  function configure(initial: VehicleListItem[]): void {
    TestBed.resetTestingModule();
    items = signal<VehicleListItem[]>(initial);
    listSpy = vi.fn().mockReturnValue(of({ content: initial, totalElements: initial.length }));

    TestBed.configureTestingModule({
      imports: [VehiclesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: VehiclesService,
          useValue: {
            items,
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(initial.length),
            list: listSpy,
            remove: vi.fn().mockReturnValue(of(void 0)),
            updateStatus: vi.fn().mockReturnValue(of(base)),
          },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
  }

  function selectSoldMode(fixture: { nativeElement: unknown; detectChanges: () => void }): void {
    const host = fixture.nativeElement as HTMLElement;
    const sold = host.querySelector<HTMLSelectElement>('#veiculos-sold')!;
    sold.value = 'true';
    sold.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('renderiza o chip "Vendido" na linha quando `sold` é true — e só nela', () => {
    configure([base, { ...base, id: 'v-2', plate: 'XYZ9E88', sold: true }]);
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    // Card mobile + célula da tabela desktop, apenas para o item vendido.
    const chips = Array.from(host.querySelectorAll('[data-sold-chip]'));
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip.textContent?.trim()).toBe('Vendido');
      expect(chip.className).toContain('bg-neutral-800');
    }
    const soldCard = Array.from(host.querySelectorAll('article'))
      .find((c) => c.textContent?.includes('XYZ-9E88'));
    expect(soldCard?.querySelector('[data-sold-chip]')).not.toBeNull();
    const fleetCard = Array.from(host.querySelectorAll('article'))
      .find((c) => c.textContent?.includes('ABC-1D23'));
    expect(fleetCard?.querySelector('[data-sold-chip]')).toBeNull();
  });

  it('trocar para Vendidos zera o status (volta a "todos") e desabilita o select de status', async () => {
    configure([base]);
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    // Um status ativo antes da troca — o cenário que hoje esvazia a lista.
    const status = host.querySelector<HTMLSelectElement>('#veiculos-status')!;
    status.value = 'AVAILABLE';
    status.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    listSpy.mockClear();

    selectSoldMode(fixture);

    expect(listSpy).toHaveBeenCalled();
    const call = listSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(call['sold']).toBe(true);
    expect(call['status']).toBeUndefined();
    // NgModel aplica `disabled` num microtask — espere estabilizar antes de ler o DOM.
    await fixture.whenStable();
    fixture.detectChanges();
    expect(status.disabled).toBe(true);

    // Voltar para Frota atual reabilita o select.
    const sold = host.querySelector<HTMLSelectElement>('#veiculos-sold')!;
    sold.value = 'false';
    sold.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(status.disabled).toBe(false);
  });

  /**
   * FEAT-0080 — o empty-state da frota é o lembrete persistente de quem pulou
   * o gate de ativação: frota vazia SEM filtros fala em "primeiro veículo";
   * com filtro ativo a culpa pode ser do filtro e a mensagem genérica volta.
   */
  it('frota vazia sem filtros usa a mensagem de primeiro veículo; com filtro, a genérica sem CTA', async () => {
    configure([]);
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('Você ainda não cadastrou nenhum veículo.');
    expect(host.textContent).toContain('Cadastrar primeiro veículo');
    expect(host.textContent).not.toContain('Nenhum veículo encontrado com esses filtros.');

    const search = host.querySelector<HTMLInputElement>('#veiculos-search')!;
    search.value = 'Argo';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(host.textContent).toContain('Nenhum veículo encontrado com esses filtros.');
    expect(host.textContent).not.toContain('Você ainda não cadastrou nenhum veículo.');
    expect(host.textContent).not.toContain('Cadastrar primeiro veículo');
  });

  it('modo Vendidos vazio mostra mensagem própria e NÃO oferece "Cadastrar primeiro veículo"', () => {
    configure([]);
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    // Frota atual vazia sem filtros: mensagem de frota vazia + CTA de cadastro (FEAT-0080).
    expect(host.textContent).toContain('Você ainda não cadastrou nenhum veículo.');
    expect(host.textContent).toContain('Cadastrar primeiro veículo');

    selectSoldMode(fixture);

    expect(host.textContent).toContain('Nenhum veículo vendido ainda.');
    expect(host.textContent).not.toContain('Cadastrar primeiro veículo');
    expect(host.textContent).not.toContain('Nenhum veículo encontrado com esses filtros.');
  });

  it('modo Vendidos vazio COM busca ou tipo ativos usa a mensagem genérica de filtros, sem CTA', async () => {
    configure([]);
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();
    // O input de busca vive dentro de um <form>: o NgForm registra o controle
    // num microtask — sem estabilizar, o evento 'input' não chega ao signal.
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    selectSoldMode(fixture);

    // Busca ativa: o vazio pode ser culpa do termo, não da ausência de vendas.
    const search = host.querySelector<HTMLInputElement>('#veiculos-search')!;
    search.value = 'Argo';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(host.textContent).toContain('Nenhum veículo encontrado com esses filtros.');
    expect(host.textContent).not.toContain('Nenhum veículo vendido ainda.');
    expect(host.textContent).not.toContain('Cadastrar primeiro veículo');

    // Limpa a busca, ativa o tipo: mesmo tratamento.
    search.value = '';
    search.dispatchEvent(new Event('input'));
    const type = host.querySelector<HTMLSelectElement>('#veiculos-type')!;
    type.value = type.options[1].value;
    type.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(host.textContent).toContain('Nenhum veículo encontrado com esses filtros.');
    expect(host.textContent).not.toContain('Nenhum veículo vendido ainda.');
    expect(host.textContent).not.toContain('Cadastrar primeiro veículo');

    // Sem q/type, volta a mensagem própria do modo Vendidos.
    type.value = '';
    type.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(host.textContent).toContain('Nenhum veículo vendido ainda.');
  });
});

/**
 * FIX-0284 — filtros recolhidos no mobile.
 *
 * Medido em produção (375x658): os cinco controles empilhados + "Limpar
 * filtros" empurravam o primeiro card para y=583 de 658px úteis. O painel
 * passa a nascer recolhido no mobile, com a busca sempre visível e um botão
 * "Filtros" que ANUNCIA quantos filtros estão ativos — sem o contador, o
 * recolhimento esconderia o motivo de a lista estar curta.
 *
 * Desktop não muda: o toggle é `sm:hidden` e o painel é `sm:contents`, então a
 * partir de 640px os controles seguem itens diretos do grid de 6 colunas.
 */
describe('VehiclesList — painel de filtros no mobile (FIX-0284)', () => {
  const vehicle: VehicleListItem = {
    id: 'v-1',
    plate: 'ABC1D23',
    type: 'CAR',
    brand: 'Fiat',
    model: 'Argo',
    yearModel: 2022,
    licensingExpiration: null,
    status: 'AVAILABLE',
    createdDate: '2024-01-01',
    sold: false,
  };

  function configure(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [VehiclesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: VehiclesService,
          useValue: {
            items: signal<VehicleListItem[]>([vehicle]),
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(1),
            list: vi.fn().mockReturnValue(of({ content: [vehicle], totalElements: 1 })),
            remove: vi.fn().mockReturnValue(of(void 0)),
            updateStatus: vi.fn().mockReturnValue(of(vehicle)),
          },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
  }

  function render(): { host: HTMLElement; detect: () => void } {
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();
    return {
      host: fixture.nativeElement as HTMLElement,
      detect: () => fixture.detectChanges(),
    };
  }

  const toggleOf = (host: HTMLElement) =>
    host.querySelector<HTMLButtonElement>('[data-testid="filters-toggle"]')!;
  const panelOf = (host: HTMLElement) => host.querySelector<HTMLElement>('#veiculos-filtros')!;

  beforeEach(() => configure());

  it('nasce recolhido no mobile, com a busca visível e o painel escondido', () => {
    const { host } = render();

    // A busca NÃO entra no painel: continua fora do que é recolhido.
    const search = host.querySelector<HTMLInputElement>('#veiculos-search')!;
    expect(search).not.toBeNull();
    expect(search.closest('#veiculos-filtros')).toBeNull();

    const panel = panelOf(host);
    expect(panel.classList.contains('hidden')).toBe(true);
    expect(toggleOf(host).getAttribute('aria-expanded')).toBe('false');
  });

  it('o botão que expande liga aria-expanded/aria-controls ao painel e tem alvo de toque >= 44px', () => {
    const { host } = render();
    const toggle = toggleOf(host);

    expect(toggle.getAttribute('aria-controls')).toBe('veiculos-filtros');
    expect(panelOf(host).id).toBe('veiculos-filtros');
    expect(toggle.className).toContain('min-h-[44px]');
  });

  it('clique real expande e recolhe o painel', () => {
    const { host, detect } = render();
    const toggle = toggleOf(host);

    toggle.click();
    detect();
    expect(panelOf(host).classList.contains('hidden')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    detect();
    expect(panelOf(host).classList.contains('hidden')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('sem filtro ativo o botão é só "Filtros", sem contador', () => {
    const { host } = render();

    expect(toggleOf(host).textContent?.replace(/\s+/g, ' ').trim()).toBe('Filtros');
    expect(host.querySelector('[data-testid="filters-count"]')).toBeNull();
  });

  it('conta tipo, status e frota — e NAO conta ordenação, que só reordena', () => {
    const { host, detect } = render();

    const type = host.querySelector<HTMLSelectElement>('#veiculos-type')!;
    type.value = type.options[1].value;
    type.dispatchEvent(new Event('change'));
    detect();
    expect(host.querySelector('[data-testid="filters-count"]')?.textContent).toContain('1');

    const status = host.querySelector<HTMLSelectElement>('#veiculos-status')!;
    status.value = 'AVAILABLE';
    status.dispatchEvent(new Event('change'));
    detect();
    expect(toggleOf(host).textContent?.replace(/\s+/g, ' ').trim()).toBe('Filtros · 2');

    // Ordenação REORDENA, nunca encurta: não pode virar "mais um filtro ativo".
    const sort = host.querySelector<HTMLSelectElement>('#veiculos-sort')!;
    sort.value = sort.options[1].value;
    sort.dispatchEvent(new Event('change'));
    detect();
    expect(toggleOf(host).textContent?.replace(/\s+/g, ' ').trim()).toBe('Filtros · 2');

    // Frota: vendidos zera o status (FIX-0264) — sobram tipo + frota.
    const sold = host.querySelector<HTMLSelectElement>('#veiculos-sold')!;
    sold.value = 'true';
    sold.dispatchEvent(new Event('change'));
    detect();
    expect(toggleOf(host).textContent?.replace(/\s+/g, ' ').trim()).toBe('Filtros · 2');

    // "Limpar filtros" do painel devolve o contador a zero.
    const clear = host.querySelector<HTMLButtonElement>('#veiculos-filtros button')!;
    expect(clear.textContent?.trim()).toBe('Limpar filtros');
    clear.click();
    detect();
    expect(host.querySelector('[data-testid="filters-count"]')).toBeNull();
  });

  it('o nome acessível diz "ativos" por extenso em vez do ponto médio', () => {
    const { host, detect } = render();
    expect(toggleOf(host).getAttribute('aria-label')).toBe('Filtros');

    const type = host.querySelector<HTMLSelectElement>('#veiculos-type')!;
    type.value = type.options[1].value;
    type.dispatchEvent(new Event('change'));
    detect();
    expect(toggleOf(host).getAttribute('aria-label')).toBe('Filtros, 1 ativo');

    const status = host.querySelector<HTMLSelectElement>('#veiculos-status')!;
    status.value = 'AVAILABLE';
    status.dispatchEvent(new Event('change'));
    detect();
    expect(toggleOf(host).getAttribute('aria-label')).toBe('Filtros, 2 ativos');
  });

  it('com filtro ativo e painel recolhido, limpar não exige expandir', () => {
    const { host, detect } = render();
    const shortcut = () =>
      host.querySelector<HTMLButtonElement>('[data-testid="filters-clear-shortcut"]');

    // Sem filtro ativo não há o que limpar: o atalho nem existe.
    expect(shortcut()).toBeNull();

    const type = host.querySelector<HTMLSelectElement>('#veiculos-type')!;
    type.value = type.options[1].value;
    type.dispatchEvent(new Event('change'));
    detect();

    // Atalho visível FORA do painel recolhido.
    expect(panelOf(host).classList.contains('hidden')).toBe(true);
    expect(shortcut()).not.toBeNull();
    expect(shortcut()!.closest('#veiculos-filtros')).toBeNull();
    expect(shortcut()!.className).toContain('min-h-[44px]');

    shortcut()!.click();
    detect();
    expect(host.querySelector('[data-testid="filters-count"]')).toBeNull();
    expect(shortcut()).toBeNull();
  });

  it('guarda de CLASSE do desktop (a não-regressão real é verificação de navegador)', () => {
    // jsdom não avalia media query: este teste NAO prova que o desktop segue
    // igual, só trava as classes que carregam esse contrato. Que em >= 640px
    // `contents` vence `none` na cascata foi conferido compilando o Tailwind e
    // lendo a ordem das regras na CSS gerada — fora do jsdom, de propósito.
    const { host } = render();

    expect(toggleOf(host).closest('div')?.className).toContain('sm:hidden');
    expect(panelOf(host).className).toContain('sm:contents');
  });
});
