import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { FleetActivationService } from './fleet-activation.service';
import { SessionService } from './session.service';

/**
 * Rotas que o gate NUNCA intercepta:
 * - `/veiculos/novo` é o próprio destino do redirect (sem isto: laço infinito);
 * - `/billing` é para onde o `billingAccessGuard` manda assinatura vencida —
 *   interceptar aqui criaria um cabo-de-guerra entre guards;
 * - `/perfil` e `/suporte` são utilitários que precisam funcionar mesmo com a
 *   frota vazia (logout vive no shell, fora de rota);
 * - `/configuracoes` porque convidar um sócio antes do primeiro carro é fluxo
 *   legítimo (decisão do orquestrador).
 */
const EXCLUDED_PREFIXES = ['/veiculos/novo', '/billing', '/perfil', '/suporte', '/configuracoes'];

/**
 * Casa o prefixo em FRONTEIRA DE SEGMENTO: `/perfil` isenta `/perfil` e
 * `/perfil/foo?x=1`, mas nunca um futuro `/perfil-publico` — `startsWith` cru
 * deixaria essa rota isenta em silêncio. Os terminadores cobrem fim de URL,
 * segmento (`/`), query (`?`), matrix params (`;`) e fragmento (`#`).
 */
function isExcluded(url: string, prefix: string): boolean {
  if (!url.startsWith(prefix)) return false;
  const boundary = url.charAt(prefix.length);
  return boundary === '' || boundary === '/' || boundary === '?' || boundary === ';' || boundary === '#';
}

/**
 * Gate de ativação (FEAT-0080): quem entra no app sem NENHUM veículo é
 * conduzido a `/veiculos/novo?ativacao=1` (a faixa da tela explica e oferece
 * "Pular por enquanto"). Rede de segurança para quem pulou o condutor do
 * onboarding — a auditoria do funil mostra 16/25 empresas sem nenhum carro.
 *
 * Ordem no array de `canActivateChild` importa: roda DEPOIS do
 * `onboardingGuard`, então aqui o onboarding já está concluído.
 *
 * Fail-open em erro de rede/5xx: o gate é growth, não segurança — nunca
 * trancar o usuário fora do app por falha nossa.
 */
export const firstVehicleGuard: CanActivateChildFn = (_route, state) => {
  const session = inject(SessionService);
  const activation = inject(FleetActivationService);
  const router = inject(Router);

  if (EXCLUDED_PREFIXES.some((prefix) => isExcluded(state.url, prefix))) {
    return true;
  }
  // PLATFORM_ADMIN opera acima do modelo de tenant — nunca ativa frota.
  if (session.isPlatformAdmin()) {
    return true;
  }
  // DRIVER/VIEWER não podem receber o redirect: o roleGuard de `/veiculos`
  // exige OWNER/MANAGER e devolveria para /dashboard — ping-pong de guards.
  //
  // FIX-0363 — o papel vem do TOKEN, e essa é a única leitura que serve aqui.
  // Esta proteção nunca dependeu do VALOR do papel: ela depende de os dois
  // guards lerem a MESMA fonte. Enquanto ambos liam `selectedRole`, isso era
  // automático. Quando o `roleGuard` passou a ler o token e este continuou no
  // sessionStorage, a premissa morreu — e qualquer divergência entre espelho e
  // token (adulteração pelo DevTools, ou espelho stale depois de uma reemissão
  // silenciosa do FEAT-0106) reabria o ping-pong: aqui o papel "passa" e manda
  // para `/veiculos/novo`, lá o token nega e devolve para `/dashboard`, e o
  // ciclo recomeça. Ler daqui não é coerência estética, é o que mantém a
  // proteção de pé.
  const role = session.getCompanyRoleFromToken();
  if (role !== 'OWNER' && role !== 'MANAGER') {
    return true;
  }
  if (activation.hasSkipped()) {
    return true;
  }

  return activation.hasVehicles().pipe(
    map((has) =>
      has
        ? true
        : router.createUrlTree(['/veiculos', 'novo'], { queryParams: { ativacao: '1' } }),
    ),
    catchError(() => of(true)),
  );
};
