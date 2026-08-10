import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingFooterComponent } from './landing-footer.component';

describe('LandingFooterComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingFooterComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(LandingFooterComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingFooterComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  /**
   * O rodapé publicava "Sobre" e "Contato" apontando para `#` — clicar recarregava o topo
   * e parecia defeito. "Sobre" saiu (a página não existe) e "Contato" virou e-mail. Este
   * teste impede que um link de rascunho volte por descuido: nenhum `href="#"` sobrevive.
   */
  it('não publica link morto apontando para `#`', () => {
    const dead = render().querySelectorAll('a[href="#"]');
    expect(Array.from(dead, (a) => a.textContent?.trim())).toEqual([]);
  });

  it('não anuncia uma página "Sobre" que não existe', () => {
    const labels = Array.from(render().querySelectorAll('a'), (a) => a.textContent?.trim());
    expect(labels).not.toContain('Sobre');
  });

  /**
   * O endereço é o MESMO que o FAQ publica (`landing-faq.component.html`). Se ele mudar,
   * mude nos dois lugares — este teste quebra em um deles, o FAQ fica por sua conta.
   */
  it('abre o e-mail de contato que o FAQ também publica', () => {
    const contato = Array.from(render().querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === 'Contato'
    );
    expect(contato?.getAttribute('href')).toBe('mailto:mycarshubcompany@gmail.com');
  });
});
