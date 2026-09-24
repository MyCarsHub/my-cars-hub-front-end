import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { LoginService } from '../../services/loginService';
import { GoogleLogin } from './google-login';

describe('GoogleLogin', () => {
  let component: GoogleLogin;
  let fixture: ComponentFixture<GoogleLogin>;
  const loginWithGoogle = vi.fn();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GoogleLogin],
      providers: [
        { provide: LoginService, useValue: { loginWithGoogle } },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GoogleLogin);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts the Google OAuth flow once and shows a loading state', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');

    button.click();
    fixture.detectChanges();
    button.click();

    expect(loginWithGoogle).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Redirecionando');
  });

  /**
   * FIX-0289 — os dois links de consentimento eram `href="#"`.
   *
   * Morto EXATAMENTE no momento do consentimento: esta e a tela onde a pessoa
   * autoriza, e os dois documentos que ela esta autorizando nao abriam. As rotas
   * existem e funcionam desde sempre a partir do rodape da landing — os
   * documentos estavam publicados e alcancaveis em todo lugar MENOS aqui.
   *
   * O alvo e a navegacao, entao o teste olha o `href` resolvido pelo router, e
   * nao a presenca do atributo `routerLink`: e o `href` que decide se o clique
   * leva a algum lugar.
   */
  describe('links de consentimento (FIX-0289)', () => {
    function anchor(text: string): HTMLAnchorElement {
      const found = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('a'),
      ).find((a) => (a.textContent ?? '').trim().toLowerCase() === text.toLowerCase());
      if (!found) throw new Error(`ancora ausente: ${text}`);
      return found as HTMLAnchorElement;
    }

    it('leva aos Termos de Uso de verdade', () => {
      expect(anchor('Termos de Uso').getAttribute('href')).toBe('/termos-de-uso');
    });

    it('leva a Politica de Privacidade de verdade', () => {
      expect(anchor('Política de Privacidade').getAttribute('href')).toBe(
        '/politica-de-privacidade',
      );
    });

    it('nenhuma ancora da tela continua apontando para `#`', () => {
      const dead = (fixture.nativeElement as HTMLElement).querySelectorAll('a[href="#"]');
      expect(Array.from(dead, (a) => a.textContent?.trim())).toEqual([]);
    });

    /** Abrir o documento nao pode custar o fluxo de login pela metade. */
    it('abre em aba nova, sem expor a janela de origem', () => {
      for (const label of ['Termos de Uso', 'Política de Privacidade']) {
        expect(anchor(label).getAttribute('target')).toBe('_blank');
        expect(anchor(label).getAttribute('rel')).toContain('noopener');
      }
    });
  });
});
