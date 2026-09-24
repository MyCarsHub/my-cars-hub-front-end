import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { NotificationService } from './notification.service';
import { SessionService } from './session.service';

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

export const roleGuard = (
    allowedRoles: string[]
): CanActivateFn => {
    return (_route, state: RouterStateSnapshot) => {
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
            // Sem papel não há o que explicar em termos de PERMISSÃO: é sessão
            // ausente ou expirada, e disso trata o `authGuard`. Dizer "seu
            // acesso é de X" aqui seria inventar um X.
            return router.createUrlTree(['/dashboard']);
        }

        if (allowedRoles.includes(role)) {
            return true;
        }

        // `state.url` e sempre string em producao. Em teste ha chamadas com
        // `{} as RouterStateSnapshot` (app.routes.roles.spec) e um acesso cru
        // as derrubaria com TypeError — a mensagem cai no texto sem area.
        const url = typeof state?.url === 'string' ? state.url : '';
        const message = deniedMessage(url, allowedRoles, role);
        // Pai e filho da mesma árvore carregam o MESMO `roleGuard` (ex.:
        // `/configuracoes` e seu filho ''), então uma navegação pode negar duas
        // vezes. Sem esta checagem o usuário leva o texto empilhado em dobro.
        if (!notifications.notifications().some((n) => n.message === message)) {
            notifications.push('warning', message, EXPLANATION_DURATION_MS);
        }

        return router.createUrlTree(['/dashboard']);
    };
};
