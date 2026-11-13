import { signal } from '@angular/core';

/**
 * FEAT-0573 — avisa que a lista `features` da sessão mudou (login, `/auth/me`, logout).
 *
 * Fica num arquivo sem dependências de propósito: `AuthService` (bundle inicial) só precisa
 * deste sinal, e o `FeatureFlagsService` (código preguiçoso) relê a sessão a cada mudança.
 * Sem isto, um logout seguido de login na mesma aba deixava a chave presa no valor antigo.
 */
export const featuresSessionVersion = signal(0);

export function markFeaturesChanged(): void {
  featuresSessionVersion.update((v) => v + 1);
}
