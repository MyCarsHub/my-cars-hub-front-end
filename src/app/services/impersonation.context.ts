import { HttpContextToken } from '@angular/common/http';

/**
 * Constantes compartilhadas entre `authInterceptor`, `impersonationInterceptor`,
 * `errorInterceptor` e `ImpersonationService`.
 *
 * Moram num arquivo sem dependências de propósito: o `authInterceptor` precisa
 * da chave do token administrativo, mas importar o `ImpersonationService` de
 * dentro dele criaria um ciclo (serviço → HttpClient → interceptor → serviço).
 */

/**
 * Marca a requisição que deve viajar com o token ADMINISTRATIVO mesmo durante
 * uma sessão de impersonação.
 *
 * Existe por uma exigência do backend: `DELETE /v1/admin/impersonation/{id}`
 * mora sob `/v1/admin/**`, que um token de impersonação nunca alcança
 * (`ImpersonationAccessPolicy.isDeniedPath`). Encerrar a sessão é ato da
 * credencial que a criou — por isso as duas credenciais coexistem enquanto a
 * sessão dura.
 */
export const USE_ADMIN_TOKEN = new HttpContextToken<boolean>(() => false);

/** Chave de `sessionStorage` onde o token administrativo fica guardado. */
export const IMPERSONATION_ADMIN_TOKEN_KEY = 'impersonationAdminToken';

/** Chave de `sessionStorage` com o estado da sessão (`ImpersonationState`). */
export const IMPERSONATION_STATE_KEY = 'impersonation';

/** Chave de `sessionStorage` com o contexto do admin congelado (`ImpersonationAdminContext`). */
export const IMPERSONATION_ADMIN_CONTEXT_KEY = 'impersonationAdminContext';

/**
 * Mensagem única para toda recusa de escrita durante a sessão — tanto o bloqueio
 * local (antes de sair do browser) quanto o 403 do servidor. O admin precisa
 * entender que foi a sessão somente-leitura que barrou, não que o sistema
 * quebrou.
 */
export const IMPERSONATION_READ_ONLY_MESSAGE =
  'Sessão somente leitura: nenhuma alteração é permitida enquanto você estiver vendo como esta empresa.';

/** Códigos que o backend devolve nas recusas ligadas a impersonação. */
export const IMPERSONATION_ERROR_CODES = {
  readOnly: 'IMPERSONATION_READ_ONLY',
  forbiddenPath: 'IMPERSONATION_FORBIDDEN_PATH',
  invalidToken: 'IMPERSONATION_INVALID_TOKEN',
  sessionEnded: 'IMPERSONATION_SESSION_ENDED',
} as const;

/**
 * Claim booleano que o backend crava no token de impersonação
 * (`ImpersonationAccessPolicy.CLAIM_IMPERSONATION`).
 *
 * FIX-0363 — é o marcador CONFIÁVEL da sessão de suporte, e o único possível:
 * o token de impersonação NÃO carrega o claim `role` (provado em
 * `TokenServiceImpersonationTest`: "role is missing") e ainda rebaixa
 * `system_role` para USER. Quem derivar o papel do token precisa reconhecer
 * este caso, ou a sessão "ver como empresa" para de abrir qualquer rota.
 */
export const IMPERSONATION_CLAIM = 'impersonation';

/**
 * Papel efetivo durante a impersonação.
 *
 * Mora aqui, e não no `impersonation.service`, porque o `session.service`
 * precisa dele para resolver o papel do token e não pode importar o serviço
 * (o serviço importa o session — fecharia ciclo). Este arquivo é folha,
 * sem dependências, exatamente para isso.
 */
export const IMPERSONATED_ROLE = 'OWNER';
