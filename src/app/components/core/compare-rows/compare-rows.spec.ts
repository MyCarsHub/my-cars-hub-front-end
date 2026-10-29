import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CompareRow, CompareRows } from './compare-rows';

const ROWS: CompareRow[] = [
  { key: 'value', label: 'Valor', left: 'R$ 1.200,00', right: 'R$ 980,00', divergent: true },
  { key: 'dueDate', label: 'Vencimento', left: '29/10/2026', right: '29/10/2026', divergent: false },
  { key: 'originalValue', label: 'Valor original', left: 'R$ 1.200,00', right: null, divergent: false },
];

describe('CompareRows', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [CompareRows] });
  });

  function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(CompareRows);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('mostra os dois lados de cada campo e "—" para valor ausente', () => {
    const el = render({ rows: ROWS, leftLabel: 'MyCarsHub', rightLabel: 'Asaas' });

    const value = el.querySelector('[data-testid="compare-row-value"]') as HTMLElement;
    expect(value.textContent).toContain('R$ 1.200,00');
    expect(value.textContent).toContain('R$ 980,00');
    expect(el.querySelector('[data-testid="compare-row-originalValue"]')?.textContent).toContain('—');
    expect(el.textContent).toContain('MyCarsHub');
    expect(el.textContent).toContain('Asaas');
  });

  it('destaca a divergência com TEXTO, não só cor, e resume quantas são', () => {
    const el = render({ rows: ROWS });

    const value = el.querySelector('[data-testid="compare-row-value"]') as HTMLElement;
    expect(value.getAttribute('data-divergent')).toBe('true');
    expect(value.textContent).toContain('Diferente');
    const due = el.querySelector('[data-testid="compare-row-dueDate"]') as HTMLElement;
    expect(due.getAttribute('data-divergent')).toBe('false');
    expect(due.textContent).not.toContain('Diferente');
    expect(el.querySelector('[data-testid="compare-summary"]')?.textContent).toContain('1 campo diferente');
  });

  it('carregando: esqueleto, sem linhas nem resumo', () => {
    const el = render({ rows: ROWS, loading: true });

    expect(el.querySelectorAll('[data-testid="compare-skeleton"]').length).toBeGreaterThan(0);
    expect(el.querySelector('[data-testid="compare-row-value"]')).toBeNull();
    expect(el.querySelector('[data-testid="compare-summary"]')).toBeNull();
  });
});
