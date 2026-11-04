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
    <div app-kpi-card data-t="count" label="Contado" [countTo]="1234" [format]="money" [formatCompact]="short"
         detail="completa" detailCompact="curta" [anchored]="true"><svg kpiIcon data-icon></svg></div>
  `,
})
class Host {
  money = (n: number): string => `R$ ${n},00`;
  short = (n: number): string => `R$ ${n}`;
}

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
    expect(card(root, 'white').className).toContain('bg-surface');
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

  it('com countTo o numero chega ao valor final (sem requestAnimationFrame o salto e imediato)', () => {
    const el = card(render(), 'count');
    expect(el.textContent).toContain('R$ 1234,00');
    expect(el.textContent).toContain('R$ 1234');
  });

  it('numero e legenda compactos so valem abaixo de md; o icone entra no rotulo', () => {
    const el = card(render(), 'count');
    const detail = Array.from(el.querySelectorAll('[data-kpi-detail]'));
    expect(detail.map((p) => p.className.includes('md:hidden'))).toEqual([false, true]);
    expect(detail[0].className).toContain('hidden md:block');
    expect(el.querySelector('p:first-child [data-icon]')).not.toBeNull();
    expect(el.className).toContain('flex!');
  });
});
