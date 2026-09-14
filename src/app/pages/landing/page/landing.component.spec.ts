import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingComponent } from './landing.component';

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

describe('LandingComponent', () => {
  let fixture: ComponentFixture<LandingComponent>;

  beforeEach(async () => {
    (
      globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }
    ).IntersectionObserver = IntersectionObserverStub;
    await TestBed.configureTestingModule({
      imports: [LandingComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(LandingComponent);
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('a ordem das âncoras do header acompanha a ordem real das seções na página', () => {
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const fragments = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('header nav a'),
    )
      .map((a) => a.getAttribute('href') ?? '')
      .filter((href) => href.includes('#'))
      .map((href) => href.slice(href.indexOf('#') + 1));

    // Posição de cada seção no DOM da landing, na ordem em que o visitante rola.
    const positions = fragments.map((fragment) => {
      const section = host.querySelector(`#${fragment}`);
      expect(section).toBeTruthy();
      return Array.from(host.querySelectorAll('[id]')).indexOf(section!);
    });

    expect(fragments).toContain('simulador');
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('todo fragmento apontado pelo header existe na página', () => {
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const fragments = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('header nav a'),
    )
      .map((a) => a.getAttribute('href') ?? '')
      .filter((href) => href.includes('#'))
      .map((href) => href.slice(href.indexOf('#') + 1));

    expect(fragments.length).toBeGreaterThan(0);
    for (const fragment of fragments) {
      expect(host.querySelector(`#${fragment}`)).toBeTruthy();
    }
  });

  /**
   * FIX-0295 — o FAB de voltar ao topo cobria o texto do card de plano.
   *
   * Ele e `position: fixed` no canto inferior direito. No desktop a grade de
   * planos tem quatro colunas centradas e sobra margem, entao o FAB cai fora do
   * conteudo. No TELEFONE o card ocupa a largura toda e nao existe goteira em
   * que ele caiba: fica por cima do card. Medido num viewport de 386px, cobrindo
   * a linha do preco anual ("ou R$ 66,58/mes no anual") numa area de 21x16px.
   *
   * Some enquanto a secao de planos esta na tela — a pagina que existe para
   * converter nao pode ter um botao decorativo em cima do preco.
   */
  describe('FAB nao cobre os planos (FIX-0295)', () => {
    /** O FAB so aparece depois de 600px de rolagem. */
    function scrollTo(y: number): void {
      Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
      window.dispatchEvent(new Event('scroll'));
      fixture.detectChanges();
    }

    /** Finge onde a secao de planos esta em relacao a viewport. */
    function placePricing(top: number, bottom: number): void {
      const host = fixture.nativeElement as HTMLElement;
      const section = host.querySelector('#planos');
      if (!section) throw new Error('secao de planos nao renderizada');
      section.getBoundingClientRect = () =>
        ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top }) as DOMRect;
      Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    }

    function fabVisible(): boolean {
      const fab = (fixture.nativeElement as HTMLElement).querySelector('.fab-logo');
      return !!fab?.classList.contains('fab-logo--visible');
    }

    beforeEach(() => {
      fixture.detectChanges();
    });

    it('aparece quando os planos estao longe da tela', () => {
      placePricing(2000, 3000);
      scrollTo(1200);

      expect(fabVisible()).toBe(true);
    });

    it('some enquanto a secao de planos esta na tela', () => {
      placePricing(100, 900);
      scrollTo(1200);

      expect(fabVisible()).toBe(false);
    });

    it('some tambem quando os planos entram so pela borda de baixo', () => {
      placePricing(780, 1600);
      scrollTo(1200);

      expect(fabVisible()).toBe(false);
    });

    it('continua escondido antes dos 600px de rolagem, como sempre foi', () => {
      placePricing(2000, 3000);
      scrollTo(100);

      expect(fabVisible()).toBe(false);
    });
  });
});
