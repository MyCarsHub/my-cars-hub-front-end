import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingFooterComponent } from './landing-footer.component';
import { COMPANY_IDENTITY, type CompanyIdentity } from '../../company-identity';

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

  /**
   * FIX-0294 — nenhuma pagina publica dizia QUEM esta por tras do produto.
   *
   * Sem razao social, CNPJ e endereco, o visitante nao tem como saber com quem
   * esta contratando, e o titular de dados nao tem como identificar o
   * controlador para exercer um direito da LGPD.
   *
   * Os valores reais NAO estao no repositorio. O bloco entra por token: com
   * valores, renderiza; sem valores, nao existe. Inventar um numero de registro
   * de empresa seria publicar documento falso, nao usar um placeholder — por
   * isso o estado padrao e o silencio, e nao um "00.000.000/0001-00".
   */
  describe('identidade legal da empresa (FIX-0294)', () => {
    const IDENTITY: CompanyIdentity = {
      legalName: 'Exemplo Tecnologia Ltda',
      cnpj: '11.222.333/0001-81',
      address: 'Rua Exemplo, 100 - Sao Paulo/SP',
    };

    function renderWith(identity: CompanyIdentity | null): HTMLElement {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [LandingFooterComponent],
        providers: [provideRouter([]), { provide: COMPANY_IDENTITY, useValue: identity }],
      });
      const fixture = TestBed.createComponent(LandingFooterComponent);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('publica razao social, CNPJ e endereco quando os valores existem', () => {
      const text = (renderWith(IDENTITY).textContent ?? '').replace(/\s+/g, ' ');

      expect(text).toContain('Exemplo Tecnologia Ltda');
      expect(text).toContain('CNPJ 11.222.333/0001-81');
      expect(text).toContain('Rua Exemplo, 100 - Sao Paulo/SP');
    });

    /** Marcacao semantica: e o endereco do responsavel pela pagina. */
    it('usa <address> para o bloco', () => {
      expect(renderWith(IDENTITY).querySelector('address')).not.toBeNull();
    });

    it('sem valores, nao inventa nada — o bloco simplesmente nao existe', () => {
      const host = renderWith(null);

      expect(host.querySelector('address')).toBeNull();
      expect(host.textContent ?? '').not.toContain('CNPJ');
    });

    /** O padrao do token e `null`: nada vai ao ar ate o dono fornecer os valores. */
    it('o padrao do token e silencio, nao um CNPJ de exemplo', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [LandingFooterComponent],
        providers: [provideRouter([])],
      });
      const fixture = TestBed.createComponent(LandingFooterComponent);
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent ?? '').not.toContain('CNPJ');
    });
  });
});
