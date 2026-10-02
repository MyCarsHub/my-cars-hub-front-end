import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * O BOOTSTRAP DO GA4 — `public/gtag-init.js`.
 *
 * ## Por que este spec le um arquivo do disco
 *
 * O bootstrap NAO entra no bundle: e asset estatico servido em
 * `/gtag-init.js`, porque a CSP de producao usa `script-src` sem
 * `'unsafe-inline'`. Enquanto ele foi um bloco inline no `index.html`, era
 * INERTE — `window.gtag` ficava `undefined`, `dataLayer` nem existia, e o GA
 * passou meses sem receber um hit com a tag aparentemente instalada.
 *
 * Um arquivo que ninguem importa tambem e um arquivo que nenhum teste alcanca,
 * e foi assim que o defeito sobreviveu. Entao este spec le o arquivo REAL e o
 * executa — mesma tecnica de `services/seo-origin.spec.ts`, que confere
 * `robots.txt` e `sitemap.xml` em disco. Testar uma copia do codigo aqui
 * provaria a copia.
 *
 * ## O que esta preso aqui
 *
 * 1. Consentimento NEGADO por padrao, e ANTES de tudo. Sem isso o GA4 assume
 *    `granted` e grava cookie antes de a pessoa decidir.
 * 2. NENHUMA query string sai para o Google. Rotas do produto carregam
 *    credencial na URL (`?token=` do convite e do oauth-success); o default do
 *    GA4 e mandar `location.href` inteiro.
 * 3. So host de producao reporta — localhost e preview nao sujam a propriedade.
 * 4. O measurement ID e o da propriedade real. ID errado produz o MESMO
 *    sintoma de ID bloqueado: relatorio vazio.
 */
describe('public/gtag-init.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'public/gtag-init.js'), 'utf8');

  interface FakeWindow {
    location: { hostname: string; href: string; origin: string };
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }

  let win: FakeWindow;
  let doc: { referrer: string; head: { appendChild: (n: unknown) => void }; createElement: (t: string) => Record<string, unknown> };
  let appended: Array<Record<string, unknown>>;

  /** Roda o arquivo REAL com um `window`/`document` controlados. */
  function run(hostname: string, href: string, referrer = ''): void {
    appended = [];
    win = {
      location: { hostname, href, origin: `https://${hostname}` },
    };
    doc = {
      referrer,
      createElement: () => ({}) as Record<string, unknown>,
      head: { appendChild: (node: unknown) => appended.push(node as Record<string, unknown>) },
    };
    // `URL` real: a sanitizacao depende do parser do ambiente, nao de regex.
    new Function('window', 'document', 'URL', source)(win, doc, URL);
  }

  const entries = () => (win.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));

  beforeEach(() => {
    appended = [];
  });

  describe('gate de host', () => {
    it('NAO reporta de localhost', () => {
      run('localhost', 'http://localhost:4200/dashboard');

      expect(win.dataLayer).toBeUndefined();
      expect(appended).toEqual([]);
    });

    it('NAO reporta de preview da Vercel', () => {
      run('my-cars-hub-front-end-git-abc.vercel.app', 'https://my-cars-hub-front-end-git-abc.vercel.app/');

      expect(win.dataLayer).toBeUndefined();
      expect(appended).toEqual([]);
    });

    it('reporta dos dois hosts de producao', () => {
      for (const host of ['mycarshub.app.br', 'www.mycarshub.app.br']) {
        run(host, `https://${host}/`);
        expect(win.dataLayer, host).toBeDefined();
      }
    });
  });

  describe('consentimento', () => {
    it('a PRIMEIRA entrada da fila e o consent default, e ele e NEGADO', () => {
      run('www.mycarshub.app.br', 'https://www.mycarshub.app.br/');

      const first = entries()[0];
      expect(first[0]).toBe('consent');
      expect(first[1]).toBe('default');
      expect(first[2]).toMatchObject({
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      });
    });

    /**
     * Ordem importa: o `config` depois do default significa que a tag nasce
     * sem permissao. Invertido, ela gravaria cookie antes da decisao.
     */
    it('o consent default vem ANTES de qualquer config', () => {
      run('www.mycarshub.app.br', 'https://www.mycarshub.app.br/');

      const kinds = entries().map((e) => String(e[0]));
      // Os dois PRECISAM existir antes de comparar posicao: com `consent`
      // ausente, `indexOf` devolve -1 e "-1 < 1" passaria a vazio — o teste
      // aprovaria justamente a ausencia que ele existe para proibir.
      expect(kinds, 'consent default sumiu da fila').toContain('consent');
      expect(kinds, 'config sumiu da fila').toContain('config');
      expect(kinds.indexOf('consent')).toBeLessThan(kinds.indexOf('config'));
    });
  });

  describe('nenhuma credencial vai para o Google', () => {
    const tokenUrl = 'https://www.mycarshub.app.br/convite?token=SEGREDO123';

    it('a URL enviada perde a query string', () => {
      run('www.mycarshub.app.br', tokenUrl);

      const serialized = JSON.stringify(entries());
      expect(serialized).not.toContain('SEGREDO123');
      expect(serialized).not.toContain('token');
    });

    it('page_location fica so com origem e caminho', () => {
      run('www.mycarshub.app.br', tokenUrl);

      const config = entries().find((e) => e[0] === 'config');
      expect((config?.[2] as { page_location?: string })?.page_location).toBe(
        'https://www.mycarshub.app.br/convite',
      );
    });

    it('o REFERRER tambem e sanitizado — sair do convite levaria o token', () => {
      run('www.mycarshub.app.br', 'https://www.mycarshub.app.br/dashboard', tokenUrl);

      const serialized = JSON.stringify(entries());
      expect(serialized).not.toContain('SEGREDO123');
    });

    it('nao manda page_view automatico — o default mandaria a href inteira', () => {
      run('www.mycarshub.app.br', tokenUrl);

      const config = entries().find((e) => e[0] === 'config');
      expect((config?.[2] as { send_page_view?: boolean })?.send_page_view).toBe(false);
    });
  });

  describe('medicao vai para a propriedade certa', () => {
    /**
     * Medido na conta do dono: a propriedade MyCarsHub tem UM fluxo de dados e
     * este e o ID dele. ID errado produz relatorio vazio — o MESMO sintoma de
     * ID bloqueado por CSP, com a causa ja consertada. Por isso esta preso.
     */
    it('usa o measurement ID da propriedade real', () => {
      run('www.mycarshub.app.br', 'https://www.mycarshub.app.br/');

      const config = entries().find((e) => e[0] === 'config');
      expect(config?.[1]).toBe('G-SW8RSDYTQN');
    });

    it('injeta o loader do googletagmanager com o mesmo ID', () => {
      run('www.mycarshub.app.br', 'https://www.mycarshub.app.br/');

      expect(appended.length).toBe(1);
      expect(String(appended[0]['src'])).toContain('googletagmanager.com/gtag/js');
      expect(String(appended[0]['src'])).toContain('G-SW8RSDYTQN');
      expect(appended[0]['async']).toBe(true);
    });

    /** O loader vem DEPOIS dos comandos: a fila tem de existir quando ele carregar. */
    it('a fila ja esta montada quando o loader e injetado', () => {
      run('www.mycarshub.app.br', 'https://www.mycarshub.app.br/');

      expect(entries().length).toBeGreaterThanOrEqual(3);
    });
  });
});
