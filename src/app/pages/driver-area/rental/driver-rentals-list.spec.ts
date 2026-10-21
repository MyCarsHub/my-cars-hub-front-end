import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorService } from '../../../services/api-error.service';
import { DriverRentalChargesService } from '../../../services/driver-rental-charges.service';
import { DriverCharge } from '../../../types/driver-charges.types';
import { PagedResponse } from '../../../types/paged.types';
import { RentalListItemDto } from '../../../types/rental.types';
import { RentalService } from '../../rentals/rental.service';
import { DriverRentalsList } from './driver-rentals-list';
import { DRIVER_RENTAL_TODAY } from './driver-rental-view';

const flat = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const TODAY = '2026-10-10';

const row = (over: Partial<RentalListItemDto>): RentalListItemDto => ({
  id: 'r',
  vehicleId: 'v',
  driverId: 'd',
  startDate: '2026-08-04',
  endDate: '2027-02-03',
  totalAmount: 0,
  caucaoAmount: 0,
  status: 'ACTIVE',
  billingFrequency: 'WEEKLY',
  ...over,
});

/** The prototype's three rentals. */
const ROWS: RentalListItemDto[] = [
  row({ id: 'r1', vehiclePlate: 'SJH-2B17', vehicleBrand: 'Fiat', vehicleModel: 'Mobi', status: 'ACTIVE', startDate: '2026-08-04' }),
  row({ id: 'r2', vehiclePlate: 'RTA-9C55', vehicleBrand: 'Chevrolet', vehicleModel: 'Onix', status: 'RESERVED', startDate: '2026-10-20', endDate: '2027-04-19' }),
  row({ id: 'r3', vehiclePlate: 'QWE-4F21', vehicleBrand: 'Hyundai', vehicleModel: 'HB20', status: 'COMPLETED', startDate: '2026-01-06', endDate: '2026-07-28' }),
];

const ch = (over: Partial<DriverCharge>): DriverCharge => ({
  id: 'c',
  kind: 'RENTAL_PERIOD',
  amount: 65000,
  status: 'PENDING',
  dueDate: '2026-10-13',
  periodIndex: 0,
  paidAt: null,
  checkoutUrl: 'https://pay.example/i',
  ...over,
});

const CHARGES: Record<string, DriverCharge[]> = {
  r1: [ch({ id: 'a', dueDate: '2026-10-06' }), ch({ id: 'b', dueDate: '2026-10-13' })],
  r2: [ch({ id: 'c', kind: 'CAUCAO', amount: 100000, dueDate: '2026-10-15' }), ch({ id: 'd', amount: 69000, dueDate: '2026-10-20' })],
  r3: [ch({ id: 'e', amount: 62000, status: 'PAID', dueDate: '2026-07-28' })],
};

const page = (content: RentalListItemDto[]): PagedResponse<RentalListItemDto> =>
  ({ content, page: 0, size: 100, total: content.length }) as PagedResponse<RentalListItemDto>;

describe('DriverRentalsList', () => {
  let fixture: ComponentFixture<DriverRentalsList>;
  let listCall: ReturnType<typeof vi.fn>;
  let chargesCall: ReturnType<typeof vi.fn>;

  const root = () => fixture.nativeElement as HTMLElement;
  const q = (sel: string) => root().querySelector<HTMLElement>(sel);
  const qa = (sel: string) => Array.from(root().querySelectorAll<HTMLElement>(sel));

  let today = TODAY;

  function build(
    list: () => Observable<PagedResponse<RentalListItemDto>>,
    charges?: (id: string) => Observable<DriverCharge[]>,
  ): void {
    listCall = vi.fn(list);
    chargesCall = vi.fn(
      charges ??
        ((id: string) =>
          id === 'r3'
            ? throwError(() => new HttpErrorResponse({ status: 500 }))
            : of(CHARGES[id] ?? [])),
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: DRIVER_RENTAL_TODAY, useValue: () => today },
        { provide: RentalService, useValue: { list: listCall } },
        { provide: DriverRentalChargesService, useValue: { list: chargesCall } },
      ],
    });
    fixture = TestBed.createComponent(DriverRentalsList);
    fixture.detectChanges();
    // The visible page's charges are asked for by an effect: one more pass renders them.
    fixture.detectChanges();
  }

  function type(selector: string, value: string, event = 'input'): void {
    const el = q(selector) as HTMLInputElement | HTMLSelectElement;
    el.value = value;
    el.dispatchEvent(new Event(event));
    fixture.detectChanges();
  }

  afterEach(() => {
    vi.restoreAllMocks();
    today = TODAY;
  });

  describe('os quatro estados', () => {
    it('1. carregando: esqueleto, sem cards nem vazio', () => {
      build(() => new Subject<PagedResponse<RentalListItemDto>>());

      expect(q('[data-loading]')).not.toBeNull();
      expect(qa('[data-rental-card]')).toHaveLength(0);
      expect(q('[data-empty]')).toBeNull();
    });

    it('2. erro: aviso com "Tentar novamente", que pede de novo', () => {
      let fail = true;
      build(() => (fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(page(ROWS))));

      expect(flat(q('[data-load-error]'))).toContain('Não foi possível carregar seus aluguéis.');
      expect(q('[data-loading]')).toBeNull();

      fail = false;
      q('[data-load-error] button')!.click();
      fixture.detectChanges();

      expect(listCall).toHaveBeenCalledTimes(2);
      expect(q('[data-load-error]')).toBeNull();
      expect(qa('[data-rental-card]')).toHaveLength(3);
    });

    it('3. vazio: a mensagem do protótipo', () => {
      build(() => of(page([])));

      expect(flat(q('[data-empty]'))).toBe(
        'Você ainda não tem aluguéis. Quando a locadora criar o seu, ele aparece aqui.',
      );
      expect(chargesCall).not.toHaveBeenCalled();
    });

    it('4. vazio com filtros: mensagem e "Limpar filtros", que traz a lista de volta', () => {
      build(() => of(page(ROWS)));

      type('[data-search]', 'zzz');
      expect(flat(q('[data-empty-filtered]'))).toContain('Nenhum aluguel encontrado com estes filtros.');
      expect(qa('[data-rental-card]')).toHaveLength(0);

      q('[data-empty-filtered] button')!.click();
      fixture.detectChanges();

      expect(qa('[data-rental-card]')).toHaveLength(3);
      expect((q('[data-search]') as HTMLInputElement).value).toBe('');
    });
  });

  describe('cards', () => {
    it('um por aluguel, mais recente primeiro, com placa, chip, período, valor e alerta', () => {
      build(() => of(page(ROWS)));

      const cards = qa('[data-rental-card]');
      expect(cards.map((c) => flat(c.querySelector('[data-plate]')))).toEqual([
        'RTA-9C55',
        'SJH-2B17',
        'QWE-4F21',
      ]);
      const [reserved, active, done] = cards;
      expect(flat(active)).toContain('Ativo');
      expect(flat(active)).toContain('04/08/2026 → 03/02/2027');
      expect(flat(active.querySelector('[data-rate]'))).toBe('R$ 650,00 por semana');
      expect(flat(active.querySelector('[data-alert]'))).toBe('1 cobrança atrasada');
      expect(active.querySelector('[data-alert]')!.className).toContain('text-rose-700');
      expect(flat(reserved.querySelector('[data-alert]'))).toBe('Começa em 20/10');
      expect(flat(done)).toContain('Concluído');
      // As cobranças do concluído falharam: o card fica, só sem a linha.
      expect(done.querySelector('[data-rate]')).toBeNull();
    });

    it('"Ver detalhes" leva ao aluguel, com o nome acessível pela placa', () => {
      build(() => of(page(ROWS)));

      const link = qa('[data-open]')[1] as HTMLAnchorElement;
      expect(flat(link)).toBe('Ver detalhes');
      expect(link.getAttribute('href')).toBe('/r1');
      expect(link.getAttribute('aria-label')).toBe('Abrir aluguel do veículo SJH-2B17');
    });

    it('busca por placa ou modelo, filtro por situação e ordem', () => {
      build(() => of(page(ROWS)));

      type('[data-search]', 'onix');
      expect(qa('[data-plate]').map(flat)).toEqual(['RTA-9C55']);

      type('[data-search]', '');
      q('[data-status-chip="COMPLETED"]')!.click();
      fixture.detectChanges();
      expect(q('[data-status-chip="COMPLETED"]')!.getAttribute('aria-pressed')).toBe('true');
      expect(qa('[data-plate]').map(flat)).toEqual(['QWE-4F21']);

      q('[data-status-chip="ALL"]')!.click();
      fixture.detectChanges();
      type('[data-order]', 'ASC', 'change');
      expect(qa('[data-plate]').map(flat)).toEqual(['QWE-4F21', 'SJH-2B17', 'RTA-9C55']);
    });

    it('miniatura do carro: quadrado de largura fixa (104px / 148px), no topo, nunca esticado', () => {
      build(() => of(page(ROWS)));

      const thumbs = qa('[data-car-thumb]');
      expect(thumbs).toHaveLength(3);
      for (const t of thumbs) {
        const cls = t.className.split(/\s+/);
        expect(cls).toEqual(
          expect.arrayContaining(['aspect-square', 'self-start', 'shrink-0', 'w-[104px]', 'sm:w-[148px]']),
        );
        expect(cls).not.toContain('self-stretch');
        expect(cls.some((c) => /^(sm:)?(min-)?h-/.test(c))).toBe(false);
      }
    });

    it('celular: só busca + "Filtrar"; situação e ordem abrem embaixo, com a contagem', () => {
      build(() => of(page(ROWS)));

      const panel = q('[data-filters]')!;
      const toggle = q('[data-filter-toggle]')!;
      expect(panel.classList).toContain('max-sm:hidden');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(qa('[data-status-chip]').map(flat)).toEqual([
        'Todos',
        'Ativo',
        'Reservado',
        'Concluído',
        'Cancelado',
      ]);

      toggle.click();
      fixture.detectChanges();
      expect(panel.classList).not.toContain('max-sm:hidden');

      q('[data-status-chip="ACTIVE"]')!.click();
      fixture.detectChanges();
      expect(flat(toggle)).toBe('Filtrar (1)');
    });

    it('cobranças só da página visível, no máximo 3 de cada vez', () => {
      const many = Array.from({ length: 12 }, (_, i) =>
        row({ id: `x${i}`, vehiclePlate: `AAA-${1000 + i}`, startDate: `2026-01-${String(10 + i).padStart(2, '0')}` }),
      );
      const pending = new Map<string, Subject<DriverCharge[]>>();
      build(
        () => of(page(many)),
        (id) => {
          const s = new Subject<DriverCharge[]>();
          pending.set(id, s);
          return s;
        },
      );

      expect(chargesCall).toHaveBeenCalledTimes(3);
      for (let round = 0; round < 4; round++) {
        for (const [id, s] of [...pending]) {
          pending.delete(id);
          s.next([]);
          s.complete();
        }
        fixture.detectChanges();
      }
      expect(chargesCall).toHaveBeenCalledTimes(10);
      const asked = chargesCall.mock.calls.map((c) => c[0] as string);
      expect(asked).not.toContain('x0');
      expect(asked).not.toContain('x1');

      // A outra página pede só as dela.
      qa('button').find((b) => flat(b) === 'Próxima')!.click();
      fixture.detectChanges();
      fixture.detectChanges();
      for (const [, s] of pending) { s.next([]); s.complete(); }
      expect(chargesCall.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['x0', 'x1']));
      expect(chargesCall).toHaveBeenCalledTimes(12);
    });

    it('"hoje" não congela: ao voltar à aba o alerta usa o dia novo', () => {
      build(() => of(page(ROWS)));
      const reserved = () => flat(qa('[data-rental-card]')[0].querySelector('[data-alert]'));
      expect(reserved()).toBe('Começa em 20/10');
      const active = () => flat(qa('[data-rental-card]')[1].querySelector('[data-alert]'));
      expect(active()).toBe('1 cobrança atrasada');

      today = '2026-10-05'; // antes do vencimento de 06/10: nada atrasado
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();

      expect(active()).toBe('Próxima cobrança em 06/10');
    });

    it('rodapé com a página', () => {
      build(() => of(page(ROWS)));
      expect(flat(q('[data-pages]'))).toBe('3 aluguéis — página 1 de 1');
    });
  });
});
