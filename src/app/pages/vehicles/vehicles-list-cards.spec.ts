import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { Observable, Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { VehiclesList } from './vehicles-list';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import type { VehicleListItem } from '../../types/vehicle.types';

/**
 * A lista de veículos no padrão da lista de Vistorias: cards com miniatura
 * QUADRADA (foto do veículo → frente da última vistoria aprovada →
 * placeholder com a placa) e os quatro estados da lista — skeleton, erro com
 * «Tentar novamente», vazio e vazio com filtros.
 */
describe('VehiclesList — cards com miniatura', () => {
  const base: VehicleListItem = {
    id: 'v-1',
    plate: 'ABC1D23',
    type: 'CAR',
    brand: 'Fiat',
    model: 'Argo',
    yearModel: 2024,
    licensingExpiration: null,
    status: 'AVAILABLE',
    createdDate: '2024-01-01',
    sold: false,
  };

  let items: ReturnType<typeof signal<VehicleListItem[]>>;
  let loading: ReturnType<typeof signal<boolean>>;
  let error: ReturnType<typeof signal<string | null>>;
  let listSpy: ReturnType<typeof vi.fn>;

  function render(
    initial: VehicleListItem[],
    opts: { loading?: boolean; error?: string | null; list?: Observable<unknown> } = {},
  ) {
    TestBed.resetTestingModule();
    items = signal<VehicleListItem[]>(initial);
    loading = signal(opts.loading ?? false);
    error = signal<string | null>(opts.error ?? null);
    listSpy = vi.fn().mockReturnValue(opts.list ?? of({ content: initial, total: initial.length }));

    TestBed.configureTestingModule({
      imports: [VehiclesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: VehiclesService,
          useValue: {
            items,
            loading,
            error,
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
    const fixture = TestBed.createComponent(VehiclesList);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  const thumbOf = (card: Element) => card.querySelector<HTMLElement>('[data-vehicle-thumb]')!;

  beforeEach(() => TestBed.resetTestingModule());

  // ------------------------------------------------------------ miniatura

  it('pede a miniatura ao servidor (includePhoto) na carga da lista', () => {
    render([base]);

    expect(listSpy).toHaveBeenCalled();
    expect((listSpy.mock.calls[0][0] as Record<string, unknown>)['includePhoto']).toBe(true);
  });

  it('card COM foto do veículo mostra a imagem na miniatura quadrada', () => {
    const { host } = render([
      { ...base, photoUrl: 'https://cdn.test/v-1.jpg', photoSource: 'VEHICLE' },
    ]);

    const card = host.querySelector('[data-vehicle-card]')!;
    const img = card.querySelector<HTMLImageElement>('[data-vehicle-photo]');
    expect(img?.getAttribute('src')).toBe('https://cdn.test/v-1.jpg');
    expect(img?.getAttribute('alt')).toBe('');
    expect(card.querySelector('[data-vehicle-photo-placeholder]')).toBeNull();
    expect(thumbOf(card).getAttribute('data-photo-source')).toBe('VEHICLE');
  });

  it('card SEM foto mostra o placeholder com o ícone do carro e a placa', () => {
    const { host } = render([{ ...base, photoUrl: null, photoSource: null }]);

    const card = host.querySelector('[data-vehicle-card]')!;
    expect(card.querySelector('[data-vehicle-photo]')).toBeNull();
    expect(card.querySelector('[data-vehicle-photo-placeholder]')).not.toBeNull();
    expect(card.querySelector('[data-vehicle-placeholder-plate]')?.textContent?.trim()).toBe('ABC-1D23');
    expect(thumbOf(card).getAttribute('data-photo-source')).toBeNull();
  });

  it('card no FALLBACK da vistoria usa a frente da última vistoria aprovada', () => {
    const { host } = render([
      { ...base, photoUrl: 'https://cdn.test/front.jpg', photoSource: 'INSPECTION' },
    ]);

    const card = host.querySelector('[data-vehicle-card]')!;
    expect(card.querySelector('[data-vehicle-photo]')?.getAttribute('src')).toBe('https://cdn.test/front.jpg');
    expect(thumbOf(card).getAttribute('data-photo-source')).toBe('INSPECTION');
  });

  it('foto que falha ao carregar (URL vencida) cai no placeholder, sem quadro quebrado', () => {
    const { fixture, host } = render([
      { ...base, photoUrl: 'https://cdn.test/expired.jpg', photoSource: 'VEHICLE' },
    ]);

    host.querySelector('[data-vehicle-photo]')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(host.querySelector('[data-vehicle-photo]')).toBeNull();
    expect(host.querySelector('[data-vehicle-photo-placeholder]')).not.toBeNull();
  });

  /**
   * A lista fica retida no serviço raiz e sobrevive à navegação; a URL assinada
   * vive poucos minutos. Voltar à tela repinta as URLs vencidas enquanto a
   * recarga não responde. A ordem que apagava a foto, medida em produção: a
   * recarga parte, a URL velha falha, a lista nova chega.
   */
  describe('URL assinada vencida na lista retida', () => {
    const stale: VehicleListItem = {
      ...base,
      photoUrl: 'https://cdn.test/v-1.jpg?token=vencido',
      photoSource: 'VEHICLE',
    };
    const fresh: VehicleListItem = { ...stale, photoUrl: 'https://cdn.test/v-1.jpg?token=novo' };

    const photo = (host: HTMLElement) => host.querySelector<HTMLImageElement>('[data-vehicle-photo]');
    const placeholder = (host: HTMLElement) => host.querySelector('[data-vehicle-photo-placeholder]');

    function failPhoto(fixture: { detectChanges(): void }, host: HTMLElement): void {
      photo(host)!.dispatchEvent(new Event('error'));
      fixture.detectChanges();
    }

    /** Dispara uma recarga pelo gesto real: trocar o filtro de tipo. */
    function changeFilter(fixture: { detectChanges(): void }, host: HTMLElement): void {
      const type = host.querySelector<HTMLSelectElement>('#veiculos-type')!;
      type.value = type.options[1].value;
      type.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }

    it('a falha da URL velha não suprime a URL nova que chega depois', () => {
      const pending = new Subject<unknown>();
      const { fixture, host } = render([stale], { list: pending });

      failPhoto(fixture, host);
      expect(placeholder(host)).not.toBeNull();

      items.set([fresh]);
      pending.next({ content: [fresh], total: 1 });
      pending.complete();
      fixture.detectChanges();

      expect(photo(host)?.getAttribute('src')).toBe(fresh.photoUrl);
      expect(placeholder(host)).toBeNull();
    });

    it('a URL nova que também falha cai no placeholder, sem quadro quebrado', () => {
      const { fixture, host } = render([fresh]);

      failPhoto(fixture, host);

      expect(photo(host)).toBeNull();
      expect(placeholder(host)).not.toBeNull();
    });

    it('a recarga em voo não devolve à tela a URL que já falhou', () => {
      const { fixture, host } = render([stale]);
      failPhoto(fixture, host);

      listSpy.mockReturnValue(new Subject<unknown>());
      changeFilter(fixture, host);

      expect(photo(host)).toBeNull();
      expect(placeholder(host)).not.toBeNull();
    });

    it('a falha não sobrevive à carga seguinte: a mesma URL volta a ser tentada', () => {
      const { fixture, host } = render([fresh]);
      failPhoto(fixture, host);

      changeFilter(fixture, host);

      expect(photo(host)?.getAttribute('src')).toBe(fresh.photoUrl);
      expect(placeholder(host)).toBeNull();
    });

    it('recarga que falha não finge que a URL velha voltou a valer', () => {
      const { fixture, host } = render([stale]);
      failPhoto(fixture, host);

      listSpy.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      changeFilter(fixture, host);

      expect(photo(host)).toBeNull();
      expect(placeholder(host)).not.toBeNull();
    });
  });

  /**
   * Regra do dono: miniatura SEMPRE quadrada, no celular e no desktop — os
   * mesmos degraus da lista de Vistorias. jsdom não calcula layout; a prova
   * visual é a captura a 375 e 1280 px, este teste trava as classes.
   */
  it('a miniatura é quadrada nos dois degraus (104px e 148px) e presa ao topo', () => {
    const { host } = render([base]);

    const classes = thumbOf(host.querySelector('[data-vehicle-card]')!).className.split(/\s+/);
    expect(classes).toContain('aspect-square');
    expect(classes).toContain('size-[104px]');
    expect(classes).toContain('@min-[592px]:size-[148px]');
    expect(classes).toContain('self-start');
    expect(classes.some((c) => /^(w|h)-/.test(c))).toBe(false);
  });

  it('mostra placa, chip de status do status-maps e modelo no card', () => {
    const { host } = render([{ ...base, status: 'MAINTENANCE' }]);

    const card = host.querySelector('[data-vehicle-card]')!;
    expect(card.querySelector('[data-vehicle-plate]')?.textContent?.trim()).toBe('ABC-1D23');
    const chip = card.querySelector<HTMLElement>('[data-vehicle-status-chip]')!;
    expect(chip.textContent?.trim()).toBe('Manutenção');
    expect(card.querySelector('[data-vehicle-model]')?.textContent).toContain('Fiat Argo');
  });

  // ------------------------------------------------------- estados da lista

  it('SKELETON: carregando sem itens desenha os cards fantasmas e nenhum vazio', () => {
    const { host } = render([], { loading: true });

    expect(host.querySelector('[data-vehicles-skeleton]')).not.toBeNull();
    expect(host.querySelector('[data-vehicles-empty]')).toBeNull();
    expect(host.querySelector('[data-vehicle-card]')).toBeNull();
  });

  it('ERRO: banner com «Tentar novamente» que refaz a carga — e sem o vazio por cima', () => {
    const { fixture, host } = render([], { error: 'Não foi possível carregar os veículos.' });

    const banner = host.querySelector('[data-vehicles-load-error]')!;
    expect(banner.textContent).toContain('Não foi possível carregar os veículos.');
    expect(host.querySelector('[data-vehicles-empty]')).toBeNull();
    expect(host.querySelector('[data-vehicles-empty-filtered]')).toBeNull();

    listSpy.mockClear();
    const retry = banner.querySelector<HTMLButtonElement>('[data-vehicles-retry]')!;
    expect(retry.textContent?.trim()).toBe('Tentar novamente');
    expect(retry.className).toContain('min-h-11');
    retry.click();
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect((listSpy.mock.calls[0][0] as Record<string, unknown>)['page']).toBe(0);
  });

  it('VAZIO: frota sem veículos mostra o convite ao primeiro cadastro', () => {
    const { host } = render([]);

    expect(host.querySelector('[data-vehicles-empty]')?.textContent).toContain(
      'Você ainda não cadastrou nenhum veículo.',
    );
    expect(host.querySelector('[data-vehicles-empty-filtered]')).toBeNull();
    expect(host.querySelector('[data-vehicles-skeleton]')).toBeNull();
  });

  it('VAZIO COM FILTROS: mensagem de filtro e «Limpar filtros» que recarrega sem filtro', () => {
    const { fixture, host } = render([]);

    const type = host.querySelector<HTMLSelectElement>('#veiculos-type')!;
    type.value = type.options[1].value;
    type.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(host.querySelector('[data-vehicles-empty-filtered]')?.textContent).toContain(
      'Nenhum veículo encontrado com esses filtros.',
    );
    expect(host.querySelector('[data-vehicles-empty]')).toBeNull();

    listSpy.mockClear();
    host.querySelector<HTMLButtonElement>('[data-vehicles-empty-clear]')!.click();
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect((listSpy.mock.calls[0][0] as Record<string, unknown>)['type']).toBeUndefined();
    expect(host.querySelector('[data-vehicles-empty]')).not.toBeNull();
  });

  // ------------------------------------------------------------ mobile-first

  it('controles de filtro têm 16px no celular (sem zoom do iOS) e alvo de 44px', () => {
    const { host } = render([base]);

    for (const id of ['#veiculos-search', '#veiculos-type', '#veiculos-status', '#veiculos-sold', '#veiculos-sort']) {
      const classes = host.querySelector<HTMLElement>(id)!.className.split(/\s+/);
      expect(classes, id).toContain('text-base');
      expect(classes, id).toContain('min-h-11');
      expect(classes.filter((c) => c === 'text-sm'), id).toHaveLength(0);
    }
  });
});
