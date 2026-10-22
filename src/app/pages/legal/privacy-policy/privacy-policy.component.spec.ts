import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrivacyPolicyComponent } from './privacy-policy.component';
import { ConsentService } from '../../../services/consent.service';

/**
 * A secao 7 da politica AFIRMAVA que o produto nao usa cookies nem Google
 * Analytics. No minuto em que a tag entrou, essa frase virou falsa — num
 * documento que existe exatamente para dizer ao titular o que se faz com os
 * dados dele. Estes testes prendem a versao verdadeira, nas DUAS linguas.
 */
describe('PrivacyPolicyComponent — secao de cookies (GA4)', () => {
  async function visit(lang: 'pt' | 'en'): Promise<string> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'politica-de-privacidade', component: PrivacyPolicyComponent }]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        ConsentService,
      ],
    });
    const suffix = lang === 'en' ? '?lang=en' : '';
    const harness = await RouterTestingHarness.create(`/politica-de-privacidade${suffix}`);
    harness.detectChanges();
    return ((harness.fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  beforeEach(() => {
    localStorage.clear();
    (window as unknown as { gtag: unknown }).gtag = vi.fn();
  });

  afterEach(() => {
    localStorage.clear();
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it('PT: nao afirma mais que nao usa cookies', async () => {
    const text = await visit('pt');

    expect(text).not.toContain('não usa cookies');
    expect(text).not.toContain('não temos Google Analytics');
  });

  it('PT: diz que usa GA4, que grava cookie e que depende de aceite', async () => {
    const text = await visit('pt');

    expect(text).toContain('Google Analytics 4');
    expect(text).toContain('cookie');
    expect(text).toContain('só é gravado se você aceitar');
  });

  it('PT: oferece caminho real de revogacao', async () => {
    const text = await visit('pt');

    expect(text).toContain('rever minha escolha de cookies');
  });

  /** O documento nao pode prometer menos do que o produto faz, nem mais. */
  it('PT: diz que revogar APAGA os cookies ja gravados', async () => {
    const text = await visit('pt');

    expect(text).toContain('apaga os cookies que o Google Analytics já tinha gravado');
  });

  it('EN: nao afirma mais que nao usa cookies', async () => {
    const text = await visit('en');

    expect(text).not.toContain('does not use cookies');
    expect(text).not.toContain('no Google Analytics,');
  });

  it('EN: diz que usa GA4, que grava cookie e que depende de aceite', async () => {
    const text = await visit('en');

    expect(text).toContain('Google Analytics 4');
    expect(text).toContain('cookie');
    expect(text).toContain('is only stored if you accept it');
  });

  it('EN: oferece caminho real de revogacao', async () => {
    const text = await visit('en');

    expect(text).toContain('review my cookie choice');
  });

  it('EN: diz que revogar APAGA os cookies ja gravados', async () => {
    const text = await visit('en');

    expect(text).toContain('deletes the cookies Google Analytics had already stored');
  });

  /** A revogacao tem de ACONTECER, nao so estar escrita. */
  it('o botao de revogar devolve o consentimento para indeciso', async () => {
    localStorage.setItem('analyticsConsent', 'granted');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'politica-de-privacidade', component: PrivacyPolicyComponent }]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        ConsentService,
      ],
    });
    const harness = await RouterTestingHarness.create('/politica-de-privacidade');
    harness.detectChanges();

    const button = (harness.fixture.nativeElement as HTMLElement).querySelector(
      '.legal-inline-button',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button!.click();

    expect(localStorage.getItem('analyticsConsent')).toBeNull();
    expect(TestBed.inject(ConsentService).undecided()).toBe(true);
  });

  /** Ponta a ponta pelo botao da propria politica: o cookie tem de sumir. */
  it('o botao da politica apaga o cookie do GA, provado relendo', async () => {
    document.cookie = '_ga=GA1.1.999; path=/';
    localStorage.setItem('analyticsConsent', 'granted');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'politica-de-privacidade', component: PrivacyPolicyComponent }]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        ConsentService,
      ],
    });
    const harness = await RouterTestingHarness.create('/politica-de-privacidade');
    harness.detectChanges();

    (
      (harness.fixture.nativeElement as HTMLElement).querySelector(
        '.legal-inline-button',
      ) as HTMLButtonElement
    ).click();

    expect(document.cookie).not.toContain('_ga=');
  });
});

/**
 * A secao 6 descreve o envio do contrato mascarado a Anthropic. Ela nao pode prometer mais
 * do que o produto faz: o mascarador NAO cobre nomes nem enderecos, e a Anthropic guarda
 * por ate 30 dias. Estes testes prendem as frases que, se sumirem, tornam a politica falsa.
 */
describe('PrivacyPolicyComponent — secao de IA (Ajustar o meu contrato)', () => {
  async function visit(lang: 'pt' | 'en'): Promise<string> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'politica-de-privacidade', component: PrivacyPolicyComponent }]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        ConsentService,
      ],
    });
    const suffix = lang === 'en' ? '?lang=en' : '';
    const harness = await RouterTestingHarness.create(`/politica-de-privacidade${suffix}`);
    harness.detectChanges();
    return ((harness.fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  it('PT: nomeia a Anthropic, a sede e a transferencia do art. 33', async () => {
    const text = await visit('pt');

    expect(text).toContain('Anthropic, PBC');
    expect(text).toContain('San Francisco');
    expect(text).toContain('art. 33 da LGPD');
  });

  it('PT: diz o que NAO e mascarado, o prazo de 30 dias e que nao treina', async () => {
    const text = await visit('pt');

    expect(text).toContain('Não são mascarados: nomes de pessoas');
    expect(text).toContain('30 dias');
    expect(text).toContain('não é usado para treinar modelos de IA');
  });

  it('PT: diz que o recurso e opcional e como revogar', async () => {
    const text = await visit('pt');

    expect(text).toContain('é opcional');
    expect(text).toContain('sem IA');
    expect(text).toContain('Descartar arquivo');
  });

  it('EN: nomeia a Anthropic, o que nao e mascarado e o prazo', async () => {
    const text = await visit('en');

    expect(text).toContain('Anthropic, PBC');
    expect(text).toContain('Not masked: names of people');
    expect(text).toContain('30 days');
    expect(text).toContain('is not used to train AI models');
    expect(text).toContain('LGPD art. 33');
  });

  it('alteracoes: aviso de mudanca material por e-mail OU video no Instagram, nas duas linguas', async () => {
    expect(await visit('pt')).toContain(
      'avisar por e-mail ou por vídeo de anúncio no Instagram da MyCarsHub',
    );
    expect(await visit('en')).toContain(
      'notify you by email or by an announcement video on the MyCarsHub Instagram',
    );
  });

  it('o indice das duas linguas lista a secao nova', async () => {
    expect(await visit('pt')).toContain('Análise de contrato com IA');
    expect(await visit('en')).toContain('Contract analysis with AI');
  });
});
