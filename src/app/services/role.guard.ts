import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { NotificationService } from './notification.service';
import { SessionService } from './session.service';
import { DRIVER_SCOPE_MESSAGE } from './driver-scope.context';
import { homeRouteForRole } from '../utils/home-route';

/** Papel → como o produto o chama em português. */
const ROLE_LABELS: Readonly<Record<string, string>> = {
    OWNER: 'proprietário',
    MANAGER: 'gerente',
    DRIVER: 'motorista',
    VIEWER: 'visualizador',
};

/**
 * FIX-0387 — nome humano da área, por prefixo de URL, do mais específico para o
 * mais genérico (a ordem É o algoritmo: `/configuracoes` casaria os filhos).
 *
 * Só as árvores que um MANAGER alcança sem passar pelo menu — o nav já é
 * OWNER-only, então o caminho real é URL digitada ou link salvo. O que não
 * estiver aqui cai na mensagem sem prefixo, que continua explicando.
 */
const AREA_LABELS: readonly (readonly [string, string])[] = [
    ['/configuracoes/integracoes/asaas', 'Integração com o Asaas'],
    ['/configuracoes/integracoes', 'Integrações da empresa'],
    ['/configuracoes/contratos', 'Modelos de contrato'],
    ['/configuracoes/convites', 'Convites da equipe'],
    ['/configuracoes/contato', 'Dados de contato'],
    ['/configuracoes', 'Configurações da empresa'],
    ['/billing', 'Assinatura e cobrança'],
];

/** Casa por fronteira de segmento: `/billing-x` não é `/billing`. */
const matchesPrefix = (url: string, prefix: string): boolean => {
    const path = url.split('?')[0].split('#')[0];
    return path === prefix || path.startsWith(`${prefix}/`);
};

const areaLabel = (url: string): string | null =>
    AREA_LABELS.find(([prefix]) => matchesPrefix(url, prefix))?.[1] ?? null;

/** "do proprietário" / "do proprietário ou do gerente". */
const allowedPhrase = (allowedRoles: readonly string[]): string => {
    const labels = allowedRoles.map((role) => `do ${ROLE_LABELS[role] ?? role.toLowerCase()}`);
    return labels.length <= 1 ? (labels[0] ?? 'da equipe') : labels.join(' ou ');
};

/**
 * FIX-0387 — a mensagem que o redirect silencioso não dava: O QUE é a área,
 * DE QUEM ela é, e O QUE fazer. Os três em frase curta, porque o host é um
 * toast e no celular ele ocupa a largura toda.
 *
 * O prefixo sai com dois-pontos para fugir da concordância: "Configurações da
 * empresa são exclusivas" vs "Assinatura e cobrança é exclusiva" exigiria
 * gênero e número por rótulo, e um rótulo novo erraria em silêncio.
 */
const deniedMessage = (url: string, allowedRoles: readonly string[], role: string): string => {
    const label = areaLabel(url);
    const scope = `área exclusiva ${allowedPhrase(allowedRoles)}.`;
    const headline = label ? `${label}: ${scope}` : `Á${scope.slice(1)}`;
    const mine = ROLE_LABELS[role] ?? role.toLowerCase();

    return (
        `${headline} Seu acesso nesta empresa é de ${mine}, por isso você voltou ao ` +
        `painel. Fale com o proprietário se precisar entrar.`
    );
};

/** Tempo de leitura: são três orações, o padrão de 5s não dá conta. */
const EXPLANATION_DURATION_MS = 10_000;

/**
 * Nome humano da casa de cada papel, para a frase dizer para onde a pessoa FOI.
 *
 * Sem rótulo conhecido a mensagem NÃO inventa destino: ela para antes de afirmar
 * para onde a pessoa foi. Se `homeRouteForRole` mudar, o texto degrada em vez de
 * mentir — e mentir é exatamente o defeito que esta resolução existe para não
 * criar (ver o cabeçalho de `driverDeniedMessage`).
 */
const HOME_LABELS: Readonly<Record<string, string>> = {
    '/alugueis': 'os aluguéis',
    '/dashboard': 'o painel',
};

/**
 * FEAT-0108 — o desvio da recusa deixou de ser `/dashboard` fixo, e o DRIVER
 * ganhou texto próprio. Duas decisões, uma de cada vez:
 *
 * ## O DESTINO
 *
 * Mandar todo rejeitado para `/dashboard` funcionava enquanto todo membro podia
 * vê-lo. Desde o FIX-0360 essa tela é 403 para um DRIVER — medido no backend por
 * `DriverScopeFilterOrderSecurityConfigTest`, que prova
 * `GET /v1/dashboard/summary` respondendo 403 a um token de motorista. Não há
 * laço de roteador (a rota `dashboard` não tem `canActivate`): o dano é outro e
 * é pior de diagnosticar — o motorista chega a uma tela cuja API recusa, o que
 * parece defeito do produto e não falta de permissão.
 *
 * ## O TEXTO, e por que o do FIX-0387 não serve ao motorista
 *
 * A mensagem do FIX-0387 termina em "por isso você voltou ao painel". Esse texto
 * está ACOPLADO ao destino: com o motorista indo para os aluguéis, a frase
 * passaria a descrever errado o que aconteceu. Por isso o DRIVER lê uma frase
 * própria, que nomeia o destino REAL, e OWNER/MANAGER seguem lendo a do
 * FIX-0387 sem um caractere de diferença — o desvio deles não mudou.
 *
 * ## UMA notificação, não duas
 *
 * O evento é um só, então a mensagem é uma só. Entre duas frases verdadeiras
 * ganha a mais ESPECÍFICA, que é a regra do próprio FIX-0387 aplicada a ele
 * mesmo: causa distinguível não vira frase genérica. Duas notificações no mesmo
 * evento não são mais informação — são ruído que faz não ler nenhuma.
 */
const driverDeniedMessage = (home: string): string => {
    const label = HOME_LABELS[home];
    return label ? `${DRIVER_SCOPE_MESSAGE} Você foi levado para ${label}.` : DRIVER_SCOPE_MESSAGE;
};

/**
 * FIX-0607 — um `roleGuard` carrega os papeis que admite como DADO legivel
 * (`allowedRoles`), e nao so como closure. E isso que torna a paridade
 * nav-vs-guard verificavel: `sidebar-guard-parity.spec.ts` precisa achar, na
 * arvore de rotas, QUAIS `canActivate` sao filtros de papel — os outros
 * (`authGuard`, `onboardingGuard`, `billingAccessGuard`) negam por motivos que
 * nada tem a ver com papel e fabricariam divergencia falsa se fossem rodados.
 *
 * O metadado so LOCALIZA o guard; quem responde "este papel entra?" continua
 * sendo a execucao real do guard com um token real, como o
 * `app.routes.roles.spec.ts` ja fazia. Comparar dois arrays por inspecao
 * provaria que as listas casam, nao que o comportamento casa.
 */
export interface RoleGuardFn extends CanActivateFn {
    readonly allowedRoles: readonly string[];
}

/** `true` para os `canActivate` que filtram por papel, e so para eles. */
export const isRoleGuard = (guard: unknown): guard is RoleGuardFn =>
    typeof guard === 'function' && Array.isArray((guard as Partial<RoleGuardFn>).allowedRoles);

export const roleGuard = (
    allowedRoles: string[]
): RoleGuardFn => {
    const guard: CanActivateFn = (_route, state: RouterStateSnapshot) => {
        const router = inject(Router);
        const sessionService = inject(SessionService);
        const notifications = inject(NotificationService);
        // FIX-0363 — o papel vem do TOKEN, nao do espelho `selectedRole` do
        // sessionStorage. O espelho e editavel pelo DevTools e fica stale; o
        // token e reemitido com o papel da empresa nova em
        // `/auth/select-company/{id}`, e e a mesma fonte que o backend usa.
        // `null` (token ausente, expirado, sem claim) NEGA — papel desconhecido
        // nao vira permissao por omissao.
        const role = sessionService.getCompanyRoleFromToken();

        if (!role) {
            /*
             * Sem papel não há o que explicar em termos de PERMISSÃO — dizer "seu
             * acesso é de X" aqui seria inventar um X. O que MUDA é o destino.
             *
             * FIX-0579 — este ramo devolvia `/dashboard`, e o comentário anterior
             * dizia que de sessão ausente ou expirada "trata o authGuard". Isso é
             * FALSO HOJE: `getToken()` não valida `exp`, então um token vencido
             * atravessa o `authGuard` (que devolve `true` sem HTTP quando a
             * sessão já foi carregada), chega aqui com papel nulo e era mandado
             * para `/dashboard` — rota que passou a ter este mesmo guard. Laço,
             * sem tela e sem chegar ao login. A validação de `exp` é a CAUSA e
             * está no FIX-0580; aqui se fecha o laço, não a causa.
             *
             * Papel nulo NÃO é só token vencido: um PLATFORM_ADMIN sem papel de
             * empresa chega aqui com token VÁLIDO e sessão legítima. Mandá-lo ao
             * login seria deslogar um admin por não ter papel de tenant, então
             * ele vai para a casa dele — `/admin` tem só o `adminGuard`, que o
             * admite, e nenhum `roleGuard` na subárvore.
             */
            return router.createUrlTree([
                sessionService.isPlatformAdmin() ? '/admin' : '/login',
            ]);
        }

        if (allowedRoles.includes(role)) {
            return true;
        }

        // `state.url` e sempre string em producao. Em teste ha chamadas com
        // `{} as RouterStateSnapshot` (app.routes.roles.spec) e um acesso cru
        // as derrubaria com TypeError — a mensagem cai no texto sem area.
        const url = typeof state?.url === 'string' ? state.url : '';
        // O papel continua vindo do TOKEN (FIX-0363). A versão desta casca que
        // ficou parada nove dias lia `sessionService.getItem('selectedRole')`, o
        // espelho editável pelo DevTools que o FIX-0363 removeu de propósito;
        // trazê-la de volta reintroduziria elevação de papel pelo navegador.
        const home = homeRouteForRole(role);
        const message =
            role === 'DRIVER' ? driverDeniedMessage(home) : deniedMessage(url, allowedRoles, role);
        // Pai e filho da mesma árvore carregam o MESMO `roleGuard` (ex.:
        // `/configuracoes` e seu filho ''), então uma navegação pode negar duas
        // vezes. Sem esta checagem o usuário leva o texto empilhado em dobro.
        if (!notifications.notifications().some((n) => n.message === message)) {
            notifications.push('warning', message, EXPLANATION_DURATION_MS);
        }

        return router.createUrlTree([home]);
    };

    return Object.assign(guard, { allowedRoles: [...allowedRoles] as readonly string[] });
};
