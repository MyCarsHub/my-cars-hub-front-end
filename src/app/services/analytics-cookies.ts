/**
 * Apagar cookie do GA4 e mais chato do que parece, e falha em SILENCIO.
 *
 * Um cookie so e removido quando o `document.cookie` de expiracao casa NOME +
 * DOMINIO + PATH com os quais ele foi gravado. O GA4 grava o `_ga` no eTLD+1
 * (`.mycarshub.app.br`), nao no host (`www.mycarshub.app.br`). Uma expiracao sem
 * o `domain` certo nao apaga nada, nao lanca erro, e um teste que so verifique
 * "a funcao foi chamada" passa feliz enquanto o cookie continua no navegador.
 *
 * Por isso este modulo e PURO e devolve as strings que serao atribuidas: da para
 * assertar a cobertura de dominio sem depender de um jar de cookies que o jsdom
 * nao consegue simular no dominio real. Quem escreve e le de volta e o
 * `ConsentService`.
 */

/** Prefixos que o GA4 grava. `_ga` e o cliente; `_ga_<container>` e a sessao. */
const GA_PREFIXES = ['_ga', '_gid', '_gat'] as const;

/** `true` para os cookies que o GA4 escreveu, e so para eles. */
export function isAnalyticsCookie(name: string): boolean {
  return GA_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}_`));
}

/**
 * Os dominios a tentar, do host para cima.
 *
 * Subir ate dois rotulos cobre `mycarshub.app.br` a partir de
 * `www.mycarshub.app.br`. Nao ha lista de sufixos publicos aqui de proposito:
 * tentar um dominio invalido (`.app.br`, que e sufixo publico) e inofensivo —
 * o navegador simplesmente ignora a atribuicao — enquanto NAO tentar o dominio
 * certo deixa o cookie vivo. O erro barato e o de tentar demais.
 */
export function domainVariants(hostname: string): readonly (string | null)[] {
  const variants: (string | null)[] = [null]; // host-only, sem atributo `domain`
  const labels = hostname.split('.');
  for (let i = 0; i <= labels.length - 2; i++) {
    const domain = labels.slice(i).join('.');
    variants.push(domain, `.${domain}`);
  }
  return variants;
}

/**
 * As atribuicoes de `document.cookie` que apagam `name` em todas as combinacoes
 * de dominio e path que importam. Devolve string, nao efeito, para o spec poder
 * conferir a cobertura.
 */
export function expiryAssignments(name: string, hostname: string, paths: readonly string[] = ['/']): string[] {
  const expired = 'Thu, 01 Jan 1970 00:00:00 GMT';
  const out: string[] = [];
  for (const path of paths) {
    for (const domain of domainVariants(hostname)) {
      const suffix = domain === null ? '' : `; domain=${domain}`;
      out.push(`${name}=; expires=${expired}; path=${path}${suffix}`);
    }
  }
  return out;
}

/** Nomes de cookie de analytics presentes num `document.cookie`. */
export function analyticsCookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(';')
    .map((pair) => pair.split('=')[0].trim())
    .filter((name) => name.length > 0 && isAnalyticsCookie(name));
}
