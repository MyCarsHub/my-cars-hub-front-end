import { HttpContextToken } from '@angular/common/http';

/**
 * Constantes da recusa `DRIVER_IDENTITY_NOT_RESOLVED` (backend PR #170).
 *
 * Mora num arquivo sem dependências pelo mesmo motivo de
 * `impersonation.context.ts`: o `errorInterceptor` precisa do token de contexto,
 * e importar o serviço que o usa fecharia um ciclo (serviço → HttpClient →
 * interceptor → serviço).
 */

/**
 * Código que o backend devolve com status 403 quando o access token do MOTORISTA
 * não carrega o claim `driverId`.
 *
 * É um 403 que NÃO significa "você não pode" — significa "seu token está
 * incompleto, pegue um novo". O status não distingue os dois casos, só o `code`:
 * a decisão de manter 403 em vez de 401 foi tomada no backend de propósito, para
 * não entregar ao chamador um oráculo separando "nunca emiti esse token" de
 * "você mexeu no token". Quem se adapta é o frontend.
 *
 * Todo token DRIVER emitido ANTES do PR #170 está nessa situação, e nenhum deles
 * se conserta sozinho: sem este tratamento a sessão do motorista trava até o
 * token expirar ou a pessoa deslogar na mão.
 */
export const DRIVER_IDENTITY_ERROR_CODE = 'DRIVER_IDENTITY_NOT_RESOLVED';

/**
 * Marca a requisição que JÁ foi reenviada com um token reemitido.
 *
 * Sem ela, um token que volta incompleto uma segunda vez faria o par
 * 403 → reemitir → 403 girar para sempre. Com ela, a segunda recusa cai no
 * caminho duro: limpar a sessão e mandar para o `/login`.
 */
export const DRIVER_IDENTITY_RETRIED = new HttpContextToken<boolean>(() => false);

/** Aviso único do caminho duro — quando a reemissão silenciosa não resolveu. */
export const DRIVER_IDENTITY_REAUTH_MESSAGE =
  'Sua sessão precisa ser renovada. Faça login novamente para continuar.';
