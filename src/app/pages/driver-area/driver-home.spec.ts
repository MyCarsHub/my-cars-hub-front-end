import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverLedgerService } from '../../services/driver-ledger.service';
import { DriverRentalChargesService } from '../../services/driver-rental-charges.service';
import { DriverDashboard, LedgerEntry } from '../../types/driver-ledger.types';
import { DriverEntryEditor } from './driver-entry-editor';
import { DriverHome } from './driver-home';

/** `textContent` do Intl usa espaco nao separavel entre "R$" e o numero: normaliza antes de comparar. */
const flat = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'e-1',
  kind: 'EXPENSE',
  category: 'FUEL',
  amountCents: 15000,
  occurredOn: '2026-10-05',
  description: 'Posto da avenida',
  rentalId: null,
  ...over,
});

const zeros = { incomeCents: 0, expenseCents: 0, netCents: 0, entryCount: 0 };

const dashboard = (over: Partial<DriverDashboard> = {}): DriverDashboard => ({
  from: '2026-10-01',
  to: '2026-10-31',
  totals: { incomeCents: 500000, expenseCents: 180000, netCents: 320000, entryCount: 12 },
  previousPeriod: {
    from: '2026-08-31',
    to: '2026-09-30',
    incomeCents: 400000,
    expenseCents: 200000,
    netCents: 200000,
    entryCount: 9,
  },
  byCategory: [
    { kind: 'INCOME', category: 'RIDES', totalCents: 450000, entryCount: 10 },
    { kind: 'INCOME', category: 'DELIVERIES', totalCents: 50000, entryCount: 2 },
    { kind: 'EXPENSE', category: 'FUEL', totalCents: 120000, entryCount: 6 },
  ],
  granularity: 'DAY',
  series: [],
  activeRental: null,
  ...over,
});

const emptyDashboard = (): DriverDashboard =>
  dashboard({
    totals: { ...zeros },
    previousPeriod: { from: null, to: null, ...zeros },
    byCategory: [],
  });

const page = (content: LedgerEntry[], total = content.length) => ({
  content,
  page: 0,
  size: 5,
  total,
});

describe('DriverHome', () => {
  let fixture: ComponentFixture<DriverHome>;
  let dashboardCall: ReturnType<typeof vi.fn>;
  let listCall: ReturnType<typeof vi.fn>;
  let chargesCall: ReturnType<typeof vi.fn>;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const q = <T extends HTMLElement>(sel: string) => root().querySelector<T>(sel);
  const qa = <T extends HTMLElement>(sel: string) => Array.from(root().querySelectorAll<T>(sel));

  function build(opts: {
    dashboard?: () => Observable<DriverDashboard>;
    list?: () => Observable<ReturnType<typeof page>>;
  } = {}): void {
    dashboardCall = vi.fn(opts.dashboard ?? (() => of(dashboard())));
    listCall = vi.fn(opts.list ?? (() => of(page([entry()]))));
    chargesCall = vi.fn(() => of([]));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        { provide: DriverLedgerService, useValue: { dashboard: dashboardCall, list: listCall } },
        { provide: DriverRentalChargesService, useValue: { list: chargesCall } },
      ],
    });
    fixture = TestBed.createComponent(DriverHome);
    fixture.detectChanges();
  }

  describe('carga', () => {
    it('pede o painel e os recentes do mês corrente, com 5 lançamentos', () => {
      build();

      expect(dashboardCall).toHaveBeenCalledTimes(1);
      const [from, to] = dashboardCall.mock.calls[0];
      expect(from).toMatch(/^\d{4}-\d{2}-01$/);
      expect(Number(to.slice(8))).toBeGreaterThanOrEqual(28);
      expect(from.slice(0, 7)).toBe(to.slice(0, 7));

      expect(listCall).toHaveBeenCalledTimes(1);
      expect(listCall.mock.calls[0][0]).toMatchObject({ from, to, page: 0, size: 5 });
    });

    it('mostra os três números e a comparação com o período anterior', () => {
      build();

      const income = q('[data-kpi="income"]')!;
      const expense = q('[data-kpi="expense"]')!;
      const net = q('[data-kpi="net"]')!;
      expect(flat(income)).toContain('R$ 5.000,00');
      expect(flat(income)).toContain('▲ +25,0% vs anterior');
      expect(flat(expense)).toContain('R$ 1.800,00');
      expect(flat(expense)).toContain('▼ -10,0% vs anterior');
      expect(flat(net)).toContain('R$ 3.200,00');
      expect(flat(net)).toContain('▲ +60,0% vs período anterior');
    });

    it('usa as variantes que o Dashboard já tem: verde para ganho, laranja para custo, branco para o líquido', () => {
      build();

      expect(q('[data-kpi="income"]')!.className).toContain('bg-emerald-600');
      expect(q('[data-kpi="expense"]')!.className).toContain('bg-primary-500');
      expect(q('[data-kpi="net"]')!.className).toContain('bg-white');
    });

    it('os chips de período são os seis pedidos, na ordem', () => {
      build();

      const labels = qa('[role="radio"]').map((c) => c.textContent?.trim());
      expect(labels).toEqual([
        'Mês atual',
        'Hoje',
        '7 dias',
        '30 dias',
        'Mês passado',
        'Personalizado',
      ]);
    });

    it('trocar o chip pede de novo, com o período novo', () => {
      build();
      const seven = qa<HTMLButtonElement>('[role="radio"]').find(
        (c) => c.textContent?.trim() === '7 dias',
      )!;
      seven.click();
      fixture.detectChanges();

      expect(dashboardCall).toHaveBeenCalledTimes(2);
      const [from, to] = dashboardCall.mock.calls[1];
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
      expect(days).toBe(7);
    });
  });

  describe('com lançamentos', () => {
    beforeEach(() => build());

    it('as duas ações ficam no topo, com 48px, e abrem a folha do tipo certo', () => {
      const actions = q('[data-actions]')!;
      const buttons = Array.from(actions.querySelectorAll<HTMLButtonElement>('button'));
      expect(buttons.map((b) => b.textContent?.trim())).toEqual([
        'Registrar ganho',
        'Registrar custo',
      ]);
      buttons.forEach((b) => expect(b.className).toContain('min-h-12'));

      buttons[1].click();
      fixture.detectChanges();
      expect(flat(q('[role="dialog"] h2'))).toBe('Registrar custo');
    });

    it('não mostra o convite de primeiro lançamento', () => {
      expect(q('[data-empty-state]')).toBeNull();
    });

    it('a divisão por categoria é lista de texto, com a barra escondida da leitura de tela', () => {
      const income = qa('[data-bar-income]');
      expect(income.map((li) => li.textContent)).toEqual([
        expect.stringContaining('Corridas'),
        expect.stringContaining('Entregas'),
      ]);
      expect(flat(income[0])).toContain('R$ 4.500,00');
      expect(flat(income[0])).toContain('(90%)');
      expect(income[0].querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(flat(qa('[data-bar-expense]')[0])).toContain('Combustível');
    });

    it('lista os recentes e aponta para a lista completa', () => {
      const card = q('app-driver-entry-card')!;
      expect(flat(card)).toContain('Combustível');
      expect(flat(card)).toContain('Posto da avenida');
      expect(flat(card)).toContain('− R$ 150,00');

      const all = q<HTMLAnchorElement>('a[href="/meu-painel/lancamentos"]')!;
      expect(flat(all)).toContain('Ver todos (12)');
    });

    it('editar a partir do cartão abre a folha preenchida', () => {
      q<HTMLButtonElement>('[data-entry-edit]')!.click();
      fixture.detectChanges();

      expect(flat(q('[role="dialog"] h2'))).toBe('Editar custo');
      expect(q<HTMLInputElement>('#driver-entry-amount')!.value).toBe('150,00');
    });

    it('excluir a partir do cartão pede confirmação', () => {
      q<HTMLButtonElement>('[data-entry-remove]')!.click();
      fixture.detectChanges();

      expect(text()).toContain('Excluir este lançamento?');
    });
  });

  describe('aluguel ativo', () => {
    it('aparece com a placa e leva ao aluguel', () => {
      build({
        dashboard: () =>
          of(
            dashboard({
              activeRental: {
                rentalId: 'r-7',
                vehicleId: 'v-1',
                plate: 'ABC1D23',
                brand: 'Fiat',
                model: 'Argo',
                startDate: '2026-09-01',
                endDate: null,
              },
            }),
          ),
      });

      const card = q('[data-active-rental]')!;
      expect(flat(card)).toContain('ABC1D23');
      expect(flat(card)).toContain('Fiat Argo');
      expect(flat(card)).toContain('desde 01/09/2026');
      expect(card.querySelector('a')!.getAttribute('href')).toBe('/alugueis/r-7');
    });

    it('traz o card "Aluguel da semana" do aluguel ativo, pelo endpoint do motorista', () => {
      build({
        dashboard: () =>
          of(
            dashboard({
              activeRental: {
                rentalId: 'r-7',
                vehicleId: 'v-1',
                plate: 'ABC1D23',
                brand: 'Fiat',
                model: 'Argo',
                startDate: '2026-09-01',
                endDate: null,
              },
            }),
          ),
      });

      const card = q('[data-driver-next-charge]')!;
      expect(card).not.toBeNull();
      expect(flat(card)).toContain('Aluguel da semana');
      expect(chargesCall).toHaveBeenCalledTimes(1);
      expect(chargesCall).toHaveBeenCalledWith('r-7');
      // Sem cobrança em aberto: diz isso e leva ao aluguel, nunca paga daqui.
      expect(flat(card)).toContain('Nenhuma cobrança em aberto');
      expect(card.querySelector('[data-how-to-pay]')!.getAttribute('href')).toBe('/alugueis/r-7');
    });

    it('sem aluguel ativo, não há card de cobrança nem chamada', () => {
      build();

      expect(q('[data-driver-next-charge]')).toBeNull();
      expect(chargesCall).not.toHaveBeenCalled();
    });

    it('sem aluguel ativo o cartão não existe', () => {
      build();
      expect(q('[data-active-rental]')).toBeNull();
    });
  });

  describe('vazio', () => {
    beforeEach(() => build({ dashboard: () => of(emptyDashboard()), list: () => of(page([])) }));

    it('convida ao primeiro lançamento com as duas ações DENTRO do convite', () => {
      const invite = q('[data-empty-state]')!;
      expect(flat(invite)).toContain('Comece pelo primeiro lançamento');
      expect(
        Array.from(invite.querySelectorAll('button')).map((b) => b.textContent?.trim()),
      ).toEqual(['Registrar ganho', 'Registrar custo']);
    });

    it('as ações não se repetem no topo: um lugar só para apertar', () => {
      expect(q('[data-actions]')).toBeNull();
      expect(qa('[data-add]')).toHaveLength(2);
    });

    it('sem divisão por categoria nem lista de recentes', () => {
      expect(q('app-driver-breakdown')).toBeNull();
      expect(q('[data-recent]')).toBeNull();
    });

    it('o botão do convite abre a folha', () => {
      q<HTMLButtonElement>('[data-empty-state] [data-add="INCOME"]')!.click();
      fixture.detectChanges();

      expect(flat(q('[role="dialog"] h2'))).toBe('Registrar ganho');
    });
  });

  describe('falha', () => {
    it('mostra o erro no próprio painel e tenta de novo pelo botão', () => {
      let calls = 0;
      build({
        dashboard: () => {
          calls += 1;
          return calls === 1
            ? throwError(
                () => new HttpErrorResponse({ status: 500, error: { message: 'Falhou feio.' } }),
              )
            : of(dashboard());
        },
      });

      expect(flat(q('[data-load-error]')!)).toContain('Falhou feio.');

      q<HTMLButtonElement>('[data-load-error] button')!.click();
      fixture.detectChanges();

      expect(q('[data-load-error]')).toBeNull();
      expect(flat(q('[data-kpi="income"]')!)).toContain('R$ 5.000,00');
    });
  });

  describe('período personalizado', () => {
    function pickCustom(from: string, to: string): void {
      qa<HTMLButtonElement>('[role="radio"]')
        .find((c) => c.textContent?.trim() === 'Personalizado')!
        .click();
      fixture.detectChanges();
      const [fromInput, toInput] = qa<HTMLInputElement>('input[type="date"]');
      fromInput.value = from;
      fromInput.dispatchEvent(new Event('change'));
      toInput.value = to;
      toInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }

    it('acima de 366 dias não chama o servidor: diz o limite, sem "tentar novamente"', () => {
      build();
      const calls = dashboardCall.mock.calls.length;

      pickCustom('2025-01-01', '2026-10-10');

      expect(dashboardCall.mock.calls.length).toBe(calls);
      expect(flat(q('[data-load-error]'))).toContain('até um ano (366 dias)');
      expect(q('[data-load-error] button')).toBeNull();
      // Nem os números do período anterior debaixo das datas novas.
      expect(flat(q('[data-kpi="income"]'))).not.toContain('R$ 5.000,00');
    });

    it('um período válido logo depois volta a carregar', () => {
      build();
      pickCustom('2025-01-01', '2026-10-10');
      const calls = dashboardCall.mock.calls.length;

      pickCustom('2026-09-01', '2026-09-30');

      expect(dashboardCall.mock.calls.length).toBeGreaterThan(calls);
      expect(dashboardCall.mock.calls.at(-1)).toEqual(['2026-09-01', '2026-09-30']);
      expect(q('[data-load-error]')).toBeNull();
    });
  });

  describe('refresh otimista', () => {
    function editor(): DriverEntryEditor {
      return fixture.debugElement.query(By.directive(DriverEntryEditor)).componentInstance;
    }

    it('a linha salva aparece NA HORA, antes de o refetch responder', () => {
      const refetch = new Subject<DriverDashboard>();
      let calls = 0;
      build({
        dashboard: () => {
          calls += 1;
          return calls === 1 ? of(dashboard()) : refetch;
        },
      });
      expect(qa('app-driver-entry-card')).toHaveLength(1);

      editor().saved.emit(
        entry({ id: 'novo', category: 'FOOD', amountCents: 3200, occurredOn: '2026-10-08' }),
      );
      fixture.detectChanges();

      expect(qa('app-driver-entry-card')).toHaveLength(2);
      expect(text()).toContain('Alimentação');
      // E o refetch foi disparado por trás, sem apagar os números que já estavam na tela.
      expect(dashboardCall).toHaveBeenCalledTimes(2);
      expect(flat(q('[data-kpi="income"]')!)).toContain('R$ 5.000,00');
    });

    it('a linha excluída some e o painel é refeito', () => {
      build();
      // O servidor, depois do DELETE, não devolve mais a linha.
      listCall.mockReturnValue(of(page([])));
      editor().removed.emit('e-1');
      fixture.detectChanges();

      expect(qa('app-driver-entry-card')).toHaveLength(0);
      expect(dashboardCall).toHaveBeenCalledTimes(2);
    });

    it('uma resposta atrasada de um período já deixado NÃO sobrescreve o atual', () => {
      const slow = new Subject<DriverDashboard>();
      let calls = 0;
      build({
        dashboard: () => {
          calls += 1;
          if (calls === 1) return slow; // mês atual: demora
          return of(dashboard({ totals: { ...zeros, incomeCents: 7000, netCents: 7000, entryCount: 1 } }));
        },
      });

      qa<HTMLButtonElement>('[role="radio"]')
        .find((c) => c.textContent?.trim() === 'Hoje')!
        .click();
      fixture.detectChanges();
      expect(flat(q('[data-kpi="income"]')!)).toContain('R$ 70,00');

      slow.next(dashboard());
      slow.complete();
      fixture.detectChanges();

      expect(flat(q('[data-kpi="income"]')!)).toContain('R$ 70,00');
    });
  });
});
