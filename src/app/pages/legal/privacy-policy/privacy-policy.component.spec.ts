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
 * do que o produto faz: desde 17/11 o mascarador cobre nomes e enderecos QUANDO os identifica,
 * mas um nome sem rotulo nem documento ao lado pode passar; e a Anthropic guarda por ate 30 dias. Estes testes prendem as frases que, se sumirem, tornam a politica falsa.
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

    expect(text).toContain('mascara, quando os identifica, os nomes de pessoas e de empresas, os endereços');
    expect(text).toContain(
      'Limite do mascaramento: um nome escrito sem rótulo nem documento ao lado pode não ser reconhecido e ir em claro',
    );
    expect(text).not.toContain('Não são mascarados: nomes de pessoas');
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
    expect(text).toContain('masks, when it identifies them, names of people and companies');
    expect(text).toContain(
      'Masking limit: a name written without a label or a document next to it may not be recognized',
    );
    expect(text).not.toContain('Not masked: names of people');
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

/**
 * Captura de acessos por hora (admin home v2, B10): a política tem de dizer o que é guardado, o
 * que NÃO é, quem vê e o prazo. Se a frase sumir, a captura passa a não ter aviso.
 */
describe('PrivacyPolicyComponent — uso da plataforma (acessos por hora)', () => {
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

  it('PT: contagem sem IP; ações com IP em código e aparelho; visto por conta; os dois prazos', async () => {
    const text = await visit('pt');
    expect(text).toContain('2.5 Uso da plataforma');
    expect(text).toContain('identificador interno do usuário, a hora e quantos minutos');
    // O "sem IP" vale só para a contagem por hora: o registro de ações guarda IP em código e aparelho.
    expect(text).toContain('Nela não guardamos endereço IP');
    expect(text).not.toContain('Não guardamos endereço IP');
    expect(text).toContain('código calculado a partir do endereço IP');
    expect(text).toContain('tipo de aparelho e navegador');
    // Os tops nomeados existem: a política não pode dizer "só agregados".
    expect(text).toContain('vê esses dados por conta e por empresa (quem usou, quanto e em que horas)');
    expect(text).not.toContain('só aparecem, agregados');
    expect(text).toContain('apagada automaticamente 90 dias depois; o registro de ações, depois de 2 anos');
    expect(text).toContain('A contagem de acessos por hora (seção 2.5) é apagada automaticamente após 90 dias, e o registro de ações, após 2 anos');
  });

  it('EN: the same promises', async () => {
    const text = await visit('en');
    expect(text).toContain('2.5 Platform usage');
    expect(text).toContain('It does not keep the IP address');
    expect(text).not.toContain('We do not keep the IP address');
    expect(text).toContain('code computed from the IP address');
    expect(text).toContain('per account and per company (who used it, how much and at what hours)');
    expect(text).not.toContain('shown, aggregated');
    expect(text).toContain('deleted automatically after 90 days; the action log, after 2 years');
    expect(text).toContain('and the action log after 2 years');
  });
});
