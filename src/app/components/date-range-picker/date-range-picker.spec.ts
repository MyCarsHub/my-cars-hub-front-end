import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DateRange, DateRangePicker, DateRangePresetKey } from './date-range-picker';

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
