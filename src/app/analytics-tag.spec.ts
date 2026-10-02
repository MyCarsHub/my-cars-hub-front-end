import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * COMO a tag do GA4 esta instalada no `src/index.html`.
 *
 * ## O que a versao anterior deste arquivo provava, e por que nao bastou
 *
 * Ela lia o `index.html` e conferia, com cuidado, que o `consent default`
 * NEGADO vinha antes do `config` e que o measurement id era o do produto.
 * Tudo isso era verdade no TEXTO — e o GA nunca recebeu um unico hit em
 * producao, porque o bloco era inline e a CSP (`script-src` sem
 * `'unsafe-inline'`) o tornava inerte. `window.gtag` ficava `undefined` e
 * `dataLayer` nem chegava a existir.
 *
 * Um spec minucioso, verde o tempo todo, medindo a coisa errada: ele provava
 * a ORDEM DO TEXTO, nunca que o texto chegava a executar. Nenhum teste de
 * conteudo de arquivo consegue provar execucao — e e por isso que o
 * comportamento agora mora em `gtag-init.spec.ts`, que executa o bootstrap de
 * verdade.
 *
 * O que SOBRA para este arquivo e a unica coisa que so o HTML pode garantir:
 * que o bootstrap continua EXTERNO e same-origin, e que ninguem o trouxe de
 * volta para inline.
 */
describe('instalacao do GA4 em src/index.html', () => {
  const indexHtml = readFileSync('src/index.html', 'utf8');
  /** Só a marcação, sem comentários: o texto dos comentários cita o que o código não faz. */
  const markup = indexHtml.replace(/<!--[\s\S]*?-->/g, '');

  it('carrega o bootstrap de um arquivo de MESMA ORIGEM', () => {
    expect(markup).toContain('<script src="/gtag-init.js"></script>');
  });

  /**
   * A REGRESSAO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR.
   *
   * Qualquer `gtag(` inline aqui volta a ser codigo morto sob a CSP, e o
   * sintoma e invisivel: a tag aparece no HTML, o relatorio fica vazio, e
   * ninguem liga uma coisa a outra por meses.
   */
  it('NAO tem nenhuma chamada gtag inline — inline e inerte sob a CSP', () => {
    expect(markup).not.toMatch(/gtag\s*\(/);
    expect(markup).not.toContain('dataLayer');
  });

  it('NAO carrega o googletagmanager direto do HTML', () => {
    // O loader e injetado por `gtag-init.js`, DEPOIS do gate de host de
    // producao. No HTML, ele dispararia tambem em preview e sujaria a
    // propriedade real.
    expect(markup).not.toMatch(/<script[^>]*googletagmanager/);
  });

  /**
   * SINCRONO de proposito: sem `async`/`defer`, para a fila do `dataLayer` e o
   * `consent default` existirem antes de qualquer coisa do Google rodar.
   */
  it('o bootstrap e sincrono', () => {
    const tag = markup.match(/<script[^>]*gtag-init\.js[^>]*>/)?.[0] ?? '';
    expect(tag).not.toContain('async');
    expect(tag).not.toContain('defer');
  });

  it('fica dentro do head', () => {
    const at = markup.indexOf('/gtag-init.js');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(markup.indexOf('</head>'));
  });

  it('nenhum granted escrito no HTML', () => {
    expect(markup).not.toContain("'granted'");
  });
});

/**
 * A CSP e metade do defeito, entao ela tambem fica presa.
 *
 * O bootstrap so executa porque e same-origin (`script-src 'self'`), e o hit so
 * sai porque os destinos do GA estao liberados. Cada um desses foi MEDIDO em
 * producao pelos relatorios de violacao da propria CSP — nao copiado de lista.
 */
describe('CSP de producao em vercel.json', () => {
  const csp = (JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    headers: Array<{ headers: Array<{ key: string; value: string }> }>;
  }).headers
    .flatMap((h) => h.headers)
    .find((h) => h.key === 'Content-Security-Policy')?.value;

  const directive = (name: string): string =>
    (csp ?? '').split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

  it('a CSP existe', () => {
    expect(csp).toBeDefined();
  });

  /**
   * NAO ACRESCENTE `'unsafe-inline'` AQUI. Seria o conserto rapido do GA e
   * abriria XSS inline no site inteiro — trocar um defeito de medicao por um
   * buraco de seguranca. O bootstrap externo existe exatamente para nao
   * precisar disso.
   */
  it('script-src NAO tem unsafe-inline', () => {
    expect(directive('script-src')).not.toContain('unsafe-inline');
  });

  it('script-src permite o loader do googletagmanager', () => {
    expect(directive('script-src')).toContain('https://www.googletagmanager.com');
  });

  it('connect-src permite a coleta do GA', () => {
    expect(directive('connect-src')).toContain('https://*.google-analytics.com');
  });

  it('img-src permite o pixel de fallback do GA', () => {
    expect(directive('img-src')).toContain('https://*.google-analytics.com');
  });

  /**
   * `/gtag-init.js` nao tem hash no nome e cai na regra `immutable` de 1 ano
   * dos demais `.js`. Sem esta excecao, um defeito nele fica incorrigivel por
   * um ano nos navegadores que ja o buscaram — e bootstrap de analytics e
   * justamente onde se descobre defeito tarde.
   */
  it('/gtag-init.js tem excecao de cache, e ela vem DEPOIS da regra immutable', () => {
    const rules = (JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    }).headers;

    const immutableAt = rules.findIndex((r) =>
      r.headers.some((h) => h.value.includes('immutable')),
    );
    const gtagAt = rules.findIndex((r) => r.source === '/gtag-init.js');

    expect(gtagAt, 'excecao de cache do /gtag-init.js sumiu').toBeGreaterThan(-1);
    expect(rules[gtagAt].headers[0].value).toContain('no-cache');
    expect(gtagAt, 'a excecao precisa vir depois da regra immutable').toBeGreaterThan(
      immutableAt,
    );
  });
});
