/**
 * Inicialização do Google Analytics 4 (GA4).
 *
 * Este arquivo existe como script EXTERNO de mesma origem — e não como bloco
 * `<script>` inline no `index.html` — porque a CSP do site (`vercel.json`)
 * usa `script-src 'self' https://www.googletagmanager.com`, sem
 * `'unsafe-inline'` e sem pipeline de nonce. Um bloco inline seria inerte —
 * e foi exatamente isso que aconteceu em producao: o GA ficou meses sem
 * reportar nada porque o bootstrap vivia inline no `index.html`.
 *
 * NAO "conserte" isso com hash sha256 no lugar do arquivo: o hash muda com
 * qualquer edicao, inclusive espaco em branco, e o script volta a ficar inerte
 * em silencio na primeira vez que alguem editar sem recalcular.
 *
 * NÃO transformar em módulo/bundle: precisa continuar sendo um arquivo estático
 * servido na raiz do site (`/gtag-init.js`) para casar com `script-src 'self'`.
 *
 * Três invariantes que NÃO podem ser quebradas ao mexer aqui:
 *
 * 1. NENHUMA query string sai daqui. Rotas do app carregam credencial na URL
 *    (`/convite?token=` em `pages/invites/invite-accept.ts`, `?token=` legado em
 *    `pages/oauth-success/oauth-success.ts`). O default do GA4 é mandar
 *    `location.href` inteiro pro Google — por isso `send_page_view: false` +
 *    `page_view` manual com `page_location`/`page_referrer` já sanitizados.
 *    O `document.referrer` também é sanitizado: quem sai da tela de convite
 *    pra outra rota levaria o token no referrer.
 *
 * 2. Só o host de produção reporta. O measurement ID mora num asset de
 *    `public/`, fora do `fileReplacements` do `angular.json`, então sem esse
 *    gate `localhost:4200` e todo preview da Vercel sujariam a propriedade de
 *    produção. O loader do Google só é injetado depois do gate — fora de prod
 *    o navegador não fala com o Google nem uma vez.
 *
 * 3. Este arquivo NÃO tem hash no nome. O `vercel.json` serve `/gtag-init.js`
 *    com `no-cache, must-revalidate` de propósito (e o exclui da regra
 *    `immutable` de 1 ano dos demais `.js`). Não renomear nem "otimizar" isso.
 */
(function () {
  /*
   * MEDIDO na conta do dono: a propriedade MyCarsHub tem UM fluxo de dados,
   * para https://www.mycarshub.app.br, e o ID da metrica dele e este.
   *
   * O valor anterior deste arquivo (`G-BKLM44RJZY`) NAO e desta propriedade.
   * Commitado como estava, o GA passaria a "funcionar" mandando dados para uma
   * propriedade que ninguem olha — e o sintoma seria IDENTICO ao do bug que
   * este arquivo conserta: relatorio vazio. ID errado e ID bloqueado produzem
   * o mesmo relatorio vazio; so a causa muda. Conferir contra a conta antes de
   * trocar, nunca contra outro arquivo do repo.
   */
  var MEASUREMENT_ID = 'G-SW8RSDYTQN';

  /** Hosts que reportam. Preview da Vercel e localhost ficam de fora de propósito. */
  var PRODUCTION_HOSTS = ['mycarshub.app.br', 'www.mycarshub.app.br'];

  if (PRODUCTION_HOSTS.indexOf(window.location.hostname) === -1) {
    return;
  }

  /**
   * Devolve só `origin + pathname` — query string e fragmento são descartados.
   * Retorna `null` pra entrada vazia/inválida, pra nunca cair no caso em que
   * `new URL('', origin)` resolveria pro documento atual e mentiria o referrer.
   */
  function stripSensitiveParts(rawUrl) {
    if (!rawUrl) {
      return null;
    }
    try {
      var parsed = new URL(rawUrl, window.location.origin);
      return parsed.origin + parsed.pathname;
    } catch (error) {
      return null;
    }
  }

  var pageLocation = stripSensitiveParts(window.location.href);
  var pageReferrer = stripSensitiveParts(document.referrer);

  /**
   * Params no `config` viram default de TODO evento desse measurement ID —
   * inclusive de eventos que a gente não dispara explicitamente. Sanitizar aqui
   * é a rede de segurança; o `page_view` manual abaixo é o caso principal.
   */
  var params = { send_page_view: false };
  if (pageLocation) {
    params.page_location = pageLocation;
  }
  if (pageReferrer) {
    params.page_referrer = pageReferrer;
  }

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  /*
   * CONSENTIMENTO NEGADO POR PADRAO — e tem de ser a PRIMEIRA coisa na fila.
   *
   * O `ConsentService` so faz `consent`/`update`; ele depende de alguem ter
   * posto o default como `denied` ANTES de o loader do Google rodar. Sem isto o
   * GA4 assume `granted` e grava cookie antes de a pessoa decidir, o que
   * contraria a frase do proprio servico: "denied por padrao, nao grava NADA
   * ate alguem decidir".
   *
   * Isto veio do bloco inline do `index.html`, que tinha o default certo e era
   * INERTE pela CSP. O conserto e a uniao dos dois: a sanitizacao de URL deste
   * arquivo mais o default de consentimento daquele. Adotar so um deles trocava
   * um defeito por outro.
   *
   * `wait_for_update` da meia tarde para a decisao salva chegar antes do
   * primeiro envio, em vez de mandar um hit sem consentimento e corrigir depois.
   */
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500
  });

  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID, params);
  gtag('event', 'page_view', params);

  /**
   * Loader injetado só aqui (depois do gate). Fica DEPOIS dos comandos acima de
   * propósito: `gtag/js` é `async` e processa o `dataLayer` que já estiver na
   * fila quando carregar — é o mesmo contrato do snippet oficial, onde o
   * `config` também roda antes do loader terminar de baixar.
   */
  var loader = document.createElement('script');
  loader.async = true;
  loader.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(loader);
})();
