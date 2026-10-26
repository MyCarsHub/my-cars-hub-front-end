/**
 * Onde o tema do usuário vale. Fora do app autenticado (landing, blog, páginas legais,
 * login, convite público...) o tema é SEMPRE claro; só dentro do `AppShell` vale a
 * preferência salva (Claro/Escuro/Automático).
 *
 * `public/theme-init.js` repete esta lista (é um asset estático, sem import) para decidir
 * antes da primeira pintura; `theme-init.spec.ts` roda o script contra cada caminho daqui
 * e falha se as duas listas divergirem.
 */
export const PUBLIC_PATH_PREFIXES: readonly string[] = [
  '/login',
  '/signup',
  '/oauth-success',
  '/invite',
  '/convite',
  '/blog',
  '/politica-de-privacidade',
  '/termos-de-uso',
  '/manutencao',
  '/status',
];

/** `true` para a landing (`/`) e para qualquer rota pública conhecida. */
export function isPublicPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '') return true;
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
