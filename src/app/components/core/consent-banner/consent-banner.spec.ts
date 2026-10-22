import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsentBanner } from './consent-banner';
import { ConsentService } from '../../../services/consent.service';
import { LayoutStore } from '../layouts/layout.store';

describe('ConsentBanner', () => {
  let fixture: ComponentFixture<ConsentBanner>;
  let gtag: ReturnType<typeof vi.fn>;

  function render(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ConsentBanner],
      providers: [provideRouter([]), { provide: PLATFORM_ID, useValue: 'browser' }, ConsentService],
    });
    fixture = TestBed.createComponent(ConsentBanner);
    fixture.detectChanges();
  }

  function el(selector: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(selector);
  }

  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  beforeEach(() => {
    localStorage.clear();
    document.body.classList.remove('has-consent-banner');
    gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
  });

  afterEach(() => {
    fixture?.destroy();
    document.documentElement.style.removeProperty('--consent-banner-h');
    localStorage.clear();
    document.body.classList.remove('has-consent-banner');
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it('aparece enquanto ninguem decidiu', () => {
    render();

    expect(el('[data-consent-banner]')).not.toBeNull();
  });

  /** O minimo honesto: ferramenta, finalidade, cookie, e o caminho para o detalhe. */
  it('diz o que coleta, para que, e aponta para a politica', () => {
    render();

    expect(text()).toContain('Google Analytics');
    expect(text()).toContain('cookie');
    expect(el('a[href="/politica-de-privacidade"]')).not.toBeNull();
  });

  it('aceitar fecha o banner e concede', () => {
    render();

    (el('[data-consent-accept]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el('[data-consent-banner]')).toBeNull();
    expect(gtag).toHaveBeenCalledWith(
      'consent',
      'update',
      expect.objectContaining({ analytics_storage: 'granted' }),
    );
  });

  it('recusar fecha o banner e mantem negado', () => {
    render();

    (el('[data-consent-reject]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el('[data-consent-banner]')).toBeNull();
    expect(gtag).toHaveBeenCalledWith(
      'consent',
      'update',
      expect.objectContaining({ analytics_storage: 'denied' }),
    );
  });

  it('quem ja decidiu nao ve o banner de novo', () => {
    localStorage.setItem('analyticsConsent', 'denied');

    render();

    expect(el('[data-consent-banner]')).toBeNull();
  });

  /**
   * Ele e `fixed` no rodape: sem reservar altura, cobriria o fim do documento no
   * telefone — inclusive o rodape, onde mora o link da politica que o proprio
   * banner manda ler. Ja perdemos um node para um `fixed` cobrindo preco (FIX-0295).
   */
  it('reserva espaco no body enquanto esta na tela, e devolve ao sair', () => {
    render();
    expect(document.body.classList.contains('has-consent-banner')).toBe(true);

    (el('[data-consent-accept]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(document.body.classList.contains('has-consent-banner')).toBe(false);
  });

  /**
   * O banner (z-[90]) fica acima do drawer do celular (z-50) e cobria o rodape dele —
   * Suporte e Perfil ficavam sem toque ate a pessoa decidir os cookies. Com o drawer
   * aberto ele sai da tela SEM registrar decisao nenhuma, e volta quando o drawer fecha.
   */
  it('some enquanto o drawer do celular esta aberto, sem decidir nada, e volta ao fechar', () => {
    render();
    const layout = TestBed.inject(LayoutStore);
    layout.setMobile(true);
    layout.openMobile();
    fixture.detectChanges();

    expect(el('[data-consent-banner]')).toBeNull();
    expect(localStorage.getItem('analyticsConsent')).toBeNull();
    expect(gtag).not.toHaveBeenCalled();

    layout.closeMobile();
    fixture.detectChanges();
    expect(el('[data-consent-banner]')).not.toBeNull();
  });

  /**
   * Dentro do shell autenticado o body não rola: o respiro do body não protege nada. O
   * banner publica a própria altura em `--consent-banner-h` (o shell e a sidebar a
   * descontam) e fica ABAIXO de diálogos e sheets (z-40/z-50) — com z-[90] ele cobria o
   * "Copiar código Pix" do sheet de pagamento no celular.
   */
  it('publica a altura em --consent-banner-h enquanto aparece, e limpa ao sair', () => {
    render();
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--consent-banner-h')).toMatch(/^\d+(\.\d+)?px$/);

    (el('[data-consent-reject]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.style.getPropertyValue('--consent-banner-h')).toBe('');
  });

  it('fica abaixo de diálogos e sheets (z menor que 40)', () => {
    render();
    const z = /(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/.exec(el('[data-consent-banner]')!.className);
    expect(z).not.toBeNull();
    expect(Number(z![1])).toBeLessThan(40);
    // ...e acima do FAB e da sidebar fixa (z-30).
    expect(Number(z![1])).toBeGreaterThan(30);
  });

  /** Alvo de toque no telefone. */
  it('os dois botoes tem alvo de 44px', () => {
    render();

    for (const sel of ['[data-consent-accept]', '[data-consent-reject]']) {
      expect(el(sel)?.className).toContain('min-h-[44px]');
    }
  });
});
