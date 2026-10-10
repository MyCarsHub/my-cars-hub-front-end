import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverLedgerService } from '../../services/driver-ledger.service';
import { DriverDashboard, LedgerEntry } from '../../types/driver-ledger.types';
import { DriverEntries } from './driver-entries';
import { DriverEntryEditor } from './driver-entry-editor';

/** `textContent` do Intl usa espaco nao separavel entre "R$" e o numero: normaliza antes de comparar. */
const flat = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'e-1',
  kind: 'EXPENSE',
  category: 'FUEL',
  amountCents: 15000,
  occurredOn: '2026-10-05',
  description: null,
  rentalId: null,
  ...over,
});

const summary = (): DriverDashboard => ({
  from: '2026-10-01',
  to: '2026-10-31',
  totals: { incomeCents: 100000, expenseCents: 40000, netCents: 60000, entryCount: 8 },
  previousPeriod: { from: null, to: null, incomeCents: 0, expenseCents: 0, netCents: 0, entryCount: 0 },
  byCategory: [],
  granularity: 'DAY',
  series: [],
  activeRental: {
    rentalId: 'r-1',
    vehicleId: 'v-1',
    plate: 'ABC1D23',
    brand: null,
    model: null,
    startDate: null,
    endDate: null,
  },
});

const pageOf = (content: LedgerEntry[], total = content.length, page = 0) => ({
  content,
  page,
  size: 20,
  total,
});

describe('DriverEntries', () => {
  let fixture: ComponentFixture<DriverEntries>;
  let listCall: ReturnType<typeof vi.fn>;
  let dashboardCall: ReturnType<typeof vi.fn>;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const q = <T extends HTMLElement>(sel: string) => root().querySelector<T>(sel);
  const qa = <T extends HTMLElement>(sel: string) => Array.from(root().querySelectorAll<T>(sel));

  /** Chips of one filter group, by the id of the label that names the group. */
  const group = (labelId: string) =>
    qa<HTMLButtonElement>(`[aria-labelledby="${labelId}"] [role="radio"]`);
  const chipsOf = (labelId: string) => group(labelId).map((c) => c.textContent?.trim());
  const clickChip = (labelId: string, label: string) => {
    group(labelId)
      .find((c) => c.textContent?.trim() === label)!
      .click();
    fixture.detectChanges();
  };
  const lastQuery = () => listCall.mock.calls.at(-1)![0];

  function build(opts: { list?: () => Observable<ReturnType<typeof pageOf>> } = {}): void {
    listCall = vi.fn(opts.list ?? (() => of(pageOf([entry()]))));
    dashboardCall = vi.fn(() => of(summary()));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        { provide: DriverLedgerService, useValue: { list: listCall, dashboard: dashboardCall } },
      ],
    });
    fixture = TestBed.createComponent(DriverEntries);
    fixture.detectChanges();
  }

  describe('carga e cabeçalho', () => {
    beforeEach(() => build());

    it('lista a primeira página do mês corrente, 20 por vez, sem filtro de tipo nem de categoria', () => {
      expect(listCall).toHaveBeenCalledTimes(1);
      const query = lastQuery();
      expect(query.page).toBe(0);
      expect(query.size).toBe(20);
      expect(query.from).toMatch(/^\d{4}-\d{2}-01$/);
      expect(query.kind).toBeNull();
      expect(query.category).toBeNull();
    });

    it('os totais do período vêm do mesmo endpoint do painel', () => {
      expect(dashboardCall).toHaveBeenCalledTimes(1);
      expect(flat(q('[data-kpi="income"]')!)).toContain('R$ 1.000,00');
      expect(flat(q('[data-kpi="net"]')!)).toContain('R$ 600,00');
    });

    it('volta ao painel por um link, e as duas ações estão no topo com 48px', () => {
      expect(q<HTMLAnchorElement>('a[href="/meu-painel"]')).not.toBeNull();
      const buttons = qa<HTMLButtonElement>('[data-actions] button');
      expect(buttons.map((b) => b.textContent?.trim())).toEqual([
        'Registrar ganho',
        'Registrar custo',
      ]);
      buttons.forEach((b) => expect(b.className).toContain('min-h-12'));
    });

    it('mostra o cartão do lançamento com as ações de editar e excluir', () => {
      const card = q('app-driver-entry-card')!;
      expect(flat(card)).toContain('Combustível');
      expect(card.querySelector('[data-entry-edit]')).not.toBeNull();
      expect(card.querySelector('[data-entry-remove]')).not.toBeNull();
    });
  });

  describe('filtros', () => {
    beforeEach(() => build());

    it('o tipo tem três chips e a categoria começa com todas as dez', () => {
      expect(chipsOf('driver-filter-kind')).toEqual(['Tudo', 'Ganhos', 'Custos']);
      expect(chipsOf('driver-filter-category')).toHaveLength(11);
      expect(chipsOf('driver-filter-category')[0]).toBe('Todas');
    });

    it('escolher Ganhos filtra por INCOME, volta à primeira página e só oferece categorias de ganho', () => {
      clickChip('driver-filter-kind', 'Ganhos');

      expect(lastQuery().kind).toBe('INCOME');
      expect(lastQuery().page).toBe(0);
      expect(chipsOf('driver-filter-category')).toEqual([
        'Todas',
        'Corridas',
        'Entregas',
        'Outros ganhos',
      ]);
    });

    it('escolher uma categoria filtra por ela', () => {
      clickChip('driver-filter-kind', 'Custos');
      clickChip('driver-filter-category', 'Combustível');

      expect(lastQuery()).toMatchObject({ kind: 'EXPENSE', category: 'FUEL' });
    });

    it('trocar o tipo larga a categoria que deixou de caber', () => {
      clickChip('driver-filter-kind', 'Custos');
      clickChip('driver-filter-category', 'Combustível');

      clickChip('driver-filter-kind', 'Ganhos');

      expect(lastQuery().kind).toBe('INCOME');
      expect(lastQuery().category).toBeNull();
    });

    it('trocar o período volta à primeira página e refaz o painel', () => {
      clickChip('driver-filter-kind', 'Custos');
      const before = dashboardCall.mock.calls.length;

      qa<HTMLButtonElement>('[aria-label="Período"] [role="radio"]')
        .find((c) => c.textContent?.trim() === 'Hoje')!
        .click();
      fixture.detectChanges();

      expect(lastQuery().page).toBe(0);
      expect(lastQuery().from).toBe(lastQuery().to);
      expect(dashboardCall.mock.calls.length).toBe(before + 1);
    });
  });

  describe('período maior que o painel aceita', () => {
    it('a lista continua, o resumo some e diz por quê', () => {
      build();
      qa<HTMLButtonElement>('[aria-label="Período"] [role="radio"]')
        .find((c) => c.textContent?.trim() === 'Personalizado')!
        .click();
      fixture.detectChanges();
      const [fromInput, toInput] = qa<HTMLInputElement>('input[type="date"]');
      fromInput.value = '2025-01-01';
      fromInput.dispatchEvent(new Event('change'));
      toInput.value = '2026-10-10';
      toInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(lastQuery()).toMatchObject({ from: '2025-01-01', to: '2026-10-10' });
      expect(qa('app-driver-entry-card')).toHaveLength(1);
      expect(flat(q('[data-too-long]'))).toContain('até um ano (366 dias)');
      expect(flat(q('[data-kpi="income"]'))).not.toContain('R$ 1.000,00');
    });
  });

  describe('paginação', () => {
    it('45 lançamentos são três páginas; Anterior começa desligado', () => {
      build({ list: () => of(pageOf([entry()], 45)) });

      expect(flat(q('[data-pager]')!)).toContain('Página 1 de 3');
      expect(flat(q('[data-pager]')!)).toContain('45 lançamentos');
      expect(q<HTMLButtonElement>('[data-prev]')!.disabled).toBe(true);
      expect(q<HTMLButtonElement>('[data-next]')!.disabled).toBe(false);
    });

    it('Próxima pede a página seguinte com os mesmos filtros', () => {
      build({ list: () => of(pageOf([entry()], 45)) });
      clickChip('driver-filter-kind', 'Custos');

      q<HTMLButtonElement>('[data-next]')!.click();
      fixture.detectChanges();

      expect(lastQuery()).toMatchObject({ page: 1, kind: 'EXPENSE' });
      expect(flat(q('[data-pager]')!)).toContain('Página 2 de 3');
    });

    it('na última página, Próxima desliga; Anterior volta', () => {
      build({ list: () => of(pageOf([entry()], 45)) });
      q<HTMLButtonElement>('[data-next]')!.click();
      fixture.detectChanges();
      q<HTMLButtonElement>('[data-next]')!.click();
      fixture.detectChanges();

      expect(q<HTMLButtonElement>('[data-next]')!.disabled).toBe(true);

      q<HTMLButtonElement>('[data-prev]')!.click();
      fixture.detectChanges();
      expect(lastQuery().page).toBe(1);
    });

    it('uma página só não desenha paginação', () => {
      build();
      expect(q('[data-pager]')).toBeNull();
    });

    it('os botões de página têm 48px', () => {
      build({ list: () => of(pageOf([entry()], 45)) });
      expect(q('[data-prev]')!.className).toContain('min-h-12');
      expect(q('[data-next]')!.className).toContain('min-h-12');
    });
  });

  describe('vazio', () => {
    it('sem filtro: diz que não há nada no período e manda usar os botões', () => {
      build({ list: () => of(pageOf([])) });

      const empty = q('[data-empty-state]')!;
      expect(flat(empty)).toContain('Nada registrado neste período.');
      expect(empty.querySelector('[data-clear-filters]')).toBeNull();
    });

    it('com filtro: diz que o filtro não achou nada e oferece limpar', () => {
      build({
        list: () => of(pageOf([])),
      });
      clickChip('driver-filter-kind', 'Custos');

      const empty = q('[data-empty-state]')!;
      expect(flat(empty)).toContain('Nenhum lançamento com estes filtros.');

      empty.querySelector<HTMLButtonElement>('[data-clear-filters]')!.click();
      fixture.detectChanges();

      expect(lastQuery().kind).toBeNull();
      expect(lastQuery().category).toBeNull();
    });
  });

  describe('falha', () => {
    it('mostra o erro e refaz a carga pelo botão', () => {
      let calls = 0;
      build({
        list: () => {
          calls += 1;
          return calls === 1
            ? throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'Quebrou.' } }))
            : of(pageOf([entry()]));
        },
      });

      expect(flat(q('[data-load-error]')!)).toContain('Quebrou.');
      q<HTMLButtonElement>('[data-load-error] button')!.click();
      fixture.detectChanges();

      expect(q('[data-load-error]')).toBeNull();
      expect(qa('app-driver-entry-card')).toHaveLength(1);
    });

    it('o painel falhar não derruba a lista', () => {
      build();
      // A nova carga do painel (troca de período) falhando é silenciosa; a lista segue de pé.
      dashboardCall.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      qa<HTMLButtonElement>('[aria-label="Período"] [role="radio"]')
        .find((c) => c.textContent?.trim() === 'Hoje')!
        .click();
      fixture.detectChanges();

      expect(qa('app-driver-entry-card')).toHaveLength(1);
      expect(q('[data-load-error]')).toBeNull();
    });
  });

  describe('refresh otimista', () => {
    const editor = (): DriverEntryEditor =>
      fixture.debugElement.query(By.directive(DriverEntryEditor)).componentInstance;

    /** Responde `answers` em ordem; depois disso a resposta fica PENDENTE (o refetch em voo). */
    function inOrder(...answers: ReturnType<typeof pageOf>[]): () => Observable<ReturnType<typeof pageOf>> {
      let n = 0;
      return () => {
        const answer = answers[n];
        n += 1;
        return answer ? of(answer) : new Subject<ReturnType<typeof pageOf>>();
      };
    }

    it('o lançamento salvo entra na lista NA HORA, antes de o refetch responder', () => {
      build({ list: inOrder(pageOf([entry()])) });

      editor().saved.emit(entry({ id: 'novo', category: 'FOOD', occurredOn: '2026-10-08' }));
      fixture.detectChanges();

      expect(qa('app-driver-entry-card')).toHaveLength(2);
      expect(text()).toContain('Alimentação');
    });

    it('um lançamento que o filtro não devolveria NÃO entra', () => {
      build({ list: inOrder(pageOf([entry()]), pageOf([])) });
      clickChip('driver-filter-kind', 'Ganhos');
      expect(qa('app-driver-entry-card')).toHaveLength(0);

      editor().saved.emit(entry({ id: 'custo', kind: 'EXPENSE', category: 'FOOD' }));
      fixture.detectChanges();

      expect(qa('app-driver-entry-card')).toHaveLength(0);
    });

    it('uma edição que tirou o lançamento do filtro o tira da lista', () => {
      const a = entry({ id: 'a', category: 'FUEL' });
      build({ list: inOrder(pageOf([a]), pageOf([a]), pageOf([a])) });
      clickChip('driver-filter-kind', 'Custos');
      clickChip('driver-filter-category', 'Combustível');
      expect(qa('app-driver-entry-card')).toHaveLength(1);

      editor().saved.emit(entry({ id: 'a', category: 'FOOD' }));
      fixture.detectChanges();

      expect(qa('app-driver-entry-card')).toHaveLength(0);
    });

    it('excluir tira a linha na hora e refaz a lista e o painel', () => {
      build({ list: inOrder(pageOf([entry()])) });
      const lists = listCall.mock.calls.length;
      const dashboards = dashboardCall.mock.calls.length;

      editor().removed.emit('e-1');
      fixture.detectChanges();

      expect(qa('app-driver-entry-card')).toHaveLength(0);
      expect(listCall.mock.calls.length).toBe(lists + 1);
      expect(dashboardCall.mock.calls.length).toBe(dashboards + 1);
    });

    it('apagar a única linha de uma página adiante volta uma página', () => {
      build({ list: () => of(pageOf([entry({ id: 'solo' })], 21)) });
      q<HTMLButtonElement>('[data-next]')!.click();
      fixture.detectChanges();
      expect(lastQuery().page).toBe(1);

      editor().removed.emit('solo');
      fixture.detectChanges();

      expect(lastQuery().page).toBe(0);
    });
  });

  it('abre o formulário de edição a partir do cartão, com o aluguel ativo do painel', () => {
    build();
    q<HTMLButtonElement>('[data-entry-edit]')!.click();
    fixture.detectChanges();

    expect(flat(q('[role="dialog"] h2'))).toBe('Editar custo');
    expect(text()).toContain('Vincular ao meu aluguel ativo (ABC1D23)');
  });
});
