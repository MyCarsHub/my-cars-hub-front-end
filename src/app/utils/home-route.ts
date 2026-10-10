/**
 * Onde cada papel "mora" depois de autenticado.
 *
 * FEAT-0108 — existe UM lugar que decide isso porque o app aponta para o
 * destino pós-login de vários lugares (`login.ts`, `oauth-success.ts`, o
 * `redirectTo` de `app.routes.ts`, o aceite de convite, o `roleGuard`). Todos
 * passam por aqui, ou continuam apontando para `/dashboard`, cujo `roleGuard`
 * desvia quem não pode estar lá para a casa do papel dele. O destino do
 * motorista se decide AQUI, e não em cada arquivo.
 *
 * `/dashboard` é 403 para um DRIVER desde o FIX-0360 (`/v1/dashboard/**` não
 * está na lista de permitidos), então mandá-lo para lá era garantir que a
 * primeira tela da vida dele no produto fosse um erro.
 *
 * A casa do motorista é `/meu-painel`: o painel PRÓPRIO dele (ganhos e custos que
 * ele registra). Ela substituiu `/alugueis`, que continua alcançável pelo menu —
 * era a única área que o escopo dele liberava, e por isso a casa por falta de
 * opção, não por ser o que ele abre o app para ver.
 */
export function homeRouteForRole(role: string | null | undefined): string {
  return role === 'DRIVER' ? '/meu-painel' : '/dashboard';
}
