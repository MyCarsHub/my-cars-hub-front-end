import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectionsList, SEARCH_DEBOUNCE_MS } from './inspections-list';
import { InspectionsService } from '../../services/inspections.service';
import { InspectionScheduleService } from '../../services/inspection-schedule.service';
import { VehiclesService } from '../../services/vehicles.service';
import { ApiErrorService } from '../../services/api-error.service';
import { RentalService } from '../rentals/rental.service';
import type { InspectionListItem, InspectionSummary } from '../../types/inspection.types';
import type { RentalListItemDto } from '../../types/rental.types';

/**
 * `/vistorias` — a lista em cards, no desenho do handoff de vistorias v2.
 *
 * Os testes afirmam o comportamento da TELA — os numeros do topo, os filtros que viajam na
 * consulta, o cartao, os quatro estados e o recorte do motorista —, nao o formato do backend:
 * esse tem o proprio spec em `services/inspections.service.spec.ts`.
 *
 * A acao parte do ELEMENTO renderizado (select, campo, botao), nao de um metodo do componente:
 * apagar um controle do template tem de derrubar o teste.
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
    performedAt: '2026-09-10T12:00:00',
    status: 'APPROVED',
    photoCount: 14,
  };

  const SUMMARY: InspectionSummary = { submitted: 2, pending: 1, approved: 5, rejected: 3 };

  let items: ReturnType<typeof signal<InspectionListItem[]>>;
  let total: ReturnType<typeof signal<number>>;
  let error: ReturnType<typeof signal<string | null>>;
  let loading: ReturnType<typeof signal<boolean>>;
  let page: ReturnType<typeof signal<number>>;
  let listSpy: ReturnType<typeof vi.fn>;
  let summarySpy: ReturnType<typeof vi.fn>;
  let vehiclesList: ReturnType<typeof vi.fn>;
  let rentalsList: ReturnType<typeof vi.fn>;
  let scheduleList: ReturnType<typeof vi.fn>;
  let getOneSpy: ReturnType<typeof vi.fn>;

  /** O token com o papel — a mesma fonte que o `roleGuard` e a tela leem. */
  function signInAs(role: string): void {
    const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    sessionStorage.setItem('token', `header.${b64}.signature`);
  }

  function configure(): void {
    TestBed.resetTestingModule();
    items = signal<InspectionListItem[]>([]);
    total = signal(0);
    error = signal<string | null>(null);
    loading = signal(false);
    page = signal(0);
    listSpy = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));
    summarySpy = vi.fn().mockReturnValue(of(SUMMARY));
    vehiclesList = vi.fn().mockReturnValue(
      of({
        content: [{ id: 'veh-1', plate: 'ABC1D23', model: 'Argo' }],
        page: 0,
        size: 100,
        total: 1,
      }),
    );
    rentalsList = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));
    scheduleList = vi.fn().mockReturnValue(of([]));
    getOneSpy = vi.fn().mockReturnValue(of({ rejectionReason: 'painel tremido' }));

    TestBed.configureTestingModule({
      imports: [InspectionsList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: InspectionsService,
          useValue: {
            items,
            total,
            error,
            page,
            size: signal(20),
            loading,
            list: listSpy,
            summary: summarySpy,
            getOne: getOneSpy,
          },
        },
        { provide: InspectionScheduleService, useValue: { listForCompany: scheduleList } },
        { provide: VehiclesService, useValue: { list: vehiclesList } },
        { provide: RentalService, useValue: { list: rentalsList } },
      ],
    });
  }

  function render() {
    const fixture = TestBed.createComponent(InspectionsList);
    fixture.detectChanges();
    return fixture;
  }

  const host = (fixture: ReturnType<typeof render>) => fixture.nativeElement as HTMLElement;

  function text(fixture: ReturnType<typeof render>): string {
    return (host(fixture).textContent ?? '').replace(/\s+/g, ' ');
  }

  /** Os parametros da ULTIMA chamada a lista. */
  function lastQuery(): Record<string, unknown> {
    return listSpy.mock.calls[listSpy.mock.calls.length - 1][0] as Record<string, unknown>;
  }

  function pick(fixture: ReturnType<typeof render>, selector: string, value: string): void {
    const select = host(fixture).querySelector<HTMLSelectElement>(selector)!;
    expect(select, `controle ${selector} nao esta na tela`).not.toBeNull();
    // CONTROLE POSITIVO: sem a opcao no DOM, atribuir o value nao pega e o teste passaria a vazio.
    expect(Array.from(select.options).map((o) => o.value)).toContain(value);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function type(fixture: ReturnType<typeof render>, value: string): HTMLInputElement {
    const input = host(fixture).querySelector<HTMLInputElement>('[data-search]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    return input;
  }

  const cards = (fixture: ReturnType<typeof render>) =>
    Array.from(host(fixture).querySelectorAll<HTMLElement>('[data-inspection-card]'));

  beforeEach(() => {
    sessionStorage.clear();
    signInAs('OWNER');
    configure();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================ carga e estrutura

  it('carrega a primeira pagina ao abrir, sem filtro e do mais recente para o mais antigo', () => {
    render();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toEqual({
      page: 0,
      kind: null,
      status: null,
      q: null,
      sort: 'date,desc',
    });
  });

  it('a ordem da pagina e: tiles, vistorias automaticas, lista', () => {
    const fixture = render();
    const html = host(fixture).innerHTML;

    const tiles = html.indexOf('data-kpi="submitted"');
    const schedule = html.indexOf('data-schedule-card');
    const list = html.indexOf('data-search');

    expect(tiles).toBeGreaterThan(-1);
    expect(schedule).toBeGreaterThan(tiles);
    expect(list).toBeGreaterThan(schedule);
  });

  // ================================================================== OS TILES

  describe('tiles do topo', () => {
    const tile = (fixture: ReturnType<typeof render>, key: string) =>
      host(fixture).querySelector<HTMLElement>(`[data-kpi="${key}"]`)!;

    it('mostram a contagem de GET /inspections/summary, na ordem e com as legendas do desenho', () => {
      const fixture = render();

      expect(summarySpy).toHaveBeenCalledTimes(1);
      const keys = Array.from(host(fixture).querySelectorAll('[data-kpi]')).map((el) =>
        el.getAttribute('data-kpi'),
      );
      expect(keys).toEqual(['submitted', 'pending', 'approved', 'rejected']);

      // Um `<p>` por linha do tile (rotulo, numero, legenda): junta com espaco para ler como frase.
      const read = (key: string) =>
        Array.from(tile(fixture, key).querySelectorAll('p'))
          .map((p) => (p.textContent ?? '').trim())
          .join(' ');
      expect(read('submitted')).toBe('Aguardando aprovação 2 precisam da sua decisão');
      expect(read('pending')).toBe('Em andamento 1 fotos sendo tiradas');
      expect(read('approved')).toBe('Aprovadas 5 laudo em PDF disponível');
      expect(read('rejected')).toBe('Recusadas 3 aguardam nova vistoria');
    });

    it('usam as quatro aparencias do desenho: laranja, verde escuro, verde e branco', () => {
      const fixture = render();

      expect(tile(fixture, 'submitted').className).toContain('bg-primary-500');
      expect(tile(fixture, 'pending').className).toContain('bg-emerald-700');
      expect(tile(fixture, 'approved').className).toContain('bg-emerald-600');
      expect(tile(fixture, 'rejected').className).toContain('bg-white');
      expect(tile(fixture, 'rejected').className).toContain('border');
    });

    /**
     * As colunas seguem a LARGURA DA AREA DE CONTEUDO (container query), nao a da janela: com a
     * barra lateral aberta, uma janela de 1100px deixa ~840px para a pagina — e `lg:` a
     * trataria como larga. 820px de container = os 900px de `main` do desenho.
     */
    it('sao 2 colunas no celular e 4 quando a area de conteudo e larga', () => {
      const fixture = render();
      const grid = tile(fixture, 'submitted').parentElement!;

      expect(grid.className).toContain('grid-cols-2');
      expect(grid.className).toContain('@min-[820px]:grid-cols-4');
      expect(grid.closest('[class*="@container"]')).not.toBeNull();
    });

    it('os numeros sao da EMPRESA: filtrar a lista nao os relê nem os muda', () => {
      const fixture = render();
      pick(fixture, '[data-filter-status]', 'REJECTED');
      pick(fixture, '[data-filter-kind]', 'CHECKOUT');

      expect(summarySpy).toHaveBeenCalledTimes(1);
      expect(summarySpy).toHaveBeenCalledWith();
    });

    it('enquanto carregam mostram a barra, nao um numero', () => {
      summarySpy.mockReturnValue(new Subject<InspectionSummary>());
      const fixture = render();

      expect(tile(fixture, 'submitted').querySelector('.animate-pulse')).not.toBeNull();
      expect(tile(fixture, 'submitted').textContent).not.toMatch(/\d/);
    });

    /**
     * Zero inventado diria "nada a decidir" justamente quando a tela nao sabe. O tile fica em
     * "—" e a lista segue funcionando.
     */
    it('se o resumo falha, mostram "—" e nunca um zero', () => {
      summarySpy.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      items.set([item]);
      total.set(1);
      const fixture = render();

      for (const key of ['submitted', 'pending', 'approved', 'rejected']) {
        const label = (tile(fixture, key).textContent ?? '').replace(/\s+/g, ' ');
        expect(label, `tile ${key}`).toContain('—');
        expect(label, `tile ${key}`).not.toMatch(/\b0\b/);
      }
      // CONTROLE POSITIVO: a falha do resumo nao derrubou a lista.
      expect(cards(fixture).length).toBe(1);
    });

    it('"Tentar novamente" do erro da lista relê tambem os numeros', () => {
      error.set('Não foi possível carregar as vistorias.');
      const fixture = render();

      host(fixture).querySelector<HTMLButtonElement>('[data-retry-list]')?.click();

      expect(listSpy).toHaveBeenCalledTimes(2);
      expect(summarySpy).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================ filtros e busca

  describe('filtros, busca e ordenacao', () => {
    it('Situacao, Tipo e Ordenar vao na consulta e voltam para a primeira pagina', () => {
      total.set(60);
      page.set(2);
      const fixture = render();

      pick(fixture, '[data-filter-status]', 'SUBMITTED');
      expect(lastQuery()).toMatchObject({ status: 'SUBMITTED', page: 0 });

      pick(fixture, '[data-filter-kind]', 'CHECKOUT');
      expect(lastQuery()).toMatchObject({ status: 'SUBMITTED', kind: 'CHECKOUT', page: 0 });

      pick(fixture, '[data-filter-sort]', 'date,asc');
      expect(lastQuery()).toMatchObject({
        status: 'SUBMITTED',
        kind: 'CHECKOUT',
        sort: 'date,asc',
        page: 0,
      });
    });

    it('oferece as opcoes do desenho, mais Frota em Tipo', () => {
      const fixture = render();
      const labels = (selector: string) =>
        Array.from(host(fixture).querySelector<HTMLSelectElement>(selector)!.options).map((o) =>
          o.textContent?.trim(),
        );

      expect(labels('[data-filter-status]')).toEqual([
        'Situação: Todas',
        'Situação: Aguardando aprovação',
        'Situação: Em andamento',
        'Situação: Aprovada',
        'Situação: Recusada',
      ]);
      expect(labels('[data-filter-kind]')).toEqual([
        'Tipo: Todos',
        'Tipo: Retirada',
        'Tipo: Devolução',
        'Tipo: Frota',
      ]);
      expect(labels('[data-filter-sort]')).toEqual([
        'Ordenar: Mais recentes',
        'Ordenar: Mais antigas',
      ]);
    });

    it('"Todas" e "Todos" NAO mandam o parametro — ausente nao e vazio', () => {
      const fixture = render();
      pick(fixture, '[data-filter-status]', 'APPROVED');
      pick(fixture, '[data-filter-status]', 'ALL');
      pick(fixture, '[data-filter-kind]', 'FLEET');
      pick(fixture, '[data-filter-kind]', 'ALL');

      expect(lastQuery()).toMatchObject({ status: null, kind: null });
    });

    it('a busca espera a pessoa parar de digitar e vai como q, aparada', () => {
      vi.useFakeTimers();
      const fixture = render();
      const callsBefore = listSpy.mock.calls.length;

      type(fixture, '  abc');
      type(fixture, '  abc1d');
      expect(listSpy).toHaveBeenCalledTimes(callsBefore);

      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      fixture.detectChanges();

      expect(listSpy).toHaveBeenCalledTimes(callsBefore + 1);
      expect(lastQuery()).toMatchObject({ q: 'abc1d', page: 0 });
    });

    it('Enter busca na hora e o debounce pendente nao repete a consulta', () => {
      vi.useFakeTimers();
      const fixture = render();
      const callsBefore = listSpy.mock.calls.length;

      const input = type(fixture, 'argo');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();
      expect(lastQuery()).toMatchObject({ q: 'argo' });
      expect(listSpy).toHaveBeenCalledTimes(callsBefore + 1);

      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
      expect(listSpy).toHaveBeenCalledTimes(callsBefore + 1);
    });

    it('o campo limita a busca a 60 caracteres, como o servidor', () => {
      const fixture = render();
      const input = host(fixture).querySelector<HTMLInputElement>('[data-search]')!;

      expect(input.getAttribute('maxlength')).toBe('60');
      expect(input.getAttribute('placeholder')).toBe('Buscar por placa, modelo ou motorista…');
    });

    it('os quatro valem ao mesmo tempo', () => {
      const fixture = render();
      pick(fixture, '[data-filter-status]', 'REJECTED');
      pick(fixture, '[data-filter-kind]', 'CHECKIN');
      pick(fixture, '[data-filter-sort]', 'date,asc');
      const input = type(fixture, 'gol');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();

      expect(lastQuery()).toEqual({
        page: 0,
        status: 'REJECTED',
        kind: 'CHECKIN',
        sort: 'date,asc',
        q: 'gol',
      });
    });

    it('"Limpar filtros" esta SEMPRE na tela, mesmo sem filtro nenhum', () => {
      const fixture = render();

      const button = host(fixture).querySelector<HTMLButtonElement>('[data-clear-filters]');
      expect(button).not.toBeNull();
      expect(button?.textContent?.trim()).toBe('Limpar filtros');
    });

    it('"Limpar filtros" zera busca, situacao, tipo e ordenacao — na consulta e nos campos', () => {
      const fixture = render();
      pick(fixture, '[data-filter-status]', 'REJECTED');
      pick(fixture, '[data-filter-kind]', 'CHECKIN');
      pick(fixture, '[data-filter-sort]', 'date,asc');
      const input = type(fixture, 'gol');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();
      expect(lastQuery()).toMatchObject({ status: 'REJECTED', q: 'gol' });

      host(fixture).querySelector<HTMLButtonElement>('[data-clear-filters]')?.click();
      fixture.detectChanges();

      expect(lastQuery()).toEqual({
        page: 0,
        status: null,
        kind: null,
        sort: 'date,desc',
        q: null,
      });
      expect(host(fixture).querySelector<HTMLSelectElement>('[data-filter-status]')?.value).toBe('ALL');
      expect(host(fixture).querySelector<HTMLSelectElement>('[data-filter-kind]')?.value).toBe('ALL');
      expect(host(fixture).querySelector<HTMLSelectElement>('[data-filter-sort]')?.value).toBe(
        'date,desc',
      );
      expect(host(fixture).querySelector<HTMLInputElement>('[data-search]')?.value).toBe('');
    });

    /**
     * Item de grade nasce com `min-width:auto` e NAO encolhe abaixo do conteudo: sem `min-w-0`
     * uma placa longa empurra a grade e a pagina rola para o lado no celular.
     */
    it('todo item da grade de filtros tem min-w-0', () => {
      const fixture = render();
      const input = host(fixture).querySelector('[data-search]')!;
      const grid = input.closest('.grid')!;
      const children = Array.from(grid.children);

      expect(children.length).toBe(4);
      for (const child of children) {
        expect(child.className, `item sem min-w-0: ${child.className}`).toContain('min-w-0');
      }
      // 1 coluna, depois 3 (a busca ocupa a linha toda), depois 4 com a busca mais larga.
      expect(grid.className).toContain('grid-cols-1');
      expect(grid.className).toContain('@min-[592px]:grid-cols-3');
      expect(grid.className).toContain('@min-[820px]:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]');
      expect(children[0].className).toContain('@min-[592px]:col-span-3');
      expect(children[0].className).toContain('@min-[820px]:col-span-1');
    });
  });

  // ================================================================ o cartao

  describe('cartao da vistoria', () => {
    it('mostra placa, situacao, modelo, motorista e "Tipo · data · N/14 fotos"', () => {
      items.set([item]);
      total.set(1);
      const fixture = render();
      const card = cards(fixture)[0];

      expect(card.querySelector('[data-plate]')?.textContent?.trim()).toBe('ABC1D23');
      expect(card.querySelector('[data-plate]')?.className).toContain('font-mono');
      expect(card.querySelector('[data-status-chip]')?.textContent?.trim()).toBe('Aprovada');
      expect(card.querySelector('[data-model]')?.textContent?.trim()).toBe('Fiat Argo');
      expect(card.querySelector('[data-driver]')?.textContent?.trim()).toBe('Fulano de Tal');
      expect((card.querySelector('[data-meta]')?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(
        'Devolução · 10/09/2026 · 14/14 fotos',
      );
    });

    it('o chip de situacao vem do mapa de status, com as cores do desenho', () => {
      const chip = (status: InspectionListItem['status']) => {
        items.set([{ ...item, status }]);
        total.set(1);
        const el = cards(render())[0].querySelector('[data-status-chip]') as HTMLElement;
        return { label: el.textContent?.trim(), cls: el.className };
      };

      expect(chip('PENDING')).toMatchObject({ label: 'Em andamento' });
      expect(chip('PENDING').cls).toContain('bg-neutral-100');
      expect(chip('SUBMITTED')).toMatchObject({ label: 'Aguardando aprovação' });
      expect(chip('SUBMITTED').cls).toContain('bg-amber-100');
      expect(chip('APPROVED').cls).toContain('bg-emerald-100');
      expect(chip('REJECTED')).toMatchObject({ label: 'Recusada' });
      expect(chip('REJECTED').cls).toContain('bg-rose-100');
    });

    it('com menos de 14 fotos, o "N/14" fica ambar; com 14, nao', () => {
      items.set([{ ...item, photoCount: 9 }, { ...item, id: 'insp-2', photoCount: 14 }]);
      total.set(2);
      const fixture = render();
      const counts = cards(fixture).map(
        (c) => c.querySelector('[data-photo-count]') as HTMLElement,
      );

      expect(counts[0].textContent?.trim()).toBe('9/14 fotos');
      expect(counts[0].className).toContain('text-amber-700');
      expect(counts[1].textContent?.trim()).toBe('14/14 fotos');
      expect(counts[1].className).not.toContain('text-amber-700');
    });

    it('zero fotos medido aparece como "0/14 fotos": zero nao e ausencia', () => {
      items.set([{ ...item, status: 'PENDING', photoCount: 0 }]);
      total.set(1);

      expect(text(render())).toContain('0/14 fotos');
    });

    it('com a foto da frente, mostra a imagem; sem ela, o placeholder do carro', () => {
      items.set([
        { ...item, frontPhotoUrl: 'https://cdn/front-1.jpg' },
        { ...item, id: 'insp-2', frontPhotoUrl: null },
      ]);
      total.set(2);
      const fixture = render();
      const [withPhoto, without] = cards(fixture);

      expect(withPhoto.querySelector('[data-front-photo]')?.getAttribute('src')).toBe(
        'https://cdn/front-1.jpg',
      );
      expect(withPhoto.querySelector('[data-photo-placeholder]')).toBeNull();
      expect(without.querySelector('[data-front-photo]')).toBeNull();
      expect(without.querySelector('[data-photo-placeholder]')).not.toBeNull();
    });

    it('a foto sem legenda por cima', () => {
      items.set([{ ...item, frontPhotoUrl: 'https://cdn/front-1.jpg' }]);
      total.set(1);
      const fixture = render();
      const photo = cards(fixture)[0].querySelector('[data-front-photo]')!;

      expect(photo.getAttribute('alt')).toBe('');
      expect(photo.parentElement?.textContent?.trim()).toBe('');
    });

    it('URL vencida (a imagem nao carrega) cai no placeholder em vez de um icone quebrado', () => {
      items.set([{ ...item, frontPhotoUrl: 'https://cdn/expirada.jpg' }]);
      total.set(1);
      const fixture = render();

      cards(fixture)[0]
        .querySelector('[data-front-photo]')
        ?.dispatchEvent(new Event('error'));
      fixture.detectChanges();

      expect(cards(fixture)[0].querySelector('[data-front-photo]')).toBeNull();
      expect(cards(fixture)[0].querySelector('[data-photo-placeholder]')).not.toBeNull();
    });

    it('"Revisar vistoria" so na que aguarda decisao; as demais, "Ver detalhes"', () => {
      items.set([
        { ...item, id: 'insp-sub', status: 'SUBMITTED' },
        { ...item, id: 'insp-pen', status: 'PENDING' },
        { ...item, id: 'insp-rej', status: 'REJECTED' },
        { ...item, id: 'insp-app', status: 'APPROVED' },
      ]);
      total.set(4);
      const fixture = render();
      const links = cards(fixture).map(
        (c) => c.querySelector<HTMLAnchorElement>('[data-open-inspection]')!,
      );

      expect(links.map((a) => a.textContent?.trim())).toEqual([
        'Revisar vistoria',
        'Ver detalhes',
        'Ver detalhes',
        'Ver detalhes',
      ]);
      // Afirma DESTINO, nao so o texto do botao: rotulo muda por copy, rota e contrato.
      expect(links.map((a) => a.getAttribute('href'))).toEqual([
        '/vistorias/insp-sub',
        '/vistorias/insp-pen',
        '/vistorias/insp-rej',
        '/vistorias/insp-app',
      ]);
    });

    it('o alvo de toque tem 44px, largura total e e arredondado', () => {
      items.set([item]);
      total.set(1);
      const link = cards(render())[0].querySelector('[data-open-inspection]')!;

      expect(link.className).toContain('min-h-[44px]');
      expect(link.className).toContain('w-full');
      expect(link.className).toContain('rounded-full');
    });

    it('o nome acessivel do botao contem o texto visivel e a placa', () => {
      items.set([{ ...item, status: 'SUBMITTED' }]);
      total.set(1);
      const link = cards(render())[0].querySelector('[data-open-inspection]')!;

      expect(link.getAttribute('aria-label')).toBe('Revisar vistoria do veículo ABC1D23');
    });

    it('a grade e 1 coluna no celular e 2 quando a area de conteudo e larga', () => {
      items.set([item]);
      total.set(1);
      const grid = cards(render())[0].parentElement!;

      expect(grid.className).toContain('grid-cols-1');
      expect(grid.className).toContain('@min-[820px]:grid-cols-2');
    });

    it('a foto mede 112px no celular, 148px no meio e 188px no largo', () => {
      items.set([item]);
      total.set(1);
      const photo = cards(render())[0].firstElementChild!;

      expect(photo.className).toContain('w-28');
      expect(photo.className).toContain('@min-[592px]:w-[148px]');
      expect(photo.className).toContain('@min-[820px]:w-[188px]');
      expect(photo.className).toContain('self-stretch');
      expect(photo.className).toContain('rounded-xl');
    });

    it('o chip de situacao nao quebra em duas linhas', () => {
      items.set([{ ...item, status: 'SUBMITTED' }]);
      total.set(1);
      const chip = cards(render())[0].querySelector('[data-status-chip]')!;

      expect(chip.className).toContain('whitespace-nowrap');
    });

    describe('campos ausentes', () => {
      const bare: InspectionListItem = {
        id: 'insp-9',
        rentalId: null,
        vehicleId: 'veh-9',
        kind: 'FLEET',
        performedAt: '2026-09-10T12:00:00',
        status: 'PENDING',
      };

      it('sem placa diz que o carro nao foi identificado e nao escreve undefined', () => {
        items.set([bare]);
        total.set(1);
        const body = text(render());

        expect(body).toContain('Veículo não identificado');
        expect(body).not.toContain('undefined');
        expect(body).not.toContain('null');
      });

      it('sem a contagem de fotos omite o trecho, em vez de escrever zero', () => {
        items.set([bare]);
        total.set(1);
        const fixture = render();

        expect(cards(fixture)[0].querySelector('[data-photo-count]')).toBeNull();
        expect(text(fixture)).toContain('Frota · 10/09/2026');
      });
    });
  });

  // =============================================================== paginacao

  describe('rodape de paginacao', () => {
    it('diz "N vistorias — pagina X de Y" e desabilita o que nao existe', () => {
      items.set([item]);
      total.set(45);
      const fixture = render();

      expect(
        host(fixture).querySelector('[data-pagination-summary]')?.textContent?.replace(/\s+/g, ' ').trim(),
      ).toBe('45 vistorias — página 1 de 3');
      expect(host(fixture).querySelector<HTMLButtonElement>('[data-prev]')?.disabled).toBe(true);
      expect(host(fixture).querySelector<HTMLButtonElement>('[data-next]')?.disabled).toBe(false);
      expect(host(fixture).querySelector('[data-count]')?.textContent?.trim()).toBe('45 vistorias');
    });

    it('o plural esta resolvido: "1 vistoria"', () => {
      items.set([item]);
      total.set(1);
      const fixture = render();

      expect(host(fixture).querySelector('[data-count]')?.textContent?.trim()).toBe('1 vistoria');
      expect(
        host(fixture).querySelector('[data-pagination-summary]')?.textContent?.replace(/\s+/g, ' ').trim(),
      ).toBe('1 vistoria — página 1 de 1');
    });

    it('Proxima e Anterior pedem a pagina vizinha mantendo os filtros', () => {
      items.set([item]);
      total.set(45);
      const fixture = render();
      pick(fixture, '[data-filter-status]', 'APPROVED');

      host(fixture).querySelector<HTMLButtonElement>('[data-next]')?.click();
      expect(lastQuery()).toMatchObject({ page: 1, status: 'APPROVED' });

      page.set(1);
      fixture.detectChanges();
      host(fixture).querySelector<HTMLButtonElement>('[data-prev]')?.click();
      expect(lastQuery()).toMatchObject({ page: 0, status: 'APPROVED' });
    });

    it('Anterior e Proxima tem 44px de alvo', () => {
      items.set([item]);
      total.set(45);
      const fixture = render();

      for (const sel of ['[data-prev]', '[data-next]']) {
        expect(host(fixture).querySelector(sel)?.className).toContain('min-h-[44px]');
      }
    });
  });

  // ============================================================ os 4 estados

  describe('os quatro estados', () => {
    it('carregando: 4 blocos de esqueleto e nenhum cartao nem texto de vazio', () => {
      loading.set(true);
      const fixture = render();
      const skeleton = host(fixture).querySelector('[data-skeleton]')!;

      expect(skeleton.children.length).toBe(4);
      for (const block of Array.from(skeleton.children)) {
        expect(block.className).toContain('animate-pulse');
        expect(block.className).toContain('rounded-2xl');
      }
      expect(cards(fixture).length).toBe(0);
      expect(text(fixture)).not.toContain('Nenhuma vistoria');
      expect(text(fixture)).not.toContain('Carregando…');
    });

    it('erro: banner com a causa e "Tentar novamente"', () => {
      error.set('Não foi possível carregar as vistorias.');
      const fixture = render();
      const banner = host(fixture).querySelector('app-alert-banner')!;

      expect(banner.textContent).toContain('Não foi possível carregar as vistorias.');
      expect(banner.querySelector('[data-retry-list]')?.textContent?.trim()).toBe(
        'Tentar novamente',
      );
      // Erro nao vira "nenhuma vistoria": a tela nao sabe se ha ou nao.
      expect(text(fixture)).not.toContain('Nenhuma vistoria ainda');
    });

    it('vazio sem filtro: diz o que fazer, sem inventar uma acao', () => {
      const fixture = render();
      const empty = host(fixture).querySelector('[data-empty]')!;

      expect(empty.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'Nenhuma vistoria ainda. Quando um motorista enviar as fotos pelo celular, ela aparece aqui para você aprovar.',
      );
      expect(host(fixture).querySelector('[data-empty-filtered]')).toBeNull();
    });

    it('vazio com filtro: outra frase, e o botao zera os filtros', () => {
      const fixture = render();
      pick(fixture, '[data-filter-status]', 'REJECTED');

      const empty = host(fixture).querySelector('[data-empty-filtered]')!;
      expect(empty.textContent).toContain('Nenhuma vistoria encontrada com estes filtros.');
      expect(text(fixture)).not.toContain('Nenhuma vistoria ainda');

      const button = Array.from(empty.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Limpar filtros',
      )!;
      expect(button).toBeDefined();
      button.click();
      expect(lastQuery()).toMatchObject({ status: null });
    });

    it('so a ordenacao NAO conta como filtro: vazio continua sendo "nenhuma ainda"', () => {
      const fixture = render();
      pick(fixture, '[data-filter-sort]', 'date,asc');

      expect(host(fixture).querySelector('[data-empty]')).not.toBeNull();
      expect(host(fixture).querySelector('[data-empty-filtered]')).toBeNull();
    });
  });

  /**
   * FIX-0565 — a regiao viva anunciava uma frase FIXA de falha de carregamento, enquanto o
   * banner mostrava a causa que o servico apurou. Os testes comparam os DOIS canais entre si:
   * o que precisa valer e que eles nao possam divergir.
   */
  describe('FIX-0565 — o aria-live diz a MESMA coisa que o banner', () => {
    function liveRegion(fixture: ReturnType<typeof render>): string {
      const el = host(fixture).querySelector('[aria-live]');
      if (!el) throw new Error('a regiao viva sumiu da tela');
      return (el.textContent ?? '').trim();
    }

    function bannerText(fixture: ReturnType<typeof render>): string {
      const el = host(fixture).querySelector('app-alert-banner');
      if (!el) throw new Error('o banner de erro nao esta na tela');
      return (el.querySelector('span')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    }

    it('403: anuncia a RECUSA, a mesma frase que o banner exibe', () => {
      const fixture = render();
      error.set('Você não tem permissão para ver as vistorias desta empresa.');
      fixture.detectChanges();

      expect(bannerText(fixture)).toContain(liveRegion(fixture));
      expect(liveRegion(fixture)).toContain('permissão');
      expect(liveRegion(fixture)).not.toContain('Não foi possível carregar');
    });

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

  // ================================================== vistorias automaticas

  describe('cartao de vistorias automaticas (dono)', () => {
    it('esta na tela e e neutro, com UM botao outline — nada laranja', () => {
      const fixture = render();
      const card = host(fixture).querySelector('[data-schedule-card]')!;
      const button = card.querySelector<HTMLButtonElement>('[data-schedule-open]')!;

      expect(card.className).toContain('bg-white');
      expect(button.className).toContain('border-neutral-200');
      expect(button.className).not.toContain('bg-primary');
      expect(card.innerHTML).not.toContain('bg-primary');
    });

    it('desligado: chip "Desligado" e botao "Configurar"', () => {
      const fixture = render();
      const card = host(fixture).querySelector('[data-schedule-card]')!;

      expect(card.querySelector('[data-schedule-chip]')?.textContent?.trim()).toBe('Desligado');
      expect(card.querySelector('[data-schedule-open]')?.textContent?.trim()).toBe('Configurar');
    });
  });

  // ======================================================== "Fazer vistoria"

  describe('porta do dono para fotografar um carro', () => {
    const start = (fixture: ReturnType<typeof render>) =>
      host(fixture).querySelector<HTMLButtonElement>('[data-start-inspection]');

    it('abre o seletor de carro, e comeca a captura com o carro escolhido', () => {
      const fixture = render();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      start(fixture)?.click();
      fixture.detectChanges();
      pick(fixture, '[data-start-vehicle]', 'veh-1');
      host(fixture).querySelector<HTMLButtonElement>('[data-start-confirm]')?.click();

      expect(navigate).toHaveBeenCalledWith(['/vistorias', 'nova'], {
        queryParams: { vehicleId: 'veh-1' },
      });
    });

    it('sem escolher o carro, explica em vez de abrir uma captura em erro', () => {
      const fixture = render();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      start(fixture)?.click();
      fixture.detectChanges();
      host(fixture).querySelector<HTMLButtonElement>('[data-start-confirm]')?.click();
      fixture.detectChanges();

      expect(navigate).not.toHaveBeenCalled();
      expect(text(fixture)).toContain('Escolha o carro que você vai vistoriar.');
    });

    /**
     * O DEFEITO: o seletor pedia `size: 500`, o backend limita a 100 em silencio, e todo carro
     * do 101o em diante simplesmente nao existia. A tela PAGINA ate o total.
     */
    it('carrega TODAS as paginas de veiculos ate o total, sem pedir 500', () => {
      const pageOf = (n: number, count: number, totalCount: number) => ({
        content: Array.from({ length: count }, (_, i) => ({
          id: `veh-${n}-${i}`,
          plate: `AAA${n}${String(i).padStart(3, '0')}`,
          model: 'Argo',
        })),
        page: n,
        size: 100,
        total: totalCount,
      });
      vehiclesList.mockImplementation((f: { page: number }) =>
        of(f.page === 0 ? pageOf(0, 100, 230) : f.page === 1 ? pageOf(1, 100, 230) : pageOf(2, 30, 230)),
      );
      const fixture = render();
      start(fixture)?.click();
      fixture.detectChanges();

      // 230 veiculos + a opcao "Escolha o carro".
      expect(host(fixture).querySelectorAll('[data-start-vehicle] option').length).toBe(231);
      expect(vehiclesList.mock.calls.map(([f]) => f.page)).toEqual([0, 1, 2]);
      for (const [f] of vehiclesList.mock.calls) expect(f.size).toBe(100);
    });

    it('falha numa pagina do meio mantem as que ja chegaram', () => {
      vehiclesList.mockImplementation((f: { page: number }) =>
        f.page === 0
          ? of({
              content: [{ id: 'veh-a', plate: 'AAA0001', model: 'Argo' }],
              page: 0,
              size: 1,
              total: 5,
            })
          : throwError(() => new HttpErrorResponse({ status: 500 })),
      );
      const fixture = render();
      start(fixture)?.click();
      fixture.detectChanges();

      expect(host(fixture).querySelectorAll('[data-start-vehicle] option').length).toBe(2);
    });
  });

  // ================================================================ MOTORISTA

  /**
   * A listagem abriu para o motorista, e o que muda nela e o recorte: so as DELE (o servidor
   * escopa), com o MESMO cartao, sem nada da empresa — tiles, agendamento, revisao — e com
   * uma porta propria, o carro do aluguel ATIVO.
   */
  describe('motorista (prototipo "Motorista Vistorias")', () => {
    const rental = {
      id: 'r-1',
      vehicleId: 'veh-9',
      driverId: 'd-1',
      vehiclePlate: 'XYZ9K88',
      vehicleBrand: 'VW',
      vehicleModel: 'Gol',
      driverName: 'Eu Mesmo',
      status: 'ACTIVE',
    } as unknown as RentalListItemDto;

    beforeEach(() => {
      sessionStorage.clear();
      signInAs('DRIVER');
      rentalsList.mockReturnValue(of({ content: [rental], page: 0, size: 20, total: 1 }));
    });

    const hero = (fixture: ReturnType<typeof render>) =>
      host(fixture).querySelector<HTMLElement>('[data-driver-hero]');
    const driverCards = (fixture: ReturnType<typeof render>) =>
      Array.from(host(fixture).querySelectorAll<HTMLElement>('[data-driver-card]'));

    it('NAO chama a lista de veiculos da empresa nem o resumo: sao da empresa', () => {
      render();

      expect(vehiclesList).not.toHaveBeenCalled();
      expect(summarySpy).not.toHaveBeenCalled();
    });

    it('troca a tela do dono pela do prototipo: sem tiles, agendamento, filtros nem revisar', () => {
      items.set([{ ...item, status: 'SUBMITTED' }]);
      total.set(1);
      const fixture = render();

      expect(host(fixture).querySelector('app-driver-inspections-home')).not.toBeNull();
      expect(host(fixture).querySelector('[data-kpi]')).toBeNull();
      expect(host(fixture).querySelector('app-inspection-schedules-block')).toBeNull();
      expect(host(fixture).querySelector('[data-start-inspection]')).toBeNull();
      expect(host(fixture).querySelector('[data-filter-status]')).toBeNull();
      expect(text(fixture)).not.toContain('Revisar vistoria');
      // CONTROLE POSITIVO: o cartao dele esta la, com placa e situacao.
      expect(driverCards(fixture)[0].querySelector('[data-driver-plate]')?.textContent?.trim()).toBe(
        'ABC1D23',
      );
      expect(driverCards(fixture)[0].querySelector('[data-driver-chip]')?.textContent?.trim()).toBe(
        'Aguardando aprovação',
      );
    });

    it('o dono, na mesma linha, continua vendo a tela dele com "Revisar vistoria"', () => {
      sessionStorage.clear();
      signInAs('OWNER');
      items.set([{ ...item, status: 'SUBMITTED' }]);
      total.set(1);
      const fixture = render();

      expect(host(fixture).querySelector('app-driver-inspections-home')).toBeNull();
      expect(text(fixture)).toContain('Revisar vistoria');
    });

    it('a em andamento volta para a captura; o resto abre os detalhes', () => {
      items.set([
        { ...item, id: 'a', status: 'PENDING', photoCount: 5 },
        { ...item, id: 'b', status: 'REJECTED' },
        { ...item, id: 'c', status: 'APPROVED' },
      ]);
      total.set(3);
      const fixture = render();
      const links = driverCards(fixture).map(
        (c) => c.querySelector<HTMLAnchorElement>('[data-driver-open]')!,
      );

      expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
        ['Continuar vistoria', '/vistorias/a/captura'],
        ['Ver detalhes', '/vistorias/b'],
        ['Ver detalhes', '/vistorias/c'],
      ]);
      const notes = driverCards(fixture).map(
        (c) => c.querySelector('[data-driver-note]')?.textContent?.trim() ?? null,
      );
      expect(notes).toEqual([null, 'Precisa refazer', 'Laudo em PDF disponível']);
    });

    it('sem vistoria aberta, o hero oferece COMEÇAR no carro do aluguel ativo', () => {
      const fixture = render();

      expect(rentalsList).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }));
      expect(hero(fixture)?.getAttribute('data-tone')).toBe('primary');
      expect(hero(fixture)?.textContent).toContain('Vistoria do XYZ9K88');
      expect(
        hero(fixture)?.querySelector('[data-driver-hero-cta]')?.textContent?.trim(),
      ).toBe('Começar vistoria');
    });

    it('o botao do hero abre a captura com o veiculo do aluguel', () => {
      const fixture = render();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      hero(fixture)?.querySelector<HTMLButtonElement>('[data-driver-hero-cta]')?.click();

      expect(navigate).toHaveBeenCalledWith(['/vistorias', 'nova'], {
        queryParams: { vehicleId: 'veh-9' },
      });
    });

    it('com uma em andamento, o hero manda continuar (e nao abre outra)', () => {
      items.set([{ ...item, id: 'a', status: 'PENDING', photoCount: 5 }]);
      total.set(1);
      const fixture = render();
      const cta = hero(fixture)?.querySelector<HTMLAnchorElement>('[data-driver-hero-cta]');

      expect(hero(fixture)?.textContent).toContain('5 de 14 fotos tiradas');
      expect(cta?.textContent?.trim()).toBe('Continuar vistoria');
      expect(cta?.getAttribute('href')).toBe('/vistorias/a/captura');
    });

    it('com a ultima recusada, o hero mostra o motivo e refaz em um toque', () => {
      items.set([
        { ...item, id: 'b', status: 'REJECTED' },
        { ...item, id: 'c', status: 'APPROVED' },
      ]);
      total.set(2);
      const fixture = render();
      const cta = hero(fixture)?.querySelector<HTMLAnchorElement>('[data-driver-hero-cta]');

      expect(getOneSpy).toHaveBeenCalledWith('b');
      expect(hero(fixture)?.getAttribute('data-tone')).toBe('rose');
      expect(hero(fixture)?.querySelector('[data-driver-hero-sub]')?.textContent).toContain(
        'Motivo: painel tremido',
      );
      expect(cta?.textContent?.trim()).toBe('Refazer vistoria');
      // The link only OPENS the refused one: the redo is a tap there, never a side effect.
      expect(cta?.getAttribute('href')).toBe('/vistorias/b/captura');
    });

    it('lista que falhou NAO vira "Começar vistoria": o estado e o erro com tentar de novo', () => {
      listSpy.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
      error.set('Não foi possível carregar as vistorias.');
      const fixture = render();

      expect(hero(fixture)).toBeNull();
      expect(host(fixture).querySelector('[data-driver-hero-cta]')).toBeNull();
      expect(text(fixture)).not.toContain('Começar vistoria');
      expect(host(fixture).querySelector('[data-driver-retry-list]')).not.toBeNull();
    });

    it('o hero vem SO da pagina 0: a pagina 2 (antigas) nao muda o que fazer agora', () => {
      items.set([{ ...item, id: 'a', status: 'PENDING', photoCount: 5 }]);
      total.set(25);
      const fixture = render();
      expect(hero(fixture)?.textContent).toContain('Continuar vistoria');

      // Page 2: an old refusal, already redone. It must not take over the hero.
      items.set([{ ...item, id: 'old', status: 'REJECTED' }]);
      host(fixture).querySelector<HTMLButtonElement>('[data-driver-next]')!.click();
      fixture.detectChanges();

      expect(lastQuery()['page']).toBe(1);
      expect(hero(fixture)?.textContent).toContain('Continuar vistoria');
      expect(hero(fixture)?.textContent).not.toContain('Refaça');
      expect(getOneSpy).not.toHaveBeenCalledWith('old');
    });

    it('com a ultima enviada, o hero diz que aguarda a locadora, sem acao', () => {
      items.set([{ ...item, status: 'SUBMITTED' }]);
      total.set(1);
      const fixture = render();

      expect(hero(fixture)?.getAttribute('data-tone')).toBe('emerald');
      expect(hero(fixture)?.textContent).toContain('Aguardando a locadora');
      expect(hero(fixture)?.querySelector('[data-driver-hero-cta]')).toBeNull();
    });

    it('sem aluguel ativo explica por que nao ha o que fotografar', () => {
      rentalsList.mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));
      const fixture = render();

      expect(hero(fixture)?.querySelector('[data-driver-hero-cta]')).toBeNull();
      expect(hero(fixture)?.textContent).toContain('aluguel ativo');
    });

    it('falha ao achar o aluguel oferece tentar de novo, e o retry chama de novo', () => {
      rentalsList.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      const fixture = render();

      expect(text(fixture)).toContain('Não conseguimos achar o seu aluguel ativo');
      rentalsList.mockReturnValue(of({ content: [rental], page: 0, size: 20, total: 1 }));
      host(fixture)
        .querySelector('[data-driver-hero-error]')
        ?.querySelector<HTMLButtonElement>('button')
        ?.click();
      fixture.detectChanges();

      expect(rentalsList).toHaveBeenCalledTimes(2);
      expect(hero(fixture)?.querySelector('[data-driver-hero-cta]')).not.toBeNull();
    });

    it('os quatro estados: skeleton, erro com tentar de novo, vazio sem cartao vazio', () => {
      loading.set(true);
      const fixture = render();
      expect(host(fixture).querySelector('[data-driver-skeleton]')).not.toBeNull();

      loading.set(false);
      error.set('Não foi possível carregar as vistorias.');
      fixture.detectChanges();
      const retryButton = host(fixture).querySelector<HTMLButtonElement>('[data-driver-retry-list]');
      expect(retryButton).not.toBeNull();
      const before = listSpy.mock.calls.length;
      retryButton!.click();
      expect(listSpy.mock.calls.length).toBe(before + 1);

      error.set(null);
      fixture.detectChanges();
      expect(host(fixture).querySelector('[data-driver-empty]')?.textContent).toContain(
        'Você ainda não fez nenhuma vistoria',
      );
      expect(host(fixture).querySelector('[data-driver-list]')).toBeNull();
    });

    it('a miniatura e um quadrado preso ao topo do cartao', () => {
      items.set([{ ...item, frontPhotoUrl: 'https://x/front.jpg' }]);
      total.set(1);
      const fixture = render();
      const thumb = driverCards(fixture)[0].querySelector<HTMLElement>('[data-driver-thumb]')!;

      expect(thumb.className).toContain('aspect-square');
      expect(thumb.className).toContain('self-start');
      expect(thumb.querySelector('img')?.className).toContain('object-cover');
    });
  });
});
