import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { NotificationService } from './notification.service';
import { roleGuard } from './role.guard';
import { SessionService } from './session.service';

/**
 * FIX-0363 — o papel que governa a rota vem do TOKEN, nao do espelho
 * `selectedRole` do sessionStorage.
 *
 * Isto NAO e a defesa real: quem adulterar o espelho ve a rota abrir e leva 403
 * do servidor, que nunca confiou nele. O ganho e coerencia (mesma fonte que o
 * backend) e fim do papel STALE depois de trocar de empresa.
 */
describe('roleGuard — papel vindo do token', () => {
  const encodePayload = (payload: Record<string, unknown>): string => {
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const buildToken = (payload: Record<string, unknown>): string =>
    `${encodePayload({ alg: 'HS256', typ: 'JWT' })}.${encodePayload(payload)}.sig`;

  /**
   * `url` importa desde o FIX-0387: a mensagem de negacao nomeia a AREA, e ela
   * sai de `state.url`. O default vazio preserva os testes de fonte do papel,
   * que nao falam de area nenhuma.
   */
  function run(allowed: string[], url = ''): boolean | UrlTree {
    const state = { url } as RouterStateSnapshot;
    return TestBed.runInInjectionContext(
      () => roleGuard(allowed)(null as never, state) as boolean | UrlTree,
    );
  }

  function denied(result: boolean | UrlTree): boolean {
    return result !== true;
  }

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [SessionService] });
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('deixa passar quando o TOKEN traz um papel permitido', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));
    expect(run(['OWNER', 'MANAGER'])).toBe(true);
  });

  it('nega quando o TOKEN traz um papel nao permitido', () => {
    sessionStorage.setItem('token', buildToken({ role: 'DRIVER' }));
    expect(denied(run(['OWNER', 'MANAGER']))).toBe(true);
  });

  /**
   * O DONE WHEN em uma linha: adulterar o espelho no DevTools nao muda mais o
   * acesso. Antes do FIX-0363 estes dois testes eram o contrario um do outro.
   */
  it('adulterar selectedRole NAO abre uma rota que o token nega', () => {
    sessionStorage.setItem('token', buildToken({ role: 'DRIVER' }));
    sessionStorage.setItem('selectedRole', 'OWNER');

    expect(denied(run(['OWNER']))).toBe(true);
  });

  it('adulterar selectedRole NAO fecha uma rota que o token permite', () => {
    sessionStorage.setItem('token', buildToken({ role: 'OWNER' }));
    sessionStorage.setItem('selectedRole', 'DRIVER');

    expect(run(['OWNER'])).toBe(true);
  });

  /** Fail-closed declarado: ausencia de papel NEGA, nao concede por omissao. */
  it('nega quando nao ha token', () => {
    expect(denied(run(['OWNER', 'MANAGER', 'DRIVER']))).toBe(true);
  });

  it('nega quando o token expirou, mesmo com o espelho intacto', () => {
    sessionStorage.setItem(
      'token',
      buildToken({ role: 'OWNER', exp: Math.floor(Date.now() / 1000) - 60 }),
    );
    sessionStorage.setItem('selectedRole', 'OWNER');

    expect(denied(run(['OWNER']))).toBe(true);
  });

  /**
   * Regressao de "ver como empresa": o token de impersonacao nao tem claim
   * `role`. Sem o ramo do claim `impersonation`, o admin em sessao de suporte
   * pararia de abrir as telas que foi ver.
   */
  it('mantem a sessao de impersonacao abrindo as rotas do cliente', () => {
    sessionStorage.setItem('token', buildToken({ impersonation: true, system_role: 'USER' }));

    expect(run(['OWNER'])).toBe(true);
    expect(run(['OWNER', 'MANAGER'])).toBe(true);
  });

  /**
   * FEAT-0106: a reemissao silenciosa grava um token NOVO. Como o papel e lido
   * do token a cada chamada, o guard enxerga o papel novo sem ninguem
   * reescrever o espelho — que era exatamente o que ficava stale antes.
   */
  it('enxerga o papel novo assim que o token e reemitido', () => {
    sessionStorage.setItem('token', buildToken({ role: 'DRIVER' }));
    expect(denied(run(['OWNER']))).toBe(true);

    sessionStorage.setItem('token', buildToken({ role: 'OWNER' }));
    expect(run(['OWNER'])).toBe(true);
  });
});

/**
 * FIX-0387 - o nav de `/billing` e `/configuracoes` ja e OWNER-only, entao o
 * MANAGER que chega la digitou a URL ou abriu um link salvo. Ate aqui o guard o
 * devolvia ao `/dashboard` em SILENCIO: nenhuma tela dizia o que era aquilo, de
 * quem era, nem o que fazer.
 *
 * O que estes testes prendem e a MENSAGEM, nao a permissao - a permissao e do
 * bloco de cima, e quem barra escrita de verdade e o backend.
 */
describe('roleGuard - mensagem de negacao (FIX-0387)', () => {
  const encodePayload = (payload: Record<string, unknown>): string => {
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const buildToken = (payload: Record<string, unknown>): string =>
    `${encodePayload({ alg: 'HS256', typ: 'JWT' })}.${encodePayload(payload)}.sig`;

  function run(allowed: string[], url: string): boolean | UrlTree {
    const state = { url } as RouterStateSnapshot;
    return TestBed.runInInjectionContext(
      () => roleGuard(allowed)(null as never, state) as boolean | UrlTree,
    );
  }

  function messages(): string[] {
    return TestBed.inject(NotificationService)
      .notifications()
      .map((n) => n.message);
  }

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [SessionService] });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('MANAGER em /billing recebe as TRES informacoes: area, dono e o que fazer', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));

    expect(run(['OWNER'], '/billing')).toBeInstanceOf(UrlTree);

    const [message] = messages();
    expect(message).toContain('Assinatura e cobran\u00e7a');
    expect(message).toContain('exclusiva do propriet\u00e1rio');
    expect(message).toContain('de gerente');
    expect(message).toContain('Fale com o propriet\u00e1rio');
  });

  it('nomeia o filho mais especifico, nao o pai', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));

    run(['OWNER'], '/configuracoes/integracoes/asaas');

    expect(messages()[0]).toContain('Integra\u00e7\u00e3o com o Asaas');
  });

  it('a negacao e um AVISO, e dura mais que o toast padrao de 5s', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));

    run(['OWNER'], '/configuracoes');

    const [toast] = TestBed.inject(NotificationService).notifications();
    expect(toast.kind).toBe('warning');
    expect(toast.duration).toBeGreaterThan(5000);
  });

  /*
   * FEAT-0108 — este teste usava um DRIVER para provar que a frase nomeia os
   * DOIS papeis. O DRIVER passou a ler mensagem PROPRIA (uma so notificacao por
   * evento de recusa), entao o invariante do FIX-0387 se prova com VIEWER, que e
   * o outro papel fora da rota. O caso do motorista esta especificado no bloco
   * 'FEAT-0108' no fim do arquivo. O que se afirma aqui e o que se afirmava
   * antes: a frase nomeia os dois donos da area.
   */
  it('rota de OWNER+MANAGER negada a outro papel nomeia os DOIS papeis', () => {
    sessionStorage.setItem('token', buildToken({ role: 'VIEWER' }));

    run(['OWNER', 'MANAGER'], '/veiculos');

    expect(messages()[0]).toContain('do propriet\u00e1rio ou do gerente');
  });

  /**
   * `/configuracoes` e seu filho '' carregam CADA UM um `roleGuard(['OWNER'])`.
   * Uma navegacao pode negar duas vezes, e sem deduplicacao o MANAGER leria o
   * mesmo paragrafo empilhado em dobro no celular.
   */
  it('pai e filho negando a mesma navegacao produzem UM toast, nao dois', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));

    run(['OWNER'], '/configuracoes');
    run(['OWNER'], '/configuracoes');

    expect(messages()).toHaveLength(1);
  });

  /**
   * Sem papel nao ha o que explicar em termos de permissao: e sessao ausente ou
   * expirada, e disso trata o `authGuard`. Dizer "seu acesso e de X" aqui seria
   * inventar o X.
   */
  it('sem token nao inventa papel: nega em silencio', () => {
    expect(run(['OWNER'], '/billing')).toBeInstanceOf(UrlTree);
    expect(messages()).toHaveLength(0);
  });

  it('token expirado tambem nega em silencio', () => {
    sessionStorage.setItem(
      'token',
      buildToken({ role: 'MANAGER', exp: Math.floor(Date.now() / 1000) - 60 }),
    );

    run(['OWNER'], '/billing');

    expect(messages()).toHaveLength(0);
  });

  it('quem PODE entrar nao recebe mensagem nenhuma', () => {
    sessionStorage.setItem('token', buildToken({ role: 'OWNER' }));

    expect(run(['OWNER'], '/billing')).toBe(true);
    expect(messages()).toHaveLength(0);
  });

  /**
   * Rota OWNER-only sem rotulo mapeado: a mensagem perde o NOME da area e
   * mantem dono e acao. O fallback nao pode virar frase quebrada.
   */
  it('area sem rotulo mapeado ainda explica dono e acao', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));

    run(['OWNER'], '/uma-rota-nova');

    const [message] = messages();
    expect(message).toMatch(/^\u00c1rea exclusiva do propriet\u00e1rio\./);
    expect(message).toContain('Fale com o propriet\u00e1rio');
  });

  /** Fronteira de segmento: `/billing-legado` nao pode herdar o rotulo. */
  it('o rotulo casa por segmento, nao por startsWith cru', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));

    run(['OWNER'], '/billing-legado');

    expect(messages()[0]).not.toContain('Assinatura');
  });

  /** Query string nao pode cegar o rotulo - links salvos costumam ter uma. */
  it('o rotulo sobrevive a query string', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));

    run(['OWNER'], '/billing?plano=pro');

    expect(messages()[0]).toContain('Assinatura e cobran\u00e7a');
  });
});

/**
 * FEAT-0108 — a casca do motorista, e o CONTRAPESO da decisao.
 *
 * Duas coisas foram decididas ao reparentar este trabalho sobre o develop, e as
 * duas sao testadas nos DOIS sentidos, porque um teste que so prova a metade
 * nova deixa a metade que ja estava certa sem guarda:
 *
 * 1. O DRIVER le mensagem PROPRIA, que nomeia o destino REAL. A do FIX-0387
 *    termina em "voce voltou ao painel" e o motorista NAO vai para o painel —
 *    reaproveitar aquele texto seria descrever errado o que aconteceu.
 * 2. UMA notificacao por evento de recusa. Combinar as duas mensagens nao daria
 *    mais informacao; daria ruido que faz nao ler nenhuma.
 *
 * E o que NAO pode mudar: OWNER e MANAGER continuam lendo a frase do FIX-0387
 * BYTE A BYTE, e continuam sendo mandados ao painel. O FIX-0387 esta em
 * producao e foi pedido pelo dono.
 */
describe('roleGuard - FEAT-0108: casca do motorista', () => {
  const encodePayload = (payload: Record<string, unknown>): string => {
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const buildToken = (payload: Record<string, unknown>): string =>
    `${encodePayload({ alg: 'HS256', typ: 'JWT' })}.${encodePayload(payload)}.sig`;

  function run(allowed: string[], url: string): boolean | UrlTree {
    const state = { url } as RouterStateSnapshot;
    return TestBed.runInInjectionContext(
      () => roleGuard(allowed)(null as never, state) as boolean | UrlTree,
    );
  }

  function messages(): string[] {
    return TestBed.inject(NotificationService)
      .notifications()
      .map((n) => n.message);
  }

  function target(result: boolean | UrlTree): string {
    return TestBed.inject(Router).serializeUrl(result as UrlTree);
  }

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [SessionService] });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('desvia o motorista recusado para a casa DELE, nao para o painel que o recusa', () => {
    sessionStorage.setItem('token', buildToken({ role: 'DRIVER' }));

    expect(target(run(['OWNER', 'MANAGER'], '/veiculos'))).toBe('/alugueis');
  });

  it('a mensagem do motorista nomeia o destino REAL, nao o painel', () => {
    sessionStorage.setItem('token', buildToken({ role: 'DRIVER' }));

    run(['OWNER', 'MANAGER'], '/veiculos');

    const [message] = messages();
    expect(message).toContain('os aluguéis');
    expect(message).not.toContain('painel');
  });

  /** O evento e um so: duas notificacoes seria o defeito, nao o dobro da ajuda. */
  it('o motorista recebe UMA notificacao, nao duas', () => {
    sessionStorage.setItem('token', buildToken({ role: 'DRIVER' }));

    run(['OWNER', 'MANAGER'], '/veiculos');

    expect(messages()).toHaveLength(1);
  });

  it('o motorista NAO recebe a frase do FIX-0387 junto da dele', () => {
    sessionStorage.setItem('token', buildToken({ role: 'DRIVER' }));

    run(['OWNER', 'MANAGER'], '/veiculos');

    expect(messages()[0]).not.toContain('Fale com o proprietário');
  });

  /*
   * O CONTRAPESO, e o teste mais importante deste bloco: a frase que OWNER e
   * MANAGER leem hoje em producao esta afirmada INTEIRA. Se um caractere dela
   * mudar — inclusive "voce voltou ao painel", que e o trecho que a decisao do
   * motorista deixou de reaproveitar — este teste fica vermelho.
   */
  it('a frase do MANAGER continua identica, caractere por caractere', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));

    run(['OWNER'], '/billing');

    expect(messages()[0]).toBe(
      'Assinatura e cobrança: área exclusiva do proprietário. ' +
        'Seu acesso nesta empresa é de gerente, por isso você voltou ao painel. ' +
        'Fale com o proprietário se precisar entrar.',
    );
  });

  it('OWNER e MANAGER continuam indo para o painel', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));

    expect(target(run(['OWNER'], '/billing'))).toBe('/dashboard');
  });

  it('a recusa do MANAGER continua avisando — a mensagem nao desapareceu', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));

    run(['OWNER'], '/billing');

    expect(messages()).toHaveLength(1);
  });

  it('o motorista entra onde o escopo dele alcanca', () => {
    sessionStorage.setItem('token', buildToken({ role: 'DRIVER' }));

    expect(run(['OWNER', 'MANAGER', 'DRIVER'], '/alugueis')).toBe(true);
    expect(messages()).toHaveLength(0);
  });
});
