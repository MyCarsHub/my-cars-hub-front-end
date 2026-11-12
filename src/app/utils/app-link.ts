/**
 * Endereços em que o próprio app é servido. Um link de novidade gravado como endereço completo
 * de um deles (ex.: `https://www.mycarshub.app.br/ajustes`) é uma página do app: abrir em outra
 * aba perde a sessão (ela vive no `sessionStorage` da aba) e manda a pessoa para o login.
 */
export const OWN_APP_HOSTS: readonly string[] = ['mycarshub.app.br', 'www.mycarshub.app.br'];

/**
 * - `internal`: rota do app (`/algo`), navegada na mesma aba pelo Router.
 * - `external`: `https://` de outro endereço, aberto em outra aba.
 * - `null`: qualquer outra coisa (`//host`, `http:`, `javascript:`, vazio) — não vira link.
 */
export type AppLink = { kind: 'internal'; path: string } | { kind: 'external'; href: string } | null;

/** Rota do app: começa com `/`, nunca `//host` nem `/\host` (o navegador lê os dois como outro endereço). */
function isAppPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

/**
 * Classifica o link de um aviso/novidade. `currentHost` é o `location.host` da aba (cobre
 * homologação e localhost); os endereços de `OWN_APP_HOSTS` valem sempre.
 */
export function classifyAppLink(raw: string | null | undefined, currentHost?: string | null): AppLink {
  const value = (raw ?? '').trim();
  if (!value) return null;
  if (value.startsWith('/')) return isAppPath(value) ? { kind: 'internal', path: value } : null;
  if (!/^https:\/\//i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.host.toLowerCase();
  const own = OWN_APP_HOSTS.includes(host) || (!!currentHost && host === currentHost.toLowerCase());
  if (!own) return { kind: 'external', href: value };
  const path = `${url.pathname}${url.search}${url.hash}`;
  return isAppPath(path) ? { kind: 'internal', path } : null;
}

/**
 * Para gravar: endereço completo do próprio app vira a rota (`/ajustes`); o resto fica como
 * veio (a validação do formulário e do servidor decide o que é aceito).
 */
export function toStoredAppLink(raw: string, currentHost?: string | null): string {
  const link = classifyAppLink(raw, currentHost);
  return link?.kind === 'internal' ? link.path : raw;
}
