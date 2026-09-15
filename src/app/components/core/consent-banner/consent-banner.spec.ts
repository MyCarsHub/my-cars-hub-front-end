import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsentBanner } from './consent-banner';
import { ConsentService } from '../../../services/consent.service';

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

  /** Alvo de toque no telefone. */
  it('os dois botoes tem alvo de 44px', () => {
    render();

    for (const sel of ['[data-consent-accept]', '[data-consent-reject]']) {
      expect(el(sel)?.className).toContain('min-h-[44px]');
    }
  });
});
