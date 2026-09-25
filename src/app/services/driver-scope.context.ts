/**
 * Constantes da recusa `DRIVER_SCOPE_FORBIDDEN` (backend FIX-0360,
 * `DriverReadScopePolicy`).
 *
 * Mora num arquivo sem dependências pelo mesmo motivo de
 * `driver-identity.context.ts` e `impersonation.context.ts`: o
 * `errorInterceptor` precisa da constante, e importar o serviço que a usa
 * fecharia um ciclo (serviço → HttpClient → interceptor → serviço).
 *
 * ## Irmão de `DRIVER_IDENTITY_NOT_RESOLVED`, e o OPOSTO dele
 *
 * Os dois são 403 de motorista e só o `code` os separa, mas a resposta certa a
 * cada um é contrária:
 *
 * - `DRIVER_IDENTITY_NOT_RESOLVED` = "sua credencial está incompleta" → o
 *   frontend RECUPERA: reemite o token e reenvia a requisição em silêncio.
 * - `DRIVER_SCOPE_FORBIDDEN` (aqui) = "esta área não é sua" → NÃO há o que
 *   recuperar. O token está perfeito; a área é que não é dele. Reemitir aqui
 *   seria laço e ruído, porque o token novo levaria à mesma recusa.
 *
 * A resposta certa é NÃO OFERECER A ÁREA: quem impede o motorista de chegar
 * aqui é o registry de navegação (`NAV_ITEMS`) e o `roleGuard`. Este código é a
 * última linha — deep-link, link salvo, redirect antigo — e também cobre a
 * chamada de enriquecimento que uma tela permitida faz a um endpoint proibido
 * (os filtros de `/alugueis` pedem veículos e motoristas, que o motorista não
 * alcança). Nesse segundo caso o certo é silêncio: a tela já degrada sozinha e
 * um toast acusaria o usuário de um erro que não é dele e que ele não pode
 * resolver.
 */
export const DRIVER_SCOPE_ERROR_CODE = 'DRIVER_SCOPE_FORBIDDEN';

/** Mensagem do backend, repetida aqui para o desvio de rota do `roleGuard`. */
export const DRIVER_SCOPE_MESSAGE = 'Seu acesso de motorista não inclui esta área.';
