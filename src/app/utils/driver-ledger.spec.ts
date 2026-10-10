import { describe, expect, it } from 'vitest';
import { DriverCategoryTotal, LedgerEntry } from '../types/driver-ledger.types';
import {
  LEDGER_CATEGORIES,
  addDaysIso,
  breakdownFor,
  categoriesOf,
  categoryBelongsToKind,
  categoryLabel,
  comparePeriods,
  daysInRange,
  deltaCaption,
  elapsedDays,
  kindOfCategory,
  mergeEntry,
  minusYearsIso,
  MAX_PERIOD_DAYS,
  perDayCents,
  periodTooLong,
} from './driver-ledger';

describe('driver-ledger — categorias', () => {
  it('as categorias do contrato: 3 de ganho e 7 de custo, cada uma de UM tipo', () => {
    expect(categoriesOf('INCOME').map((c) => c.value)).toEqual([
      'RIDES',
      'DELIVERIES',
      'OTHER_INCOME',
    ]);
    expect(categoriesOf('EXPENSE').map((c) => c.value)).toEqual([
      'FUEL',
      'MAINTENANCE',
      'RENTAL_FEE',
      'FINE',
      'FOOD',
      'TOLL_PARKING',
      'OTHER_EXPENSE',
    ]);
    expect(LEDGER_CATEGORIES).toHaveLength(10);
  });

  it('nomeia a categoria em pt-BR e nunca devolve vazio para um valor desconhecido', () => {
    expect(categoryLabel('FUEL')).toBe('Combustível');
    expect(categoryLabel('RENTAL_FEE')).toBe('Aluguel do carro');
    expect(categoryLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(categoryLabel(null)).toBe('—');
  });

  it('casa categoria com tipo', () => {
    expect(kindOfCategory('RIDES')).toBe('INCOME');
    expect(kindOfCategory('FINE')).toBe('EXPENSE');
    expect(kindOfCategory('NOPE')).toBeNull();
    expect(categoryBelongsToKind('FUEL', 'EXPENSE')).toBe(true);
    expect(categoryBelongsToKind('FUEL', 'INCOME')).toBe(false);
  });
});

describe('driver-ledger — breakdownFor', () => {
  const rows: DriverCategoryTotal[] = [
    { kind: 'EXPENSE', category: 'FOOD', totalCents: 2000, entryCount: 2 },
    { kind: 'EXPENSE', category: 'FUEL', totalCents: 8000, entryCount: 4 },
    { kind: 'INCOME', category: 'RIDES', totalCents: 50000, entryCount: 10 },
    { kind: 'EXPENSE', category: 'FINE', totalCents: 0, entryCount: 0 },
  ];

  it('ordena do maior para o menor, só do tipo pedido, e larga o zero', () => {
    const bars = breakdownFor(rows, 'EXPENSE');
    expect(bars.map((b) => b.category)).toEqual(['FUEL', 'FOOD']);
  });

  it('a largura é relativa ao maior do MESMO tipo, e a fatia é do total do tipo', () => {
    const [fuel, food] = breakdownFor(rows, 'EXPENSE');
    expect(fuel.widthPct).toBe(100);
    expect(food.widthPct).toBe(25);
    expect(fuel.sharePct).toBe(80);
    expect(food.sharePct).toBe(20);
    // O ganho não puxa a escala do custo.
    expect(breakdownFor(rows, 'INCOME')[0].widthPct).toBe(100);
  });

  it('uma categoria minúscula ainda deixa um risco visível', () => {
    const bars = breakdownFor(
      [
        { kind: 'EXPENSE', category: 'FUEL', totalCents: 1_000_000, entryCount: 1 },
        { kind: 'EXPENSE', category: 'FOOD', totalCents: 1, entryCount: 1 },
      ],
      'EXPENSE',
    );
    expect(bars[1].widthPct).toBeGreaterThanOrEqual(2);
  });

  it('sem nada do tipo, a lista é vazia — não uma barra de zero', () => {
    expect(breakdownFor([], 'INCOME')).toEqual([]);
    expect(breakdownFor(rows.filter((r) => r.kind === 'INCOME'), 'EXPENSE')).toEqual([]);
  });
});

describe('driver-ledger — matemática de período', () => {
  it('conta os dias com as duas pontas', () => {
    expect(daysInRange({ from: '2026-10-01', to: '2026-10-31' })).toBe(31);
    expect(daysInRange({ from: '2026-10-10', to: '2026-10-10' })).toBe(1);
    expect(daysInRange({ from: '2026-02-01', to: '2026-02-28' })).toBe(28);
    expect(daysInRange({ from: '2028-02-01', to: '2028-02-29' })).toBe(29);
  });

  it('recusa intervalo invertido e data que não existe', () => {
    expect(daysInRange({ from: '2026-10-10', to: '2026-10-09' })).toBeNull();
    expect(daysInRange({ from: '2026-02-31', to: '2026-03-01' })).toBeNull();
    expect(daysInRange({ from: 'ontem', to: '2026-03-01' })).toBeNull();
  });

  it('o servidor aceita até 366 dias: o 367º é "longo demais"', () => {
    expect(MAX_PERIOD_DAYS).toBe(366);
    expect(periodTooLong({ from: '2025-10-10', to: '2026-10-10' })).toBe(false); // 366 dias
    expect(periodTooLong({ from: '2025-10-09', to: '2026-10-10' })).toBe(true); // 367 dias
    expect(periodTooLong({ from: '2026-10-01', to: '2026-10-31' })).toBe(false);
  });

  it('um intervalo inválido não é "longo demais" — essa mensagem é de quem o escolheu', () => {
    expect(periodTooLong({ from: '2026-10-10', to: '2026-10-01' })).toBe(false);
    expect(periodTooLong({ from: 'x', to: 'y' })).toBe(false);
  });

  it('desloca datas atravessando virada de mês e de ano sem depender do fuso do navegador', () => {
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysIso('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('lixo', 1)).toBeNull();
  });

  it('um ano atrás cai no mesmo dia, e 29 de fevereiro vira 28 (como LocalDate.minusYears)', () => {
    expect(minusYearsIso('2026-10-10', 1)).toBe('2025-10-10');
    expect(minusYearsIso('2028-02-29', 1)).toBe('2027-02-28');
    expect(minusYearsIso('2026-03-31', 1)).toBe('2025-03-31');
    expect(minusYearsIso('2026-10-10', 2)).toBe('2024-10-10');
    expect(minusYearsIso('nada', 1)).toBeNull();
  });

  describe('dias decorridos — o divisor do "por dia"', () => {
    const month = { from: '2026-10-01', to: '2026-10-31' };

    it('mês corrente conta só até hoje, não o mês inteiro', () => {
      expect(elapsedDays(month, '2026-10-10')).toBe(10);
      expect(elapsedDays(month, '2026-10-01')).toBe(1);
    });

    it('período já encerrado conta o período inteiro', () => {
      expect(elapsedDays(month, '2026-11-15')).toBe(31);
      expect(elapsedDays({ from: '2026-09-01', to: '2026-09-30' }, '2026-10-10')).toBe(30);
    });

    it('período que ainda não começou não tem divisor', () => {
      expect(elapsedDays(month, '2026-09-30')).toBeNull();
    });

    it('entrada inválida não vira número', () => {
      expect(elapsedDays({ from: 'x', to: 'y' }, '2026-10-10')).toBeNull();
      expect(elapsedDays(month, 'hoje')).toBeNull();
    });
  });

  describe('média por dia', () => {
    it('arredonda para o centavo inteiro', () => {
      expect(perDayCents(10_000, 3)).toBe(3333);
      expect(perDayCents(10_001, 2)).toBe(5001);
      expect(perDayCents(-9_000, 10)).toBe(-900);
    });

    it('sem divisor não há média', () => {
      expect(perDayCents(10_000, null)).toBeNull();
      expect(perDayCents(10_000, 0)).toBeNull();
    });
  });
});

describe('driver-ledger — comparação com o período anterior', () => {
  it('sobe, desce e fica igual, com uma casa decimal e vírgula', () => {
    expect(comparePeriods(112_30, 100_00)).toEqual({ label: '+12,3%', direction: 'up' });
    expect(comparePeriods(92_00, 100_00)).toEqual({ label: '-8,0%', direction: 'down' });
    expect(comparePeriods(100_00, 100_00)).toEqual({ label: '0%', direction: 'flat' });
  });

  it('zero dos dois lados é "nada a comparar"; crescer a partir do zero é "novo"', () => {
    expect(comparePeriods(0, 0)).toEqual({ label: null, direction: 'flat' });
    expect(comparePeriods(5_000, 0)).toEqual({ label: 'novo', direction: 'up' });
  });

  it('prejuízo que diminui é melhora: a base é o módulo do anterior', () => {
    // De -100 para -50: melhorou 50%. Dividir pelo anterior COM sinal viraria "-50%".
    expect(comparePeriods(-50_00, -100_00)).toEqual({ label: '+50,0%', direction: 'up' });
    expect(comparePeriods(-150_00, -100_00)).toEqual({ label: '-50,0%', direction: 'down' });
  });

  it('a legenda carrega seta, número e a referência', () => {
    expect(deltaCaption({ label: '+12,3%', direction: 'up' })).toBe(
      '▲ +12,3% vs período anterior',
    );
    expect(deltaCaption({ label: '-8,0%', direction: 'down' }, true)).toBe('▼ -8,0% vs anterior');
    expect(deltaCaption({ label: '0%', direction: 'flat' })).toBe('0% vs período anterior');
    expect(deltaCaption({ label: null, direction: 'flat' })).toBe(
      'sem dados no período anterior',
    );
    expect(deltaCaption({ label: null, direction: 'flat' }, true)).toBe('sem comparação');
  });
});

describe('driver-ledger — mergeEntry (refresh otimista)', () => {
  const entry = (id: string, occurredOn: string, amountCents = 1000): LedgerEntry => ({
    id,
    kind: 'EXPENSE',
    category: 'FUEL',
    amountCents,
    occurredOn,
    description: null,
    rentalId: null,
  });
  const range = { from: '2026-10-01', to: '2026-10-31', limit: 5 };

  it('um lançamento novo entra no lugar da data, mais novo primeiro', () => {
    const list = [entry('a', '2026-10-09'), entry('b', '2026-10-05')];
    const merged = mergeEntry(list, entry('n', '2026-10-07'), range);
    expect(merged.map((e) => e.id)).toEqual(['a', 'n', 'b']);
  });

  it('no mesmo dia, o salvo agora vem na frente dos que já estavam', () => {
    const merged = mergeEntry([entry('a', '2026-10-09')], entry('n', '2026-10-09'), range);
    expect(merged.map((e) => e.id)).toEqual(['n', 'a']);
  });

  it('uma edição troca a linha no lugar — não duplica', () => {
    const list = [entry('a', '2026-10-09', 1000), entry('b', '2026-10-05')];
    const merged = mergeEntry(list, entry('a', '2026-10-09', 9999), range);
    expect(merged).toHaveLength(2);
    expect(merged[0].amountCents).toBe(9999);
  });

  it('uma edição que MUDOU a data para fora do período some da lista', () => {
    const list = [entry('a', '2026-10-09'), entry('b', '2026-10-05')];
    const merged = mergeEntry(list, entry('a', '2026-09-30'), range);
    expect(merged.map((e) => e.id)).toEqual(['b']);
  });

  it('um lançamento fora do período não é mostrado como se estivesse nele', () => {
    const merged = mergeEntry([entry('a', '2026-10-09')], entry('n', '2026-11-02'), range);
    expect(merged.map((e) => e.id)).toEqual(['a']);
  });

  it('a janela nunca passa do limite', () => {
    const list = ['1', '2', '3', '4', '5'].map((n) => entry(n, `2026-10-0${n}`));
    const merged = mergeEntry(list, entry('n', '2026-10-31'), { ...range, limit: 5 });
    expect(merged).toHaveLength(5);
    expect(merged[0].id).toBe('n');
  });
});
