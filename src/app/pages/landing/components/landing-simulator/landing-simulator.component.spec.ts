import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingSimulatorComponent } from './landing-simulator.component';

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

describe('LandingSimulatorComponent', () => {
  beforeEach(async () => {
    (
      globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }
    ).IntersectionObserver = IntersectionObserverStub;
    await TestBed.configureTestingModule({
      imports: [LandingSimulatorComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  function render(): {
    fixture: ComponentFixture<LandingSimulatorComponent>;
    host: HTMLElement;
  } {
    const fixture = TestBed.createComponent(LandingSimulatorComponent);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  function slider(host: HTMLElement): HTMLInputElement {
    const el = host.querySelector<HTMLInputElement>('input[type="range"]');
    if (!el) throw new Error('slider não encontrado');
    return el;
  }

  function moveSlider(
    fixture: ComponentFixture<LandingSimulatorComponent>,
    host: HTMLElement,
    value: number,
  ): void {
    const el = slider(host);
    el.value = String(value);
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('should create', () => {
    const { fixture } = render();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renderiza os textos estáticos (título, subtítulo e CTA no template)', () => {
    const { host } = render();
    const text = (host.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Quanto tempo sua frota');
    expect(text).toContain('rouba de você?');
    expect(text).toContain(
      'Arraste e veja quantas horas por mês vão embora administrando no manual.',
    );
    expect(text).toContain('Quero minhas horas de volta');
    expect(text).toContain('Cobranças, multas e vencimentos avisam sozinhos.');
  });

  it('a seção tem a âncora id="simulador"', () => {
    const { host } = render();
    expect(host.querySelector('section#simulador')).toBeTruthy();
  });

  it('default: 7 carros, Planilha + WhatsApp → 26h/mês, linhas 10/7/4/5, ~2h', () => {
    const { host } = render();
    const text = (host.textContent ?? '').replace(/\s+/g, ' ');
    expect(slider(host).value).toBe('7');
    expect(text).toContain('26h');
    expect(text).toContain('~2h');
    expect(text).toContain('3 dias de trabalho');
    expect(text).toContain('um mês e meio');
    for (const h of ['10h', '7h', '4h', '5h']) {
      expect(text).toContain(h);
    }
  });

  it('recalcula ao mover o slider', () => {
    const { fixture, host } = render();
    moveSlider(fixture, host, 15);
    const text = (host.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('56h'); // 15 carros × planilha, linha-primeiro
    expect(text).toContain('~4h');
  });

  it('recalcula ao trocar o chip de método', () => {
    const { fixture, host } = render();
    const chips = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
    );
    expect(chips.length).toBe(3);

    const caderno = chips.find((c) => c.textContent?.includes('Caderno'));
    if (!caderno) throw new Error('chip Caderno não encontrado');
    caderno.click();
    fixture.detectChanges();

    const text = (host.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('30h'); // 7 carros × caderno (1,15), linha-primeiro
    expect(caderno.getAttribute('aria-pressed')).toBe('true');
    const planilha = chips.find((c) => c.textContent?.includes('Planilha'));
    expect(planilha?.getAttribute('aria-pressed')).toBe('false');
  });

  it('CTA aponta para /login', () => {
    const { host } = render();
    const cta = Array.from(host.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Quero minhas horas de volta'),
    );
    expect(cta?.getAttribute('href')).toBe('/login');
  });

  it('aria-valuetext acompanha o slider (plural e singular)', () => {
    const { fixture, host } = render();
    expect(slider(host).getAttribute('aria-valuetext')).toBe('7 carros');
    moveSlider(fixture, host, 1);
    expect(slider(host).getAttribute('aria-valuetext')).toBe('1 carro');
  });

  it('o resultado anuncia mudanças via aria-live="polite"', () => {
    const { host } = render();
    const live = host.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
    expect(live?.textContent).toContain('26h');
  });

  it('as linhas do breakdown não têm emoji (rótulo textual + horas)', () => {
    const { host } = render();
    const text = host.textContent ?? '';
    expect(text).not.toMatch(/💬|📋|🚔|🪪/);
    expect(text).toContain('Cobrar aluguel um por um');
    expect(text).toContain('Manter a planilha em dia');
    expect(text).toContain('Descobrir e repassar multas');
    expect(text).toContain('CNH, IPVA e manutenção');
  });

  it('o gráfico tem alternativa textual (role="img" com todos os valores)', () => {
    const { host } = render();
    const chart = host.querySelector('[role="img"]');
    expect(chart).toBeTruthy();
    const label = chart?.getAttribute('aria-label') ?? '';
    expect(label).toContain('26 horas por mês');
    expect(label).toContain('cobranças 10h');
    expect(label).toContain('planilha 7h');
    expect(label).toContain('multas 4h');
    expect(label).toContain('vencimentos 5h');
    expect(label).toContain('cerca de 2 horas por mês');
  });

  function widths(host: HTMLElement): { segments: number[]; hub: number } {
    const segs = Array.from(
      host.querySelectorAll<HTMLElement>('.sim-track .sim-seg:not(.sim-seg--hub)'),
    ).map((el) => parseFloat(el.style.width));
    const hub = host.querySelector<HTMLElement>('.sim-seg--hub');
    if (!hub) throw new Error('barra do MyCarsHub não encontrada');
    return { segments: segs, hub: parseFloat(hub.style.width) };
  }

  it('proporcionalidade: barra manual (4 segmentos somando 100%) > barra MyCarsHub', () => {
    const { host } = render();
    const { segments, hub } = widths(host);
    expect(segments.length).toBe(4);
    const manualTotal = segments.reduce((a, b) => a + b, 0);
    expect(manualTotal).toBeCloseTo(100, 5);
    expect(hub).toBeGreaterThan(0);
    expect(hub).toBeLessThan(manualTotal);
    // 7 carros × planilha: 2h de 26h ≈ 7,7% do trilho.
    expect(hub).toBeCloseTo((2 / 26) * 100, 5);
  });

  it('as larguras das barras mudam com o slider', () => {
    const { fixture, host } = render();
    moveSlider(fixture, host, 1);
    const antes = widths(host);
    moveSlider(fixture, host, 15);
    const depois = widths(host);
    expect(depois.hub).not.toBeCloseTo(antes.hub, 5);
    expect(depois.segments[0]).not.toBeCloseTo(antes.segments[0], 5);
  });
});
