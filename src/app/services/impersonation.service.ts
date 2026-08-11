import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import { LayoutStore } from '../components/core/layouts/layout.store';
import {
  IMPERSONATION_FROZEN_KEYS,
  ImpersonationAdminContext,
  ImpersonationStartResponse,
  ImpersonationState,
} from '../types/impersonation.types';
import { NotificationService } from './notification.service';
import { SessionResetRegistry } from './session-reset.registry';
import { SessionService } from './session.service';
import { TenantCachesService } from './tenant-caches.service';
import {
  IMPERSONATION_ADMIN_CONTEXT_KEY,
  IMPERSONATION_ADMIN_TOKEN_KEY,
  IMPERSONATION_STATE_KEY,
  USE_ADMIN_TOKEN,
} from './impersonation.context';

const API_BASE = `${environment.apiUrl}/admin/impersonation`;

/**
 * Papel escrito em `selectedRole` durante a sessão. OWNER porque "ver como
 * empresa" só entrega valor de suporte se o admin alcançar as MESMAS telas que
 * o cliente relatou — e `roleGuard` é puramente client-side. Nada disso concede
 * escrita: o backend abre leitura para qualquer membro do tenant
 * (`RoleGuard`, "Reads … remain open to every authenticated member") e recusa
 * toda mutação no filtro e na transação READ ONLY do Postgres.
 */
const IMPERSONATED_ROLE = 'OWNER';

/**
 * Ciclo de vida da sessão de impersonação "ver como empresa" (somente leitura).
 *
 * ## As duas credenciais
 *
 * Enquanto a sessão dura, o `sessionStorage` guarda DUAS credenciais:
 *
 * - `token` — o token de impersonação. Fica na chave normal de propósito: assim
 *   o `authInterceptor`, os guards e todos os services existentes passam a
 *   enxergar a empresa alvo sem que nenhum deles precise saber que a feature
 *   existe.
 * - `impersonationAdminToken` — o token administrativo, preservado porque
 *   `DELETE /v1/admin/impersonation/{id}` exige a credencial que criou a sessão
 *   (um token de impersonação não alcança `/v1/admin/**`). Sem ele, o admin
 *   ficaria preso até o token expirar sozinho.
 *
 * ## Os três finais declarados
 *
 * 1. **Expira aos 15 minutos.** Um timer local dispara em `expiresAt` e encerra
 *    a sessão devolvendo o admin ao próprio contexto. Se o timer não chegar a
 *    rodar (aba em background, relógio adiantado), o primeiro 401 do backend
 *    produz o mesmo desfecho via `errorInterceptor` — que NÃO manda o admin
 *    para o /login neste caso.
 * 2. **Recarregar a aba.** `sessionStorage` sobrevive ao reload, então a sessão
 *    continua e o banner volta a aparecer. Na hidratação, um estado já vencido
 *    é encerrado na hora — nunca se restaura uma sessão morta.
 * 3. **Fechar o navegador / a aba.** `sessionStorage` morre junto, e com ele as
 *    DUAS credenciais: o comportamento é o mesmo de qualquer sessão do app —
 *    a próxima abertura cai no login. A linha do servidor continua existindo,
 *    inerte, até vencer aos 15 minutos.
 *
 * Em nenhum dos três o admin fica preso: qualquer caminho que derrube a sessão
 * de impersonação ou restaura o token administrativo, ou derruba a sessão
 * inteira.
 *
 * ## Como essa promessa é sustentada (e não só afirmada)
 *
 * - **Toda** queda de sessão passa por aqui, não só o `logout()`: o gancho
 *   registrado no `SessionResetRegistry` faz `SessionService.clear()` disparar
 *   o `reset()`. Antes disso, os cinco `clear()` fora do `logout()` deixavam o
 *   sinal "ativo" sem credencial atrás — e o `impersonationInterceptor`
 *   recusava até o `POST /auth/login`.
 * - `finish()` é reentrante-seguro e sai cedo com estado nulo: o encerramento
 *   concorrente (clicar "Encerrar" perto dos 15 minutos) não pode consumir o
 *   token administrativo duas vezes.
 * - O contexto administrativo congelado cobre TODAS as chaves que uma
 *   hidratação reescreve, não só as do tenant — inclusive `id`/`email`, que
 *   alimentam a telemetria.
 * - Nenhum dado da empresa observada sobrevive à volta: os caches de raiz são
 *   zerados na entrada E na saída (`TenantCachesService`).
 */
@Injectable({ providedIn: 'root' })
export class ImpersonationService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly tenantCaches = inject(TenantCachesService);
  /**
   * `LayoutStore` é resolvido SOB DEMANDA, nunca injetado no construtor. Este
   * serviço é instanciado no boot (para registrar o gancho de `clear()`), e
   * injetar o store aqui o construiria antes do login — ele leria um
   * `sessionStorage` vazio e a barra lateral nasceria sem empresa nenhuma.
   * Durante a impersonação o shell já está montado, então o store já existe.
   */
  private readonly injector = inject(Injector);

  private readonly _state = signal<ImpersonationState | null>(null);

  /** Estado da sessão corrente, ou `null` quando não há impersonação. */
  readonly state = this._state.asReadonly();
  readonly active = computed(() => this._state() !== null);
  readonly companyName = computed(() => this._state()?.companyName ?? '');
  readonly companyId = computed(() => this._state()?.companyId ?? null);
  /** Sempre igual a `active()` hoje; nomeado à parte porque é o que a UI consulta. */
  readonly readOnly = computed(() => this._state() !== null);

  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Evita DELETE duplicado quando o usuário clica duas vezes em "Encerrar". */
  private ending = false;
  /**
   * Guarda de reentrância do `finish()`. O desmonte restaura o token
   * administrativo e depois REMOVE a chave; uma segunda execução encontraria
   * `null` ali e concluiria "sem credencial administrativa" — caindo no ramo
   * que derruba a sessão inteira para o /login. É exatamente o que acontecia
   * quando o timer de expiração (ou um 401 de outra requisição) encerrava a
   * sessão enquanto o DELETE do botão "Encerrar" ainda estava em voo.
   */
  private finishing = false;

  constructor() {
    // Todo `SessionService.clear()` — não só o do `logout()` — precisa matar a
    // sessão de impersonação. Sem isto o sinal continuaria "ativo" sem nenhuma
    // credencial atrás dele e o `impersonationInterceptor` recusaria até o
    // POST /auth/login, prendendo o admin fora da própria conta.
    inject(SessionResetRegistry).register(() => this.onSessionCleared());
    this.hydrate();
  }

  /**
   * Abre a sessão e troca a credencial ativa. O token administrativo é
   * guardado ANTES da troca — inverter a ordem perderia a única credencial
   * capaz de encerrar a sessão.
   */
  start(companyId: string): Observable<ImpersonationState> {
    if (this.active()) {
      return throwError(
        () => new Error('Já existe uma sessão de impersonação ativa nesta aba.'),
      );
    }
    return this.http
      .post<ImpersonationStartResponse>(API_BASE, { companyId })
      .pipe(map((response) => this.begin(response)));
  }

  /**
   * Encerra a sessão no servidor e devolve o admin ao próprio contexto.
   *
   * O contexto local é restaurado em QUALQUER desfecho, inclusive falha de rede:
   * deixar o admin preso numa sessão somente-leitura é pior do que deixar uma
   * linha órfã no servidor, que de todo modo vence em 15 minutos. 404 é sucesso
   * — significa que a sessão já não existia.
   */
  end(): Observable<void> {
    const current = this._state();
    if (!current || this.ending) {
      return of(void 0);
    }
    this.ending = true;

    return this.http
      .delete(`${API_BASE}/${current.sessionId}`, {
        responseType: 'text',
        context: new HttpContext().set(USE_ADMIN_TOKEN, true),
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          // Se a sessão já foi encerrada por outro caminho enquanto o DELETE
          // voava, o aviso seria mentira: o acesso administrativo já voltou.
          if (error.status !== 404 && this._state()) {
            this.notifications.warning(
              'Não foi possível confirmar o encerramento no servidor. Seu acesso de administrador foi restaurado e a sessão expira sozinha em até 15 minutos.',
            );
          }
          return of('');
        }),
        tap(() => {
          this.ending = false;
          // O DELETE é assíncrono e a sessão pode ter morrido no meio do voo —
          // timer de expiração, 401 de outra requisição, `reconcile()`. Sem
          // esta checagem o `finish()` rodaria uma segunda vez, não acharia o
          // token administrativo (a primeira execução já o consumiu) e mandaria
          // o admin para o /login. O DELETE em si continua valendo: encerrar no
          // servidor uma sessão que já acabou é inócuo.
          if (!this._state()) return;
          this.finish({
            message: `Impersonação encerrada. Você voltou ao seu acesso de administrador.`,
            kind: 'success',
            navigate: true,
          });
        }),
        map(() => void 0),
      );
  }

  /**
   * Encerramento LOCAL, sem chamar o servidor — a sessão já morreu lá.
   * Chamado pelo timer de expiração e pelo `errorInterceptor` ao ver 401 com
   * um token de impersonação.
   */
  expire(reason = 'Sua sessão de impersonação expirou. Você voltou ao seu acesso de administrador.'): void {
    if (!this._state()) return;
    this.ending = false;
    this.finish({ message: reason, kind: 'warning', navigate: true });
  }

  /**
   * Descarta a sessão SEM restaurar nada e sem avisar — para quando a sessão
   * inteira do usuário está indo embora (logout). Sem isto, o `sessionStorage`
   * seria zerado pelo logout mas o sinal em memória continuaria "ativo", e o
   * banner sobreviveria até na tela de login.
   */
  reset(): void {
    // `finish()` já está desmontando a sessão (o ramo sem token administrativo
    // chama `session.clear()`, que dispara o gancho que chega aqui). Reentrar
    // agora zeraria o estado que o `finish()` ainda está usando.
    if (this.finishing) return;
    this.clearExpiryTimer();
    this.ending = false;
    this._state.set(null);
    this.session.removeItem(IMPERSONATION_STATE_KEY);
    this.session.removeItem(IMPERSONATION_ADMIN_TOKEN_KEY);
    this.session.removeItem(IMPERSONATION_ADMIN_CONTEXT_KEY);
    // O admin leu telas da empresa observada durante a sessão; os caches de
    // raiz estão cheios com dado dela. Sem isto o dado sobreviveria na aba.
    this.tenantCaches.dropForSessionEnd();
  }

  /**
   * Gancho de `SessionService.clear()`. Idêntico ao `reset()` — só existe com
   * nome próprio para deixar explícito, na leitura do construtor, QUEM chama.
   */
  private onSessionCleared(): void {
    this.reset();
  }

  /**
   * Reconciliação com a verdade do servidor: os cabeçalhos `X-Impersonation` /
   * `X-Impersonated-Company-Id` (expostos no CORS) dizem por qual empresa a
   * resposta passou. Divergir do estado local significa que o banner está
   * mentindo sobre de quem são os dados na tela — encerra-se por segurança.
   *
   * Só o sinal POSITIVO é tratado. Ausência de cabeçalho é ambígua (rota que
   * não passa pelo filtro, resposta de erro escrita antes dele) e derrubar a
   * sessão por ambiguidade produziria encerramentos aleatórios.
   */
  reconcile(companyIdFromServer: string | null): void {
    const current = this._state();
    if (!current || !companyIdFromServer) return;
    if (companyIdFromServer.toLowerCase() === current.companyId.toLowerCase()) return;

    this.finish({
      message:
        'A sessão de impersonação não corresponde mais à empresa exibida e foi encerrada por segurança.',
      kind: 'warning',
      navigate: true,
    });
  }

  // ---------------------------------------------------------------- internals

  private begin(response: ImpersonationStartResponse): ImpersonationState {
    const adminToken = this.session.getToken();
    if (adminToken) {
      this.session.setItem(IMPERSONATION_ADMIN_TOKEN_KEY, adminToken);
    }

    // ANTES de reescrever as chaves: o admin entraria vendo o sino, os seguros
    // e os alertas do PRÓPRIO contexto sob o banner da empresa observada. E,
    // limpando agora, `syncTenant()` lá embaixo ainda enxerga a troca de
    // empresa e dispara um tick imediato.
    this.tenantCaches.resetAll();

    const adminContext = this.snapshotAdminContext();
    this.session.setItem(IMPERSONATION_ADMIN_CONTEXT_KEY, JSON.stringify(adminContext));

    const state: ImpersonationState = {
      sessionId: response.sessionId,
      companyId: response.companyId,
      companyName: response.companyName,
      startedAt: response.startedAt,
      expiresAt: response.expiresAt,
      clockOffsetMs: this.measureClockOffset(response.startedAt),
    };
    this.session.setItem(IMPERSONATION_STATE_KEY, JSON.stringify(state));

    // A troca de credencial vem por último: até aqui, qualquer falha deixa o
    // admin exatamente como estava.
    this.session.setToken(response.token);
    this.session.setItem('selectedCompanyId', state.companyId);
    this.session.setItem('selectedCompanyName', state.companyName);
    this.session.setItem('selectedRole', IMPERSONATED_ROLE);
    // A lista de tenants do menu lateral vem daqui. Durante a sessão ela é a
    // empresa observada e mais nenhuma — deixar as empresas do admin na lista
    // ofereceria um seletor que só produziria 403.
    this.session.setItem(
      'userCompanies',
      JSON.stringify([
        { companyId: state.companyId, companyName: state.companyName, role: IMPERSONATED_ROLE },
      ]),
    );

    this._state.set(state);
    this.armExpiryTimer(state);
    this.syncShellContext();
    return state;
  }

  /**
   * Reconcilia o que sobreviveu à troca de contexto e NÃO se reconstrói
   * sozinho: o `LayoutStore` é singleton de raiz e lê `userCompanies` uma única
   * vez, na construção — como o shell do admin já estava montado, a barra
   * lateral continuaria oferecendo as empresas DELE, e clicar numa gravaria
   * outra empresa por cima da sessão de impersonação ativa. O sino entra pelo
   * mesmo motivo (cache por empresa num serviço de raiz).
   */
  private syncShellContext(): void {
    this.tenantCaches.syncTenant();
    // Resolvido aqui, e não no construtor, porque este serviço nasce no boot:
    // injetar o store lá o construiria antes do login, lendo um armazenamento
    // vazio. Chamado sempre DEPOIS de as chaves de sessão estarem no estado
    // final, então mesmo a primeira construção já lê o contexto certo.
    this.injector.get(LayoutStore).refreshTenants();
  }

  /**
   * Desfaz `begin()`. Restaurar o token administrativo é a única parte que não
   * pode falhar em silêncio: sem ele o admin não tem como voltar, e a saída
   * honesta passa a ser derrubar a sessão inteira para o /login.
   */
  private finish(options: {
    message: string;
    kind: 'success' | 'warning';
    navigate: boolean;
  }): void {
    // Duas guardas, motivos diferentes. `finishing` barra a reentrância pela
    // pilha (o ramo sem token administrativo chama `session.clear()`, que
    // dispara o gancho de volta para cá). `previous == null` barra a segunda
    // execução vinda de outro caminho — a primeira já consumiu e removeu o
    // token administrativo, e seguir daqui mandaria o admin para o /login por
    // um encerramento que deu certo.
    if (this.finishing) return;
    const previous = this._state();
    if (!previous) return;

    this.finishing = true;
    try {
      this.clearExpiryTimer();
      this.ending = false;

      const adminToken = this.session.getItem(IMPERSONATION_ADMIN_TOKEN_KEY);
      const adminContext = this.readAdminContext();

      this.session.removeItem(IMPERSONATION_STATE_KEY);
      this.session.removeItem(IMPERSONATION_ADMIN_TOKEN_KEY);
      this.session.removeItem(IMPERSONATION_ADMIN_CONTEXT_KEY);
      this._state.set(null);

      // O admin passou a sessão LENDO telas da empresa observada — sino,
      // seguros, alertas e convites (que carregam o e-mail dos convidados)
      // estão em serviços de raiz que sobrevivem à troca de contexto. Limpar
      // ANTES de restaurar o contexto administrativo deixa `syncTenant()`
      // enxergar a volta de empresa e recarregar o sino do admin na hora.
      this.tenantCaches.resetAll();

      if (!adminToken) {
        // Estado impossível por construção (só se alguém editou o storage à mão).
        // Fica sem credencial administrativa — melhor cair no login do que
        // continuar navegando com um token que já não vale.
        this.session.clear();
        this.notifications.warning('Sua sessão terminou. Faça login novamente.');
        void this.router.navigate(['/login'], { replaceUrl: true });
        return;
      }

      this.session.setToken(adminToken);
      this.applyAdminContext(adminContext);

      if (options.kind === 'success') {
        this.notifications.success(options.message);
      } else {
        this.notifications.warning(options.message);
      }

      if (options.navigate) {
        void this.router.navigate(['/admin/companies', previous.companyId]);
      }

      // Por ÚLTIMO de propósito: reconciliar o shell é cosmético perto de
      // devolver o acesso. Se algo aqui falhar, o admin já está de volta ao
      // próprio token, ao próprio contexto e na própria rota.
      this.syncShellContext();
    } finally {
      this.finishing = false;
    }
  }

  /**
   * Reconstrói o estado a partir do `sessionStorage` — é o que faz o reload da
   * aba manter a sessão. Estado ilegível ou vencido é encerrado aqui mesmo,
   * sem navegar: no boot da aplicação o Router ainda não resolveu a primeira
   * rota, e o token administrativo restaurado já basta para o admin seguir.
   */
  private hydrate(): void {
    const raw = this.session.getItem(IMPERSONATION_STATE_KEY);
    if (!raw) {
      // Sobras de uma sessão interrompida (ex.: `finish` que não completou).
      this.session.removeItem(IMPERSONATION_ADMIN_TOKEN_KEY);
      this.session.removeItem(IMPERSONATION_ADMIN_CONTEXT_KEY);
      return;
    }

    const state = this.parseState(raw);
    if (!state) {
      this._state.set(null);
      this.session.removeItem(IMPERSONATION_STATE_KEY);
      this.restoreAdminSilently();
      return;
    }

    this._state.set(state);

    if (this.remainingMs(state) <= 0) {
      this.finish({
        message:
          'Sua sessão de impersonação expirou. Você voltou ao seu acesso de administrador.',
        kind: 'warning',
        navigate: false,
      });
      return;
    }

    this.armExpiryTimer(state);
  }

  private restoreAdminSilently(): void {
    const adminToken = this.session.getItem(IMPERSONATION_ADMIN_TOKEN_KEY);
    const adminContext = this.readAdminContext();
    this.session.removeItem(IMPERSONATION_ADMIN_TOKEN_KEY);
    this.session.removeItem(IMPERSONATION_ADMIN_CONTEXT_KEY);
    if (adminToken) {
      this.session.setToken(adminToken);
      this.applyAdminContext(adminContext);
    }
  }

  /** Congela as dez chaves de `IMPERSONATION_FROZEN_KEYS` como estão agora. */
  private snapshotAdminContext(): ImpersonationAdminContext {
    const snapshot = {} as Record<string, string | null>;
    for (const key of IMPERSONATION_FROZEN_KEYS) {
      snapshot[key] = this.session.getItem(key);
    }
    return snapshot as unknown as ImpersonationAdminContext;
  }

  private applyAdminContext(context: ImpersonationAdminContext | null): void {
    const source = (context ?? {}) as unknown as Record<string, string | null | undefined>;
    for (const key of IMPERSONATION_FROZEN_KEYS) {
      const value = source[key] ?? null;
      if (value) {
        this.session.setItem(key, value);
      } else {
        this.session.removeItem(key);
      }
    }
  }

  private readAdminContext(): ImpersonationAdminContext | null {
    const raw = this.session.getItem(IMPERSONATION_ADMIN_CONTEXT_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const record = parsed as Record<string, unknown>;
      const context = {} as Record<string, string | null>;
      for (const key of IMPERSONATION_FROZEN_KEYS) {
        context[key] = this.asStringOrNull(record[key]);
      }
      return context as unknown as ImpersonationAdminContext;
    } catch {
      return null;
    }
  }

  private asStringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private parseState(raw: string): ImpersonationState | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const record = parsed as Record<string, unknown>;
      const sessionId = this.asStringOrNull(record['sessionId']);
      const companyId = this.asStringOrNull(record['companyId']);
      const expiresAt = this.asStringOrNull(record['expiresAt']);
      if (!sessionId || !companyId || !expiresAt) return null;
      if (Number.isNaN(Date.parse(expiresAt))) return null;
      const offset = record['clockOffsetMs'];
      return {
        sessionId,
        companyId,
        companyName: this.asStringOrNull(record['companyName']) ?? 'empresa',
        startedAt: this.asStringOrNull(record['startedAt']) ?? expiresAt,
        expiresAt,
        clockOffsetMs: typeof offset === 'number' && Number.isFinite(offset) ? offset : 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Quanto o relógio do SERVIDOR está à frente do relógio do cliente, medido no
   * instante em que a resposta de abertura chegou. `startedAt` é "agora" para o
   * servidor, então a diferença captura tanto o desvio de relógio quanto (com
   * sinal conservador) a latência da resposta.
   */
  private measureClockOffset(startedAt: string): number {
    const started = Date.parse(startedAt);
    if (Number.isNaN(started)) return 0;
    return started - Date.now();
  }

  /**
   * Milissegundos restantes até `expiresAt`; nunca negativo.
   *
   * `expiresAt` é um instante do SERVIDOR — comparar com `Date.now()` cru faria
   * a contagem regressiva errar exatamente o desvio do relógio local. O offset
   * medido na abertura traz os dois para a mesma linha do tempo.
   */
  remainingMs(state: ImpersonationState | null = this._state()): number {
    if (!state) return 0;
    const end = Date.parse(state.expiresAt);
    if (Number.isNaN(end)) return 0;
    return Math.max(0, end - (Date.now() + state.clockOffsetMs));
  }

  private armExpiryTimer(state: ImpersonationState): void {
    this.clearExpiryTimer();
    if (typeof window === 'undefined') return;
    this.expiryTimer = window.setTimeout(() => {
      this.expiryTimer = null;
      this.expire();
    }, this.remainingMs(state)) as unknown as ReturnType<typeof setTimeout>;
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.expiryTimer as unknown as number);
    }
    this.expiryTimer = null;
  }
}
