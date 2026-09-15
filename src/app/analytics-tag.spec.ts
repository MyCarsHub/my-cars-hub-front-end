import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A tag do GA4 mora em `src/index.html` porque precisa estar no HTML
 * prerenderizado, antes de o Angular subir. Isso a poe fora do alcance de
 * qualquer teste de componente — e uma tag de analytics sem teste e exatamente o
 * tipo de coisa que entra com o consentimento errado e ninguem percebe.
 *
 * Por isso este spec le o ARQUIVO, e nao um componente. O que ele prende e a
 * unica propriedade que torna a instalacao compativel com o que a politica de
 * privacidade passou a afirmar: a tag sobe NEGADA.
 */
describe('tag do GA4 em src/index.html', () => {
  const indexHtml = readFileSync('src/index.html', 'utf8');
  const consentDefault = indexHtml.indexOf("gtag('consent', 'default'");
  const config = indexHtml.indexOf("gtag('config'");

  it('esta instalada com o measurement id do produto', () => {
    expect(indexHtml).toContain('G-SW8RSDYTQN');
    expect(indexHtml).toContain('https://www.googletagmanager.com/gtag/js?id=G-SW8RSDYTQN');
  });

  it('sobe com o consentimento NEGADO, para analytics e para publicidade', () => {
    expect(indexHtml).toContain("analytics_storage: 'denied'");
    expect(indexHtml).toContain("ad_storage: 'denied'");
    expect(indexHtml).toContain("ad_user_data: 'denied'");
    expect(indexHtml).toContain("ad_personalization: 'denied'");
  });

  /**
   * A ORDEM E O PONTO. Um `consent default` depois do `config` chega tarde — a tag
   * ja teria decidido gravar. Este teste e o que impede alguem de reordenar os
   * scripts e ligar a coleta sem perceber.
   */
  it('o consent default vem ANTES do config', () => {
    expect(consentDefault).toBeGreaterThan(-1);
    expect(config).toBeGreaterThan(-1);
    expect(consentDefault).toBeLessThan(config);
  });

  it('nao existe nenhum granted escrito no HTML', () => {
    expect(indexHtml).not.toContain("'granted'");
  });

  /**
   * Fora do `<app-root>`: a tag nao participa da hidratacao. A ancora e `</head>`
   * e nao `<app-root>` porque o proprio comentario da tag menciona `<app-root>` no
   * texto — buscar pela string casava com o comentario e o teste media outra coisa.
   */
  it('fica dentro do head', () => {
    expect(indexHtml.indexOf('G-SW8RSDYTQN')).toBeLessThan(indexHtml.indexOf('</head>'));
    expect(indexHtml.indexOf('G-SW8RSDYTQN')).toBeLessThan(indexHtml.indexOf('<body>'));
  });
});
