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
   * A legenda "Imagem de demonstração da interface — os números exibidos são exemplos,
   * não resultados reais." existiu sob o print e foi removida a pedido do dono: ela
   * pesava no primeiro olhar do hero. A decisão é deliberada, então fica travada aqui —
   * a frase não deve voltar ao texto visível da página.
   *
   * O que NÃO some junto é o `alt` da imagem, que continua dizendo "demonstração": ele é
   * invisível na página, não é a frase que o dono pediu para tirar, e é o que preserva a
   * ressalva para quem usa leitor de tela — os chips ("27 contratos ativos",
   * "R$ 14.230") são `aria-hidden` e nunca são anunciados.
   */
  describe('a legenda de demonstração do print continua removida', () => {
    it.each([
      ['a frase inteira', /exemplos,\s*não\s*resultados\s*reais/i],
      ['a abertura da legenda', /imagem de demonstração da interface/i],
    ])('não exibe %s no texto da página', (_label, forbidden) => {
      const text = (render().textContent ?? '').replace(/\s+/g, ' ');

      expect(text).not.toMatch(forbidden);
    });

    it('não deixa nenhum parágrafo de ressalva sob o print', () => {
      const host = render();

      const aviso = Array.from(host.querySelectorAll('p')).find((p) =>
        /exemplos,\s*não\s*resultados\s*reais/i.test(p.textContent ?? '')
      );

      expect(aviso).toBeUndefined();
    });

    it('mantém o print descrito como demonstração no `alt` da imagem', () => {
      const img = render().querySelector('img');

      expect(img?.getAttribute('alt')).toMatch(/demonstração/i);
    });
  });
});
