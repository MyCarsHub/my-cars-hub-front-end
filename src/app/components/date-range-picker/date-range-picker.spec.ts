import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateRange, DateRangePicker, DateRangePresetKey, formatDateRangePtBr } from './date-range-picker';

describe('DateRangePicker — subconjunto de chips', () => {
  let fixture: ComponentFixture<DateRangePicker>;
  let emitted: DateRange[];

  const labels = () =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[role="radio"]')).map((c) =>
      c.textContent?.trim(),
    );

  function render(inputs: {
    presetKeys?: readonly DateRangePresetKey[] | null;
    initialPreset?: DateRangePresetKey | null;
  }): void {
    fixture = TestBed.createComponent(DateRangePicker);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    emitted = [];
    fixture.componentInstance.rangeChange.subscribe((r) => emitted.push(r));
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.configureTestingModule({}));

  it('sem lista mostra todos os chips: o dashboard da frota segue como era', () => {
    render({});

    expect(labels()).toEqual([
      'Mês atual',
      'Hoje',
      '7 dias',
      '30 dias',
      '90 dias',
      'Próximos 30 dias',
      'Próximos 90 dias',
      'Mês passado',
      'Este ano',
      'Personalizado',
    ]);
  });

  it('com a lista do motorista mostra só os seis, na ordem do seletor', () => {
    render({ presetKeys: ['custom', 'monthPast', '30d', '7d', 'today', 'monthCurrent'] });

    expect(labels()).toEqual([
      'Mês atual',
      'Hoje',
      '7 dias',
      '30 dias',
      'Mês passado',
      'Personalizado',
    ]);
  });

  it('o chip inicial continua emitindo o período ao abrir', () => {
    render({ presetKeys: ['monthCurrent', 'today'] });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].from).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('escolher "Hoje" emite um dia só', () => {
    render({ presetKeys: ['monthCurrent', 'today'] });
    (fixture.nativeElement as HTMLElement)
      .querySelectorAll<HTMLButtonElement>('[role="radio"]')[1]
      .click();

    expect(emitted).toHaveLength(2);
    expect(emitted[1].from).toBe(emitted[1].to);
  });

  it('os campos de data do período personalizado têm 16px no celular', () => {
    render({ presetKeys: ['monthCurrent', 'custom'] });
    (fixture.nativeElement as HTMLElement)
      .querySelectorAll<HTMLButtonElement>('[role="radio"]')[1]
      .click();
    fixture.detectChanges();

    const inputs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('input[type="date"]'),
    );
    expect(inputs).toHaveLength(2);
    inputs.forEach((i) => expect(i.className).toContain('text-base'));
  });
});

describe('DateRangePicker — intervalo escrito (regra do dono 18/11/2026)', () => {
  let fixture: ComponentFixture<DateRangePicker>;
  let emitted: DateRange[];

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rangeText = (): string | null =>
    root().querySelector('[data-range-text]')?.textContent?.trim() ?? null;
  const chip = (label: string): HTMLButtonElement =>
    Array.from(root().querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (c) => c.textContent?.trim() === label,
    )!;

  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(DateRangePicker);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    emitted = [];
    fixture.componentInstance.rangeChange.subscribe((r) => emitted.push(r));
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 15, 30));
    TestBed.configureTestingModule({});
  });
  afterEach(() => vi.useRealTimers());

  it('padrão (calendar, dashboard da frota): "Mês atual" é o mês inteiro', () => {
    render();
    expect(emitted).toEqual([{ from: '2026-11-01', to: '2026-11-30' }]);
  });

  it('periodEnd="today" (admin): "Mês atual" vai do dia 1 até HOJE', () => {
    render({ periodEnd: 'today' });
    expect(emitted).toEqual([{ from: '2026-11-01', to: '2026-11-18' }]);
    expect(rangeText()).toBe('01/11/2026 a 18/11/2026');
  });

  it('"Este ano": o ano inteiro no calendar, até hoje no today', () => {
    render();
    chip('Este ano').click();
    fixture.detectChanges();
    expect(emitted.at(-1)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(rangeText()).toBe('01/01/2026 a 31/12/2026');

    render({ periodEnd: 'today' });
    chip('Este ano').click();
    fixture.detectChanges();
    expect(emitted.at(-1)).toEqual({ from: '2026-01-01', to: '2026-11-18' });
    expect(rangeText()).toBe('01/01/2026 a 18/11/2026');
  });

  it('o intervalo aparece por padrão, em pt-BR "dd/mm/aaaa a dd/mm/aaaa", sem ISO', () => {
    render();
    expect(rangeText()).toBe('01/11/2026 a 30/11/2026');
    expect(root().textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('trocar o chip troca o texto', () => {
    render();
    chip('Mês passado').click();
    fixture.detectChanges();
    expect(rangeText()).toBe('01/10/2026 a 31/10/2026');
    chip('Hoje').click();
    fixture.detectChanges();
    expect(rangeText()).toBe('18/11/2026 a 18/11/2026');
  });

  it('o intervalo do servidor vence o calculado aqui; null volta ao calculado', () => {
    render({ resolvedRange: { from: '2026-10-19T03:00:00Z', to: '2026-11-18' } });
    expect(rangeText()).toBe('19/10/2026 a 18/11/2026');
    fixture.componentRef.setInput('resolvedRange', null);
    fixture.detectChanges();
    expect(rangeText()).toBe('01/11/2026 a 30/11/2026');
  });

  it('personalizado incompleto mostra o erro, não um intervalo', () => {
    render();
    chip('Personalizado').click();
    fixture.detectChanges();
    expect(rangeText()).toBeNull();
    expect(root().textContent).toContain('Selecione as duas datas.');
  });

  it('showRange=false esconde a linha (só para tela que mostra as datas em outro lugar)', () => {
    render({ showRange: false });
    expect(rangeText()).toBeNull();
  });

  it('formatDateRangePtBr: ponta ausente ou que não é data dá null', () => {
    expect(formatDateRangePtBr({ from: '2026-11-01', to: '2026-11-18' })).toBe('01/11/2026 a 18/11/2026');
    expect(formatDateRangePtBr({ from: null, to: '2026-11-18' })).toBeNull();
    expect(formatDateRangePtBr({ from: 'ontem', to: '2026-11-18' })).toBeNull();
    expect(formatDateRangePtBr(null)).toBeNull();
  });
});

describe('DateRangePicker — hoje em Brasília, limpar e sem futuro (lote S5)', () => {
  let fixture: ComponentFixture<DateRangePicker>;
  let emitted: DateRange[];
  let cleared: number;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rangeText = (): string | null =>
    root().querySelector('[data-range-text]')?.textContent?.trim() ?? null;
  const chips = () => Array.from(root().querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const chip = (label: string): HTMLButtonElement => chips().find((c) => c.textContent?.trim() === label)!;
  const dateInputs = () => Array.from(root().querySelectorAll<HTMLInputElement>('input[type="date"]'));
  const typeDate = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(DateRangePicker);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    emitted = [];
    cleared = 0;
    fixture.componentInstance.rangeChange.subscribe((r) => emitted.push(r));
    fixture.componentInstance.rangeCleared.subscribe(() => cleared++);
    fixture.detectChanges();
  }

  afterEach(() => vi.useRealTimers());

  describe('às 22:30 de 18/11 em Brasília (01:30 de 19/11 em UTC)', () => {
    // A browser on UTC (or east of Brasília) already reads 19/11 on its own clock.
    const browserTz = process.env['TZ'];
    afterEach(() => {
      if (browserTz === undefined) delete process.env['TZ'];
      else process.env['TZ'] = browserTz;
    });
    beforeEach(() => {
      process.env['TZ'] = 'UTC';
      expect(new Date('2026-11-19T01:30:00Z').getDate()).toBe(19);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-19T01:30:00Z'));
      TestBed.configureTestingModule({});
    });

    it('"Hoje" é 18/11, o dia de Brasília, qualquer que seja o fuso do navegador', () => {
      render();
      chip('Hoje').click();
      fixture.detectChanges();
      expect(emitted.at(-1)).toEqual({ from: '2026-11-18', to: '2026-11-18' });
      expect(rangeText()).toBe('18/11/2026 a 18/11/2026');
    });

    it('7 dias termina em 18/11; o dashboard (calendar) continua com o mês inteiro', () => {
      render();
      expect(emitted[0]).toEqual({ from: '2026-11-01', to: '2026-11-30' });
      chip('7 dias').click();
      expect(emitted.at(-1)).toEqual({ from: '2026-11-12', to: '2026-11-18' });
    });
  });

  describe('às 15:30 de 18/11/2026', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-18T18:30:00Z'));
      TestBed.configureTestingModule({});
    });

    it('sem clearable não há "Limpar período" (o dashboard sempre tem um período)', () => {
      render();
      expect(root().querySelector('[data-range-clear]')).toBeNull();
    });

    it('clearable: o link aparece só com chip marcado e limpar desmarca tudo e avisa', () => {
      render({ clearable: true, initialPreset: null, periodEnd: 'today' });
      expect(root().querySelector('[data-range-clear]')).toBeNull();

      chip('Personalizado').click();
      fixture.detectChanges();
      typeDate(dateInputs()[0], '2026-11-01');
      typeDate(dateInputs()[1], '2026-11-10');
      expect(emitted.at(-1)).toEqual({ from: '2026-11-01', to: '2026-11-10' });

      const clear = root().querySelector<HTMLButtonElement>('[data-range-clear]')!;
      expect(clear.textContent?.trim()).toBe('Limpar período');
      clear.click();
      fixture.detectChanges();

      expect(cleared).toBe(1);
      expect(root().querySelector('[aria-checked="true"]')).toBeNull();
      expect(dateInputs()).toHaveLength(0);
      expect(rangeText()).toBeNull();
      expect(root().querySelector('[data-range-clear]')).toBeNull();

      // Reabrir o personalizado começa vazio.
      chip('Personalizado').click();
      fixture.detectChanges();
      expect(dateInputs().map((i) => i.value)).toEqual(['', '']);
    });

    it('clear() público faz o mesmo para o "Limpar filtros" da página', () => {
      render({ initialPreset: 'monthCurrent' });
      fixture.componentInstance.clear();
      fixture.detectChanges();
      expect(cleared).toBe(1);
      expect(root().querySelector('[aria-checked="true"]')).toBeNull();
    });

    it('allowFuture padrão: sem max nos campos e com os chips "Próximos"', () => {
      render();
      expect(chips().map((c) => c.textContent?.trim())).toContain('Próximos 30 dias');
      chip('Personalizado').click();
      fixture.detectChanges();
      dateInputs().forEach((i) => expect(i.hasAttribute('max')).toBe(false));
    });

    it('allowFuture=false: max = hoje em Brasília, sem chips "Próximos", data futura recusada', () => {
      render({ allowFuture: false, periodEnd: 'today' });
      const labels = chips().map((c) => c.textContent?.trim());
      expect(labels).not.toContain('Próximos 30 dias');
      expect(labels).not.toContain('Próximos 90 dias');

      chip('Personalizado').click();
      fixture.detectChanges();
      dateInputs().forEach((i) => expect(i.getAttribute('max')).toBe('2026-11-18'));

      const before = emitted.length;
      typeDate(dateInputs()[0], '2026-11-10');
      typeDate(dateInputs()[1], '2026-11-25');
      expect(emitted).toHaveLength(before);
      expect(root().textContent).toContain('Escolha datas até hoje.');
      expect(rangeText()).toBeNull();

      typeDate(dateInputs()[1], '2026-11-18');
      expect(emitted.at(-1)).toEqual({ from: '2026-11-10', to: '2026-11-18' });
    });

    it('jumpToMonth continua pulando para o mês inteiro', () => {
      render();
      fixture.componentRef.setInput('jumpToMonth', '2026-02');
      fixture.detectChanges();
      expect(emitted.at(-1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    });
  });
});
