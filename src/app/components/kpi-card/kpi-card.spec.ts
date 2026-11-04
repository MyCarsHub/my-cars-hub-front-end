import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KpiCard, type KpiNumberFormat } from './kpi-card';

@Component({
  imports: [KpiCard],
  template: `
    <div app-kpi-card data-t="num" label="Receita" [value]="value()" [numberFormat]="fmt()"
         [decimals]="decimals()" [prefix]="prefix()" [countUp]="countUp()" [loading]="loading()"
         [placeholder]="placeholder()"></div>
  `,
})
class NumHost {
  value = signal<number | null>(1234.5);
  fmt = signal<KpiNumberFormat>('integer');
  decimals = signal<number | null>(null);
  prefix = signal('');
  countUp = signal(false);
  loading = signal(false);
  placeholder = signal<'none' | 'dash' | 'skeleton'>('none');
}

@Component({
  imports: [KpiCard],
  template: `
    <div app-kpi-card data-t="link" label="Online" [value]="3" link="/admin/users"
         [linkQueryParams]="{ online: true }" ariaLabel="Ver online"></div>
    <div app-kpi-card data-t="btn" label="Abrir" value="1" [pressable]="true" (pressed)="n = n + 1"></div>
    <div app-kpi-card data-t="static" label="Fixo" value="1"></div>
    <div app-kpi-card data-t="rich" variant="muted" size="compact" tone="danger" label="Rico" value="9"
         [delta]="{ text: '+2 vs mês', tone: 'good' }" [progress]="0.4" [stagger]="2"></div>
  `,
})
class BehaviourHost {
  n = 0;
}

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

describe('KpiCard number formats', () => {
  const nbsp = / /g;
  function mount(setup?: (h: NumHost) => void) {
    TestBed.configureTestingModule({ imports: [NumHost] });
    const fixture = TestBed.createComponent(NumHost);
    setup?.(fixture.componentInstance);
    fixture.detectChanges();
    const text = (): string =>
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-t="num"]')!
        .textContent!.replace(nbsp, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return { fixture, host: fixture.componentInstance, text };
  }

  it.each([
    ['integer', 1234.5, null, 'Receita 1.235'],
    ['decimal', 1234.5, 2, 'Receita 1.234,50'],
    ['brl', 1234.5, null, 'Receita R$ 1.234,50'],
    ['brl-cents', 123450, null, 'Receita R$ 1.234,50'],
    ['percent', 62.5, null, 'Receita 62,5%'],
    ['percent', 50, null, 'Receita 50%'],
    ['percent', 66.666, 0, 'Receita 67%'],
    ['percent', 62.5, 1, 'Receita 62,5%'],
    ['ratio', 0.625, 1, 'Receita 62,5%'],
  ] as const)('%s formats %s', (fmt, value, decimals, expected) => {
    const { text } = mount((h) => {
      h.fmt.set(fmt);
      h.value.set(value);
      h.decimals.set(decimals);
    });
    expect(text()).toBe(expected);
  });

  it('prefixo entra antes do numero formatado', () => {
    const { text } = mount((h) => {
      h.prefix.set('≈ ');
      h.value.set(12);
    });
    expect(text()).toBe('Receita ≈ 12');
  });

  it('valor nulo: nada, travessao ou barra, conforme o placeholder', () => {
    const { fixture, host, text } = mount((h) => h.value.set(null));
    expect(text()).toBe('Receita');
    host.placeholder.set('dash');
    fixture.detectChanges();
    expect(text()).toBe('Receita—');
    host.placeholder.set('skeleton');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('carregando mostra a barra e esconde o numero', () => {
    const { fixture, text } = mount((h) => h.loading.set(true));
    expect(text()).toBe('Receita');
    expect(fixture.nativeElement.querySelector('.animate-pulse')).not.toBeNull();
  });

  describe('contagem', () => {
    let queue: Array<(t: number) => void>;
    let clock: number;
    let reduced: boolean;

    beforeEach(() => {
      queue = [];
      clock = 0;
      reduced = false;
      vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
      vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => queue.push(cb));
      vi.stubGlobal('cancelAnimationFrame', () => undefined);
      vi.spyOn(performance, 'now').mockImplementation(() => clock);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    const step = (ms: number): void => {
      clock += ms;
      queue.splice(0).forEach((cb) => cb(clock));
    };

    it('conta de 0 e termina EXATAMENTE no valor formatado', () => {
      const { fixture, text } = mount((h) => {
        h.countUp.set(true);
        h.fmt.set('brl');
        h.value.set(1000);
      });
      expect(text()).toBe('Receita R$ 0,00');
      step(350);
      fixture.detectChanges();
      expect(text()).not.toBe('Receita R$ 0,00');
      expect(text()).not.toBe('Receita R$ 1.000,00');
      step(400);
      fixture.detectChanges();
      expect(text()).toBe('Receita R$ 1.000,00');
    });

    it('mudanca depois da carga reanima a partir do numero anterior, nao de 0', () => {
      const { fixture, host, text } = mount((h) => {
        h.countUp.set(true);
        h.value.set(100);
      });
      step(800);
      fixture.detectChanges();
      expect(text()).toBe('Receita 100');
      host.value.set(200);
      fixture.detectChanges();
      expect(text()).toBe('Receita 100');
      step(350);
      fixture.detectChanges();
      const mid = Number(text().replace('Receita ', ''));
      expect(mid).toBeGreaterThan(100);
      expect(mid).toBeLessThan(200);
      step(400);
      fixture.detectChanges();
      expect(text()).toBe('Receita 200');
    });

    it('movimento reduzido salta direto ao valor final', () => {
      reduced = true;
      const { text } = mount((h) => {
        h.countUp.set(true);
        h.value.set(500);
      });
      expect(text()).toBe('Receita 500');
      expect(performance.now).not.toHaveBeenCalled();
    });

    it('countUp=false salta direto, mesmo com movimento permitido', () => {
      const { text } = mount((h) => {
        h.countUp.set(false);
        h.value.set(500);
      });
      expect(text()).toBe('Receita 500');
      expect(performance.now).not.toHaveBeenCalled();
    });
  });
});

describe('KpiCard link, button and extras', () => {
  function mount() {
    TestBed.configureTestingModule({ imports: [BehaviourHost], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(BehaviourHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return { fixture, el: (t: string) => root.querySelector<HTMLElement>(`[data-t="${t}"]`)! };
  }

  it('link vira role=link focavel, com nome e feedback de toque; navega por clique e Enter', () => {
    const { el } = mount();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const card = el('link');
    expect(card.getAttribute('role')).toBe('link');
    expect(card.getAttribute('tabindex')).toBe('0');
    expect(card.getAttribute('aria-label')).toBe('Ver online');
    expect(card.className).toContain('active:scale-[0.98]');
    expect(card.className).toContain('focus-visible:ring-2');
    card.click();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith(['/admin/users'], { queryParams: { online: true } });
  });

  it('pressable vira role=button e emite com clique, Enter e Espaco', () => {
    const { fixture, el } = mount();
    const card = el('btn');
    expect(card.getAttribute('role')).toBe('button');
    card.click();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(fixture.componentInstance.n).toBe(3);
  });

  it('cartao comum nao e interativo', () => {
    const card = mount().el('static');
    expect(card.getAttribute('role')).toBeNull();
    expect(card.getAttribute('tabindex')).toBeNull();
    expect(card.className).not.toContain('cursor-pointer');
  });

  it('variante muted, tamanho compacto, tom, variacao, barra e escada', () => {
    const card = mount().el('rich');
    expect(card.className).toContain('border-dashed');
    expect(card.className).toContain('p-3');
    expect(card.className).toContain('enter-up');
    expect(card.style.getPropertyValue('--stagger-i')).toBe('2');
    expect(card.querySelector('[data-kpi-delta]')?.className).toContain('text-emerald-700');
    expect(card.querySelector('p:nth-of-type(2)')?.className).toContain('text-rose-700');
    expect((card.querySelector('[data-kpi-progress] > div') as HTMLElement).style.width).toBe('40%');
  });
});
