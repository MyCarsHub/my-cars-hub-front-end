import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsentService } from './consent.service';

/**
 * A tag do GA4 sobe com o Consent Mode NEGADO por padrao. Este servico e o unico
 * que muda esse estado, e o unico que fala com o `gtag`. O que estes testes
 * protegem e a regra que a politica de privacidade passou a afirmar: nada e
 * gravado antes do aceite, e da para revogar.
 */
describe('ConsentService', () => {
  let gtag: ReturnType<typeof vi.fn>;

  function make(): ConsentService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }, ConsentService],
    });
    return TestBed.inject(ConsentService);
  }

  beforeEach(() => {
    localStorage.clear();
    gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
  });

  afterEach(() => {
    localStorage.clear();
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it('comeca indeciso e NAO concede nada sozinho', () => {
    const consent = make();

    expect(consent.decision()).toBeNull();
    expect(consent.undecided()).toBe(true);
    // O mais importante do arquivo: sem decisao, ninguem mandou conceder nada.
    expect(gtag).not.toHaveBeenCalled();
  });

  it('aceitar concede analytics_storage e persiste', () => {
    const consent = make();

    consent.accept();

    expect(gtag).toHaveBeenCalledWith(
      'consent',
      'update',
      expect.objectContaining({ analytics_storage: 'granted' }),
    );
    expect(localStorage.getItem('analyticsConsent')).toBe('granted');
    expect(consent.undecided()).toBe(false);
  });

  /** Nunca pedimos anuncio: os tres campos de ads ficam negados mesmo no aceite. */
  it('aceitar NAO libera nada de publicidade', () => {
    make().accept();

    expect(gtag).toHaveBeenCalledWith(
      'consent',
      'update',
      expect.objectContaining({
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      }),
    );
  });

  it('recusar mantem negado e TAMBEM persiste — nao pergunta de novo', () => {
    const consent = make();

    consent.reject();

    expect(gtag).toHaveBeenCalledWith(
      'consent',
      'update',
      expect.objectContaining({ analytics_storage: 'denied' }),
    );
    expect(localStorage.getItem('analyticsConsent')).toBe('denied');
    expect(consent.undecided()).toBe(false);
  });

  /** A escolha tem de sobreviver a navegacao — por isso localStorage e nao sessao. */
  it('a escolha sobrevive a uma nova instancia do servico', () => {
    make().accept();

    const outraVisita = make();

    expect(outraVisita.decision()).toBe('granted');
    expect(outraVisita.undecided()).toBe(false);
  });

  /** A politica afirma que da para revogar. Isto e o que torna a frase verdadeira. */
  it('revogar volta para negado e pergunta de novo', () => {
    const consent = make();
    consent.accept();
    gtag.mockClear();

    consent.revoke();

    expect(gtag).toHaveBeenCalledWith(
      'consent',
      'update',
      expect.objectContaining({ analytics_storage: 'denied' }),
    );
    expect(localStorage.getItem('analyticsConsent')).toBeNull();
    expect(consent.undecided()).toBe(true);
  });

  it('valor invalido guardado a mao e tratado como indeciso', () => {
    localStorage.setItem('analyticsConsent', 'talvez');

    expect(make().undecided()).toBe(true);
  });

  /** Bloqueador de anuncio derruba o `gtag`; a tela nao pode cair junto. */
  it('sem gtag na pagina, decidir nao quebra nada', () => {
    delete (window as unknown as { gtag?: unknown }).gtag;
    const consent = make();

    expect(() => consent.accept()).not.toThrow();
    expect(localStorage.getItem('analyticsConsent')).toBe('granted');
  });

  /** No prerender nao existe navegador: nada de storage, nada de gtag. */
  it('no servidor fica indeciso e nao toca em nada', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }, ConsentService],
    });
    const consent = TestBed.inject(ConsentService);

    consent.accept();

    expect(gtag).not.toHaveBeenCalled();
  });
});
