import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { KpiCard } from './kpi-card';

@Component({
  imports: [KpiCard],
  template: `
    <div app-kpi-card data-t="primary" variant="primary" label="Receita" value="R$ 10" detail="no mês"></div>
    <div app-kpi-card data-t="emerald" variant="emerald" label="ROI" [value]="5" detail="líquido"></div>
    <div app-kpi-card data-t="dark" variant="emerald-dark" label="Uso" value="80%" detail="frota"></div>
    <div app-kpi-card data-t="white" label="Veículos" [value]="12" detail="no plano"></div>
    <div app-kpi-card data-t="loading" label="Motoristas" [loading]="true" value="9" detail="x"></div>
    <div app-kpi-card data-t="bare" label="Sem dado"></div>
  `,
})
class Host {}

describe('KpiCard', () => {
  function render(): HTMLElement {
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const card = (root: HTMLElement, t: string): HTMLElement => {
    const el = root.querySelector<HTMLElement>(`[data-t="${t}"]`);
    if (!el) throw new Error(t);
    return el;
  };

  it('a variante escolhe o fundo; o raio e o mesmo nas quatro', () => {
    const root = render();
    expect(card(root, 'primary').className).toContain('bg-primary-500');
    expect(card(root, 'emerald').className).toContain('bg-emerald-600');
    expect(card(root, 'dark').className).toContain('bg-emerald-700');
    expect(card(root, 'white').className).toContain('bg-white');
    for (const t of ['primary', 'emerald', 'dark', 'white']) {
      expect(card(root, t).className, t).toContain('rounded-2xl');
    }
  });

  it('o cartao branco e o padrao e usa o cinza do Dashboard, nao texto branco', () => {
    const el = card(render(), 'white');
    expect(el.className).toContain('border-gray-200');
    expect(el.className).not.toContain('text-white');
    expect(el.querySelector('p:nth-child(2)')?.className).toContain('text-gray-900');
  });

  it('rotulo, numero e legenda, nessa ordem, e o numero aceita numero', () => {
    const el = card(render(), 'emerald');
    const paragraphs = Array.from(el.querySelectorAll('p')).map((p) => p.textContent?.trim());
    expect(paragraphs).toEqual(['ROI', '5', 'líquido']);
  });

  it('carregando mostra so o rotulo e a barra, sem numero nem legenda', () => {
    const el = card(render(), 'loading');
    expect(el.textContent).toContain('Motoristas');
    expect(el.textContent).not.toContain('9');
    expect(el.querySelector('.animate-pulse')).not.toBeNull();
    expect(el.querySelectorAll('p')).toHaveLength(1);
  });

  it('sem valor e sem legenda fica so o rotulo', () => {
    const el = card(render(), 'bare');
    expect(el.querySelectorAll('p')).toHaveLength(1);
    expect(el.querySelector('.animate-pulse')).toBeNull();
  });
});
