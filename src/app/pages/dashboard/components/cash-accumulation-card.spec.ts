import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';

import { CashAccumulationResponse } from '../../../types/cash-accumulation.types';
import { CashAccumulationCard } from './cash-accumulation-card';

function month(iso: string, daysInMonth: number, throughDay: number, perDay: number) {
  return {
    month: iso,
    daysInMonth,
    throughDay,
    points: Array.from({ length: throughDay }, (_, i) => ({
      day: i + 1,
      dayCents: perDay,
      cumulativeCents: perDay * (i + 1),
    })),
    totalCents: perDay * throughDay,
  };
}

function response(over: Partial<CashAccumulationResponse> = {}): CashAccumulationResponse {
  const current = month('2026-09', 30, 17, 20_000);
  return {
    current,
    previous: month('2026-08', 31, 31, 10_000),
    previousSameDayCents: 170_000,
    deltaCents: current.totalCents - 170_000,
    ...over,
  };
}

describe('CashAccumulationCard', () => {
  let fixture: ComponentFixture<CashAccumulationCard>;

  function render(data: CashAccumulationResponse | null): string {
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CashAccumulationCard] }).compileComponents();
    fixture = TestBed.createComponent(CashAccumulationCard);
  });

  it('o total do mes vem em destaque', () => {
    render(response());
    const total = (fixture.nativeElement as HTMLElement).querySelector('p.text-3xl');

    expect(total?.textContent).toContain('3.400,00');
  });

  it('nomeia o mes corrente', () => {
    expect(render(response())).toContain('setembro');
  });

  describe('comparacao com o mes passado', () => {
    it('acima: verde', () => {
      render(response());
      const html = (fixture.nativeElement as HTMLElement).innerHTML;

      expect(html).toContain('text-emerald-700');
      expect(fixture.nativeElement.textContent).toContain('acima de agosto');
    });

    /** Numero que so da boa noticia para de ser consultado. */
    it('ABAIXO: aparece, em rose', () => {
      const current = month('2026-09', 30, 17, 5_000);
      render(response({ current, deltaCents: current.totalCents - 170_000 }));
      const html = (fixture.nativeElement as HTMLElement).innerHTML;

      expect(fixture.nativeElement.textContent).toContain('abaixo de agosto');
      expect(html).toContain('text-rose-700');
      expect(html).not.toContain('text-emerald-700');
    });
  });

  describe('mes sem nada recebido', () => {
    const vazio = response({
      current: month('2026-09', 30, 17, 0),
      previousSameDayCents: 0,
      deltaCents: 0,
    });

    it('explica em vez de sumir', () => {
      const text = render(vazio);

      expect(text).toContain('Nenhuma cobrança paga até o dia 17');
      expect(text).toContain('R$');
    });
  });

  /**
   * A tabela e a leitura do leitor de tela — hoje, porque a curva ainda nao
   * existe, e depois, porque leitor de tela nao le canvas.
   */
  describe('alternativa textual', () => {
    it('lista um dia por linha, so ate hoje', () => {
      render(response());
      const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');

      expect(rows).toHaveLength(17);
    });

    it('fica fora da tela, sem duplicar leitura visual', () => {
      render(response());
      const table = (fixture.nativeElement as HTMLElement).querySelector('table');

      expect(table?.className).toContain('sr-only');
    });
  });

  /**
   * A fiacao com o grafico. Sao tres garantias que o desenho depende e que a
   * suite CONSEGUE provar (o canvas em si ela nao ve — ver o card).
   */
  describe('o que e passado ao grafico', () => {
    it('marca como parcial SO o ultimo ponto do mes corrente', () => {
      render(response());
      const points = fixture.componentInstance['currentPoints']();

      expect(points).toHaveLength(17);
      expect(points.at(-1)?.partial).toBe(true);
      expect(points.slice(0, -1).every((p) => !p.partial)).toBe(true);
    });

    /** Mes fechado nao leva marca: marcar diria que agosto ainda acontece. */
    it('a referencia NAO leva marca de parcial', () => {
      render(response());
      const reference = fixture.componentInstance['referencePoints']();

      expect(reference).toHaveLength(31);
      expect(reference.every((p) => p.partial === undefined)).toBe(true);
    });

    /**
     * O desenho corta a referencia no dia de hoje; o texto tem de acompanhar.
     * A tabela sr-only usa o mesmo rotulo, entao a ressalva vale tambem para
     * quem le por leitor de tela.
     */
    it('rotula a referencia como "ate aqui", nao como o mes inteiro', () => {
      const text = render(response());

      expect(text).toContain('agosto até aqui');
    });

    it('o teto do eixo vai calculado sobre as duas series', () => {
      render(response());
      const view = fixture.componentInstance['view']();
      const maiorDaReferencia = Math.max(
        ...fixture.componentInstance['referencePoints']().map((p) => p.value),
      );

      expect(view?.axisTopCents).toBeGreaterThanOrEqual(maiorDaReferencia);
    });
  });

  it('sem dado nao renderiza nada', () => {
    expect(render(null).trim()).toBe('');
  });
});
