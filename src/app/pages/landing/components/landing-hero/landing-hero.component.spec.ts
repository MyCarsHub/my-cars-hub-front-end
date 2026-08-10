import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingHeroComponent } from './landing-hero.component';

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

describe('LandingHeroComponent', () => {
  beforeEach(async () => {
    (
      globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }
    ).IntersectionObserver = IntersectionObserverStub;
    await TestBed.configureTestingModule({
      imports: [LandingHeroComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(LandingHeroComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingHeroComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  /**
   * Os chips do mockup exibem "27 contratos ativos" e "R$ 14.230" — números de uma conta
   * de demonstração, não resultados de cliente. Sem a ressalva eles se leem como tração
   * real, que é exatamente a alegação que esta página não pode fazer.
   */
  describe('os números do mockup são declarados como exemplo', () => {
    it('publica a ressalva de demonstração junto ao print', () => {
      const text = (render().textContent ?? '').replace(/\s+/g, ' ');
      expect(text).toMatch(/demonstração/i);
      expect(text).toMatch(/exemplos, não resultados reais/i);
    });

    /**
     * Os chips são `aria-hidden`: quem usa leitor de tela não ouve "27 contratos ativos".
     * A ressalva, então, NÃO pode estar escondida também — senão a indicação existe só
     * para quem enxerga. Ela precisa estar fora de qualquer subárvore `aria-hidden`.
     */
    it('deixa a ressalva visível para leitor de tela', () => {
      const host = render();
      const aviso = Array.from(host.querySelectorAll('p')).find((p) =>
        /exemplos, não resultados reais/i.test(p.textContent ?? '')
      );
      expect(aviso).toBeDefined();
      expect(aviso?.closest('[aria-hidden="true"]')).toBeNull();
    });

    it('descreve o print como demonstração no `alt` da imagem', () => {
      const img = render().querySelector('img');
      expect(img?.getAttribute('alt')).toMatch(/demonstração/i);
    });
  });
});
