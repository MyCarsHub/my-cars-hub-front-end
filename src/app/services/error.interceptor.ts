import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { SessionService } from './session.service';
import { NotificationService } from './notification.service';
import { ApiErrorService } from './api-error.service';
import { ParsedApiError, parseApiError } from './api-error';
import { OWNED_HTTP_ERRORS, SILENT_HTTP_ERRORS } from './http-errors.context';
import { apiPath } from './auth.interceptor';
import {
  DRIVER_IDENTITY_ERROR_CODE,
  DRIVER_IDENTITY_REAUTH_MESSAGE,
  DRIVER_IDENTITY_RETRIED,
} from './driver-identity.context';
import { DriverIdentityRecoveryService } from './driver-identity-recovery.service';
import { ImpersonationService } from './impersonation.service';
import {
  IMPERSONATION_ERROR_CODES,
  IMPERSONATION_READ_ONLY_MESSAGE,
  USE_ADMIN_TOKEN,
} from './impersonation.context';

function isTokenExpired(error: HttpErrorResponse, message: string | null): boolean {
  const raw = typeof error.error === 'string' ? error.error : '';
  return `${raw} ${message ?? ''}`.includes('TokenExpiredException');
}

/**
 * Recusa de escrita durante impersonação. Duas origens, contrato diferente:
 * o `JwtAuthFilter` responde com `code` (barreira barata, antes do banco) e a
 * transação READ ONLY responde só com a mensagem, via `GlobalExceptionHandler`.
 * Reconhecer as duas é o que garante que o admin nunca leia "Acesso negado"
 * quando o motivo real foi a sessão somente-leitura.
 */
function isReadOnlyRefusal(parsed: ParsedApiError, sessionActive: boolean): boolean {
  // O `code` é contrato: só a impersonação o emite, então vale sozinho.
  if (parsed.code === IMPERSONATION_ERROR_CODES.readOnly) return true;
  // A frase NÃO é contrato — qualquer 403 com "somente leitura" na mensagem
  // (uma futura regra de plano, um recurso arquivado) casaria e o usuário
  // receberia um aviso sobre uma sessão de impersonação que não existe. Só
  // aceitamos a heurística quando há de fato uma sessão ativa.
  return sessionActive && /somente leitura/i.test(parsed.message ?? '');
}

/**
 * A própria reemissão do token não pode entrar no caminho de recuperação: um 403
 * vindo de `POST /auth/select-company/{id}` significa que o pedido de token novo
 * foi recusado, e pedir de novo só repetiria a recusa.
 */
function isTokenReissueRequest(url: string): boolean {
  return apiPath(url)?.startsWith('/auth/select-company') ?? false;
}

/**
 * 403 de token de MOTORISTA incompleto — `DRIVER_IDENTITY_NOT_RESOLVED`.
 *
 * Não é falta de permissão: é o access token emitido antes do backend passar a
 * carregar o claim `driverId` (PR #170). O status 403 é igual ao de "você não
 * pode" de propósito — só o `code` distingue os dois, e é por ele que a decisão
 * é tomada aqui.
 */
function isDriverIdentityRefusal(status: number, parsed: ParsedApiError): boolean {
  return status === 403 && parsed.code === DRIVER_IDENTITY_ERROR_CODE;
}

/**
 * Global HTTP error interceptor. It owns EXACTLY ONE class of feedback: the toast for
 * problems the screen cannot meaningfully explain or recover from.
 *
 * - status 0 (network / CORS / offline) → toast, user stays put.
 * - 401 / token expired → clears session, redirects to /login (except /auth/login itself).
 * - 403 → "Acesso negado" toast.
 * - 403 com `code` DRIVER_IDENTITY_NOT_RESOLVED → NÃO é falta de permissão: reemite o
 *   token do motorista e reenvia a requisição; só cai no /login se a reemissão falhar.
 * - 5xx → toast with the backend message or a generic one, user stays put.
 *
 * Durante uma sessão de impersonação, 401 e 403 têm tratamento próprio e
 * anterior a esses — ver o bloco no início do `catchError`.
 *
 * 4xx (400 / 404 / 409 / 422 / 429 …) are the SCREEN's responsibility and are shown
 * inline — field errors under the field, business errors in a banner. The interceptor
 * does not toast them, which is what removes the duplicated messages. It only arms a
 * safety net (`ApiErrorService.scheduleSafetyNet`): if no screen claims the error, a
 * toast still fires so nothing is swallowed silently.
 *
 * Uma requisição marcada com `SILENT_HTTP_ERRORS` fica FORA de tudo isso: nem
 * toast, nem rede de segurança, nem desvio de sessão. É para chamada
 * fire-and-forget, cujo fracasso o usuário não pediu e não pode agir sobre.
 *
 * `OWNED_HTTP_ERRORS` é o meio-termo: a tela é dona dos erros de NEGÓCIO
 * (sem toast de 0/403/5xx, sem rede de segurança de 4xx), mas 401 / token
 * expirado CONTINUAM com o interceptor — sessão vencida limpa e redireciona
 * mesmo quando a tela traduz todo o resto.
 *
 * Always re-throws so component-level handlers still see the error.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const notifications = inject(NotificationService);
  const apiErrors = inject(ApiErrorService);
  const impersonation = inject(ImpersonationService);
  const driverIdentity = inject(DriverIdentityRecoveryService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // Requisição que declarou ser dona do próprio fracasso (fire-and-forget):
      // nada de toast, de rede de segurança nem de desvio de sessão. Precede
      // TODO o resto — inclusive a impersonação — porque a marca é a decisão de
      // quem chamou, e não uma exceção a uma política. Ver `SILENT_HTTP_ERRORS`.
      if (req.context.get(SILENT_HTTP_ERRORS)) {
        return throwError(() => error);
      }

      const status = error.status;
      const parsed = parseApiError(error);
      const backendMessage = parsed.message;

      // --- Impersonação: precede TODA a política genérica abaixo ---------------
      //
      // Sem estes dois desvios o admin cairia no tratamento errado nos dois
      // casos que mais importam: o 401 do token vencido o mandaria para o
      // /login (perdendo o próprio acesso por causa de uma sessão de suporte),
      // e o 403 da escrita bloqueada viraria "Acesso negado" — mensagem que
      // não diz que foi a sessão somente-leitura que barrou.
      //
      // `USE_ADMIN_TOKEN` marca a requisição que ENCERRA a sessão: ela viaja
      // com a credencial administrativa, então um 401 ali é o token do admin
      // que caiu, e aí o /login é o destino certo.
      const isAdminCredentialRequest = req.context.get(USE_ADMIN_TOKEN);

      if (status === 401 && impersonation.active() && !isAdminCredentialRequest) {
        impersonation.expire();
        return throwError(() => error);
      }

      if (status === 403 && isReadOnlyRefusal(parsed, impersonation.active())) {
        notifications.warning(IMPERSONATION_READ_ONLY_MESSAGE);
        return throwError(() => error);
      }

      if (status === 403 && parsed.code === IMPERSONATION_ERROR_CODES.forbiddenPath) {
        notifications.warning(
          backendMessage ?? 'Rota indisponível durante uma sessão de impersonação.',
        );
        return throwError(() => error);
      }

      // --- Token de motorista incompleto: RE-AUTENTICAR, não negar -------------
      //
      // Precede a política genérica pelo mesmo motivo que os desvios acima: cair
      // no "Acesso negado" deixaria a sessão do motorista travada até o token
      // expirar, com uma mensagem que sugere falta de permissão — e o usuário não
      // tem nada a fazer com essa informação, porque o problema é o token.
      //
      // Está ACIMA de `OWNED_HTTP_ERRORS` de propósito: a tela pode ser dona dos
      // erros de negócio dela, mas credencial incompleta é assunto de sessão,
      // como o 401.
      if (isDriverIdentityRefusal(status, parsed)) {
        const reauthenticate = () => {
          session.clear();
          notifications.warning(DRIVER_IDENTITY_REAUTH_MESSAGE);
          router.navigate(['/login'], { replaceUrl: true });
        };

        // Segunda recusa com o MESMO código, já com token reemitido: a reemissão
        // não resolveu (backend antigo atrás de um balanceador, vínculo de
        // motorista removido). Sem este corte o par 403 → reemitir → 403 giraria
        // para sempre.
        if (req.context.get(DRIVER_IDENTITY_RETRIED)) {
          reauthenticate();
          return throwError(() => error);
        }

        // Durante impersonação o token é a credencial somente-leitura do admin, e
        // `/auth/select-company` está bloqueado pelo `impersonationInterceptor`:
        // não há reemissão possível nem faz sentido deslogar o admin.
        const recoverable = !isTokenReissueRequest(req.url) && !impersonation.active();

        if (!recoverable) {
          return throwError(() => error);
        }

        return driverIdentity.reissueToken().pipe(
          // `catchError` ANTES do `switchMap` de propósito: aqui só se pega o
          // fracasso da REEMISSÃO. Depois do `switchMap` ele também pegaria um
          // 500 da requisição reenviada e deslogaria o motorista por um erro de
          // servidor que nada tem a ver com a credencial dele.
          catchError(() => {
            reauthenticate();
            return throwError(() => error);
          }),
          switchMap((token) =>
            next(
              req.clone({
                context: req.context.set(DRIVER_IDENTITY_RETRIED, true),
                setHeaders: { Authorization: `Bearer ${token}` },
              }),
            ),
          ),
        );
      }

      if (isTokenExpired(error, backendMessage)) {
        session.clear();
        notifications.warning('Sua sessão expirou. Faça login novamente.');
        router.navigate(['/login'], { replaceUrl: true });
      } else if (status === 401) {
        // ANTES do desvio de `OWNED_HTTP_ERRORS` de propósito: sessão vencida
        // no meio de um formulário continua limpando a sessão e indo para o
        // /login, mesmo quando a tela é dona dos erros de negócio.
        if (!req.url.includes('/auth/login')) {
          notifications.warning('Sessão inválida. Faça login novamente.');
          session.clear();
          router.navigate(['/login'], { replaceUrl: true });
        }
      } else if (req.context.get(OWNED_HTTP_ERRORS)) {
        // A tela declarou tradução própria para os status de negócio: sem
        // toast de 0/403/5xx e sem rede de segurança de 4xx. Só o caminho de
        // sessão (acima) fica com o interceptor. Ver `OWNED_HTTP_ERRORS`.
      } else if (status === 0) {
        // Rede fora / CORS / servidor inacessível. Não faz logout — provavelmente é
        // temporário e o usuário só precisa tentar de novo.
        notifications.error('Sem conexão com o servidor.');
      } else if (status === 403) {
        notifications.warning('Acesso negado');
      } else if (status >= 500 && status < 600) {
        // Falha do servidor. Mantém o usuário na tela pra ele poder tentar de novo
        // sem perder o contexto (mark-paid, form em edição, etc).
        notifications.error(backendMessage || 'Erro no servidor. Tente novamente.');
      } else if (status >= 400 && status < 500) {
        apiErrors.scheduleSafetyNet(error);
      }

      return throwError(() => error);
    }),
  );
};
