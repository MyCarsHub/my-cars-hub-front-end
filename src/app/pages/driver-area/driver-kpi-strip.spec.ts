import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DriverDashboard } from '../../types/driver-ledger.types';
import { DriverKpiStrip } from './driver-kpi-strip';

/** `textContent` do Intl usa espaco nao separavel entre "R$" e o numero: normaliza antes de comparar. */
const flat = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const dashboard = (over: Partial<DriverDashboard> = {}): DriverDashboard => ({
  from: '2026-10-01',
  to: '2026-10-31',
  totals: { incomeCents: 200000, expenseCents: 100000, netCents: 100000, entryCount: 6 },
  previousPeriod: {
    from: '2026-08-31',
    to: '2026-09-30',
    incomeCents: 200000,
    expenseCents: 50000,
    netCents: 150000,
    entryCount: 4,
  },
  byCategory: [],
  granularity: 'DAY',
  series: [],
  activeRental: null,
  ...over,
});

describe('DriverKpiStrip', () => {
  let fixture: ComponentFixture<DriverKpiStrip>;
  const kpi = (name: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-kpi="${name}"]`) as HTMLElement;

  function render(inputs: { dashboard?: DriverDashboard | null; loading?: boolean; today?: string }) {
    fixture = TestBed.createComponent(DriverKpiStrip);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.configureTestingModule({}));

  it('mostra ganho, custo e líquido como dinheiro', () => {
    render({ dashboard: dashboard() });

    expect(flat(kpi('income'))).toContain('R$ 2.000,00');
    expect(flat(kpi('expense'))).toContain('R$ 1.000,00');
    expect(flat(kpi('net'))).toContain('R$ 1.000,00');
  });

  it('compara cada número com o período anterior, e o líquido que caiu desce', () => {
    render({ dashboard: dashboard() });

    expect(flat(kpi('income'))).toContain('0% vs anterior');
    expect(flat(kpi('expense'))).toContain('▲ +100,0% vs anterior');
    expect(flat(kpi('net'))).toContain('▼ -33,3% vs período anterior');
  });

  it('o líquido traz a média por dia dos dias que JÁ passaram', () => {
    render({ dashboard: dashboard(), today: '2026-10-10' });

    // R$ 1.000,00 em 10 dias decorridos = R$ 100,00 por dia (e não R$ 32,26 do mês inteiro).
    expect(flat(kpi('net'))).toContain('R$ 100,00 por dia');
  });

  it('sem lançamento no período não inventa média', () => {
    render({
      dashboard: dashboard({
        totals: { incomeCents: 0, expenseCents: 0, netCents: 0, entryCount: 0 },
      }),
      today: '2026-10-10',
    });

    expect(flat(kpi('net'))).not.toContain('por dia');
  });

  it('período que ainda não começou não tem média', () => {
    render({ dashboard: dashboard(), today: '2026-09-20' });

    expect(flat(kpi('net'))).not.toContain('por dia');
  });

  it('antes do primeiro dado, o esqueleto ocupa o lugar e o rótulo fica', () => {
    render({ dashboard: null, loading: true });

    expect(flat(kpi('income'))).toContain('Ganhos');
    expect(kpi('income').querySelector('.animate-pulse')).not.toBeNull();
    expect(flat(kpi('income'))).not.toContain('R$');
  });

  it('numa nova carga os números continuam na tela, sem esqueleto', () => {
    render({ dashboard: dashboard(), loading: true });

    expect(kpi('income').querySelector('.animate-pulse')).toBeNull();
    expect(flat(kpi('income'))).toContain('R$ 2.000,00');
  });

  it('diz com quais datas compara — o servidor decide a janela, a tela a mostra', () => {
    render({ dashboard: dashboard() });

    expect(flat((fixture.nativeElement as HTMLElement).querySelector('[data-comparison]'))).toBe(
      'Comparado com 31/08/2026 a 30/09/2026.',
    );
  });

  it('janela de um dia só é dita no singular', () => {
    render({
      dashboard: dashboard({
        previousPeriod: {
          from: '2026-10-09',
          to: '2026-10-09',
          incomeCents: 0,
          expenseCents: 0,
          netCents: 0,
          entryCount: 0,
        },
      }),
    });

    expect(flat((fixture.nativeElement as HTMLElement).querySelector('[data-comparison]'))).toBe(
      'Comparado com 09/10/2026.',
    );
  });

  it('sem janela anterior não há legenda de datas', () => {
    render({
      dashboard: dashboard({
        previousPeriod: {
          from: null,
          to: null,
          incomeCents: 0,
          expenseCents: 0,
          netCents: 0,
          entryCount: 0,
        },
      }),
    });

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-comparison]')).toBeNull();
  });

  it('o líquido ocupa as duas colunas no celular', () => {
    render({ dashboard: dashboard() });
    expect(kpi('net').className).toContain('col-span-2');
  });
});
