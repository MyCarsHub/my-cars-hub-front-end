/**
 * Resposta de `POST /v1/admin/impersonation` (201).
 *
 * `startedAt` / `expiresAt` são instantes ISO-8601 com `Z`. O `token` é
 * somente-leitura e vale 15 minutos — ver `ImpersonationAccessPolicy.TOKEN_TTL`
 * no backend.
 */
export interface ImpersonationStartResponse {
  sessionId: string;
  token: string;
  impersonation: boolean;
  readOnly: boolean;
  companyId: string;
  companyName: string;
  startedAt: string;
  expiresAt: string;
}

/**
 * O que sobrevive em `sessionStorage` durante a sessão. Deliberadamente SEM o
 * token de impersonação: ele já mora na chave `token` (é a credencial ativa) e
 * duplicá-lo só multiplicaria os lugares de onde ele pode vazar.
 */
export interface ImpersonationState {
  sessionId: string;
  companyId: string;
  companyName: string;
  startedAt: string;
  /** ISO-8601. Fonte da expiração local — o servidor continua sendo a autoridade. */
  expiresAt: string;
  /**
   * `startedAt` do servidor menos o `Date.now()` do cliente no instante em que
   * a resposta chegou. Sem isto a contagem regressiva compara um instante do
   * SERVIDOR com o relógio do CLIENTE, e um relógio local adiantado/atrasado
   * faz o banner mentir sobre quanto tempo resta.
   *
   * O sinal do viés é deliberado: a latência da resposta entra no cálculo como
   * "o servidor começou um pouco antes", ou seja, o banner nunca promete MAIS
   * tempo do que existe — no máximo alguns milissegundos a menos.
   */
  clockOffsetMs: number;
}

/**
 * Contexto do admin congelado no início da sessão e restaurado no fim.
 *
 * Congela TODAS as chaves que `AuthService.writeSession()` escreve — as nove
 * de `IMPERSONATION_FROZEN_KEYS` —, não só as quatro do tenant. A identidade (`id`, `name`, `email`, `systemRole`) entra
 * porque `getMe()` / `hydrateSession()` podem rodar durante a sessão e gravar a
 * identidade do usuário impersonado por cima da do admin — e como
 * `SessionService` sincroniza `id`/`email` com a telemetria, os erros seguintes
 * do admin passariam a ser atribuídos ao cliente, mandando PII do cliente para
 * o Sentry. `onboardingCompleted` entra porque é o que os guards leem para
 * decidir se o usuário volta ao /onboarding.
 */
export interface ImpersonationAdminContext {
  selectedCompanyId: string | null;
  selectedCompanyName: string | null;
  selectedRole: string | null;
  /** JSON cru de `userCompanies` — guardado como veio, restaurado como veio. */
  userCompanies: string | null;
  id: string | null;
  name: string | null;
  email: string | null;
  systemRole: string | null;
  /** `'true'` / `'false'` crus, como `SessionService.setOnboardingCompleted` grava. */
  onboardingCompleted: string | null;
}

/** As chaves de `sessionStorage` congeladas e restauradas — fonte única da lista. */
export const IMPERSONATION_FROZEN_KEYS = [
  'selectedCompanyId',
  'selectedCompanyName',
  'selectedRole',
  'userCompanies',
  'id',
  'name',
  'email',
  'systemRole',
  'onboardingCompleted',
] as const satisfies ReadonlyArray<keyof ImpersonationAdminContext>;
