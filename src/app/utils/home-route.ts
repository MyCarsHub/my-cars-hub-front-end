/**
 * Onde cada papel "mora" depois de autenticado.
 *
 * FEAT-0108 — existe UM lugar que decide isso porque o app aponta para o
 * destino pós-login de cinco lugares diferentes (`login.ts`, `oauth-success.ts`
 * duas vezes, o `redirectTo` de `app.routes.ts` e o `roleGuard`). Todos podem
 * continuar apontando para `/dashboard`: o `roleGuard` do próprio `/dashboard`
 * desvia quem não pode estar lá para a casa do papel dele. Assim o destino do
 * motorista se decide AQUI, e não em cinco arquivos.
 *
 * `/dashboard` é 403 para um DRIVER desde o FIX-0360 (`/v1/dashboard/**` não
 * está na lista de permitidos), então mandá-lo para lá era garantir que a
 * primeira tela da vida dele no produto fosse um erro.
 */
export function homeRouteForRole(role: string | null | undefined): string {
  return role === 'DRIVER' ? '/alugueis' : '/dashboard';
}
