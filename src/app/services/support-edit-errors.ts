import { parseApiError } from './api-error';
import { SUPPORT_EDIT_ERROR_CODES } from './impersonation.context';

/**
 * Mensagem em pt-BR para as recusas do ciclo de vida da sessão de EDIÇÃO
 * (abrir / estender). `null` quando o erro não é uma delas — o chamador cai no
 * texto genérico da própria tela.
 */
export function supportEditLifecycleMessage(error: unknown): string | null {
  switch (parseApiError(error).code) {
    case SUPPORT_EDIT_ERROR_CODES.disabled:
      return 'O modo edição está desligado na plataforma. Peça a liberação antes de tentar de novo.';
    case SUPPORT_EDIT_ERROR_CODES.alreadyActive:
      return 'Já existe uma sessão de edição ativa para esta empresa. Encerre-a antes de abrir outra.';
    case SUPPORT_EDIT_ERROR_CODES.extensionRefused:
      return 'Não foi possível estender: a sessão já está no limite máximo, expirou ou foi encerrada.';
    default:
      return null;
  }
}

/**
 * Recusas de sessão de EDIÇÃO que o `errorInterceptor` JÁ avisa por toast
 * (rota fora da lista, chave desligada no meio da sessão, teto de escritas).
 * A tela que as recebe não repete a mensagem.
 */
export function isToastedBySupportEditInterceptor(error: unknown): boolean {
  const code = parseApiError(error).code;
  return (
    code === SUPPORT_EDIT_ERROR_CODES.routeNotAllowed ||
    code === SUPPORT_EDIT_ERROR_CODES.disabled ||
    code === SUPPORT_EDIT_ERROR_CODES.writeCapReached
  );
}
