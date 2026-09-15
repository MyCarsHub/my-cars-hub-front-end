import { DOCUMENT, Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { analyticsCookieNames, expiryAssignments } from './analytics-cookies';

/**
 * Consentimento para o Google Analytics 4.
 *
 * <h4>Por que o servico existe, e nao so um booleano</h4>
 * A tag do GA4 e carregada em `src/index.html` com o Consent Mode em
 * **denied por padrao** — ela existe na pagina e nao grava NADA ate alguem
 * aceitar. Este servico e o unico lugar que muda esse estado, nos dois sentidos,
 * e o unico que fala com o `gtag`. Um segundo caminho para o mesmo `consent
 * update` e como as duas metades divergem.
 *
 * <h4>localStorage, e nao sessionStorage</h4>
 * Diferente da intencao de plano, a escolha de consentimento NAO pode morrer com
 * a aba: perguntar de novo a cada visita e, alem de irritante, discutivel do
 * ponto de vista de consentimento informado. Ela persiste ate ser revogada.
 *
 * <h4>Revogar faz parte do contrato</h4>
 * A politica de privacidade afirma que da para revogar. `revoke()` e o que torna
 * essa frase verdadeira: volta o `gtag` para `denied`, APAGA os cookies que o GA4
 * ja gravou, e reabre o banner. Sem isso, o documento voltaria a prometer algo
 * que o produto nao faz.
 *
 * O Consent Mode sozinho interrompe a coleta dali para a frente e NAO faz
 * limpeza retroativa — um `_ga` gravado num aceite anterior sobreviveria a
 * revogacao. Por decisao do dono, revogar limpa. Ver `analytics-cookies.ts` para
 * por que apagar cookie de terceiro dominio falha em silencio.
 */
export type ConsentDecision = 'granted' | 'denied';

const KEY = 'analyticsConsent';

type GtagFn = (...args: unknown[]) => void;

@Injectable({ providedIn: 'root' })
export class ConsentService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _decision = signal<ConsentDecision | null>(this.read());

  /** `null` enquanto a pessoa ainda nao decidiu — e o que faz o banner aparecer. */
  readonly decision = this._decision.asReadonly();
  readonly undecided = computed(() => this._decision() === null);

  accept(): void {
    this.apply('granted');
  }

  reject(): void {
    this.apply('denied');
  }

  /**
   * Volta ao estado indeciso: `gtag` negado, cookies do GA4 apagados, banner de
   * novo na tela.
   *
   * Devolve os nomes que SOBRARAM depois da tentativa — vazio e o caso normal.
   * Devolver em vez de engolir e o que permite ao chamador (e ao spec) provar a
   * limpeza LENDO o cookie, em vez de confiar que a chamada aconteceu.
   */
  revoke(): string[] {
    this.write(null);
    this.pushConsent('denied');
    const remaining = this.clearAnalyticsCookies();
    this._decision.set(null);
    return remaining;
  }

  /**
   * Expira todo cookie de analytics presente, cobrindo as variantes de dominio e
   * o path raiz, e RELE o `document.cookie` para dizer o que sobrou.
   *
   * A releitura e o ponto: uma expiracao com o `domain` errado nao apaga nada e
   * nao lanca — sem conferir depois, a limpeza seria uma suposicao.
   */
  private clearAnalyticsCookies(): string[] {
    if (!this.isBrowser) return [];
    const hostname = this.document.defaultView?.location.hostname ?? '';
    for (const name of analyticsCookieNames(this.document.cookie)) {
      for (const assignment of expiryAssignments(name, hostname)) {
        this.document.cookie = assignment;
      }
    }
    return analyticsCookieNames(this.document.cookie);
  }

  private apply(decision: ConsentDecision): void {
    this.write(decision);
    this.pushConsent(decision);
    this._decision.set(decision);
  }

  /**
   * Fala com a tag. Se o `gtag` nao existir — bloqueador de anuncio, rede caida,
   * prerender — nao ha o que atualizar, e a ausencia dele nao pode derrubar a
   * tela: sem tag nao ha coleta, que e justamente o estado seguro.
   */
  private pushConsent(decision: ConsentDecision): void {
    if (!this.isBrowser) return;
    const gtag = (this.document.defaultView as { gtag?: GtagFn } | null)?.gtag;
    if (typeof gtag !== 'function') return;
    gtag('consent', 'update', {
      analytics_storage: decision,
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  }

  private read(): ConsentDecision | null {
    if (!this.isBrowser) return null;
    try {
      const stored = this.document.defaultView?.localStorage.getItem(KEY);
      return stored === 'granted' || stored === 'denied' ? stored : null;
    } catch {
      // localStorage pode lancar (modo privado, storage desabilitado). Sem
      // registro, a pessoa e tratada como indecisa — ninguem e rastreado por erro.
      return null;
    }
  }

  private write(decision: ConsentDecision | null): void {
    if (!this.isBrowser) return;
    try {
      const storage = this.document.defaultView?.localStorage;
      if (!storage) return;
      if (decision === null) storage.removeItem(KEY);
      else storage.setItem(KEY, decision);
    } catch {
      // Ver `read()`: falhar ao gravar nao pode quebrar a tela. O efeito e que a
      // pessoa sera perguntada de novo, que e o lado seguro do erro.
    }
  }
}
