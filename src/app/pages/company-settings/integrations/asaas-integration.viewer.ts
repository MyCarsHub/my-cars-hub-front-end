/**
 * Quem está vendo a página do Asaas. Arquivo à parte, sem dependências pesadas, porque a faixa
 * de testes da casca (bundle inicial) também lê daqui.
 */
import { IMPERSONATION_CLAIM } from '../../../services/impersonation.context';

/* ------------------------------------------------------------------ quem vê */

/**
 * `support`: sessão "ver como empresa". O token de impersonação NÃO tem o claim `role` e
 * rebaixa `system_role` para USER, então ele é reconhecido pelo claim `impersonation` ANTES
 * de qualquer leitura de papel. A sessão vê a página como o dono (nada de Ambiente nem de
 * chave de testes) e o backend recusa as escritas.
 */
export type AsaasViewer = 'admin' | 'owner' | 'support';

export function deriveAsaasViewer(
  token: string | null,
  isPlatformAdmin: () => boolean,
): AsaasViewer {
  if (isImpersonationToken(token)) return 'support';
  return isPlatformAdmin() ? 'admin' : 'owner';
}

/** Fail-closed: token ausente ou ilegível NÃO é impersonação (e também não é admin). */
export function isImpersonationToken(token: string | null): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const base64 = padded + '='.repeat((4 - (padded.length % 4)) % 4);
    const payload = JSON.parse(atob(base64)) as Record<string, unknown>;
    return payload[IMPERSONATION_CLAIM] === true;
  } catch {
    return false;
  }
}
