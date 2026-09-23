import { Injectable, inject } from '@angular/core';

import { SessionService } from './session.service';

/**
 * O plano que o visitante escolheu na landing, carregado até o onboarding.
 *
 * <h4>O que este serviço NÃO é</h4>
 * Não é a escolha da assinatura. O plano de entrada é decidido no servidor, e o
 * `CompanyService` ignora de propósito qualquer `planId` que venha no corpo.
 * Isto aqui é INTENÇÃO: a pessoa disse o que queria, e o produto não pode fingir
 * que ela não disse nada. Nada daqui vai para o backend (FIX-0291).
 *
 * <h4>Por que sessionStorage, e não as alternativas</h4>
 * O trajeto é landing → `/login` → Google → `/oauth-success` → onboarding, ou
 * seja, ele SAI DA ORIGEM e volta. Isso elimina as outras opções:
 *
 * - estado em memória de um serviço morre no recarregamento da volta do OAuth;
 * - query param se perde na ida ao Google — só sobreviveria embutido no `state`
 *   do protocolo, o que é mexer no fluxo de autenticação por causa de um rótulo;
 * - `localStorage` sobrevive DEMAIS: uma escolha de semanas atrás reapareceria
 *   silenciosamente num visitante que já desistiu dela.
 *
 * `sessionStorage` é o único que dura exatamente uma visita na mesma aba, que é
 * o tempo de vida da intenção.
 *
 * <h4>Duas travas contra escolha velha</h4>
 * 1. A aba. Fechou, acabou — sem TTL inventado por ninguém.
 * 2. `consume()` LÊ E APAGA. A intenção vale uma vez; um segundo onboarding na
 *    mesma aba não herda a escolha do primeiro.
 *
 * Como a intenção só é MOSTRADA e nunca cobra nada, essas duas bastam. No dia em
 * que ela disparar um checkout, um prazo em horas passa a ser obrigatório — e aí
 * esta é a decisão a revisitar.
 */
export type PlanIntent = 'STARTER' | 'PRO' | 'ENTERPRISE';

const KEY = 'planIntent';
const PAID: readonly string[] = ['STARTER', 'PRO', 'ENTERPRISE'];

@Injectable({ providedIn: 'root' })
export class PlanIntentService {
  private readonly session = inject(SessionService);

  /**
   * Registra a escolha. O TRIAL **apaga** em vez de gravar: escolher o gratuito é
   * dizer "não vou pagar agora", e deixar uma intenção paga anterior de pé faria
   * o onboarding anunciar um plano que a pessoa acabou de recusar.
   */
  remember(tier: string): void {
    if (!PAID.includes(tier)) {
      this.forget();
      return;
    }
    this.session.setItem(KEY, tier);
  }

  /** Lê E APAGA. Ver "duas travas" no cabeçalho. */
  consume(): PlanIntent | null {
    const stored = this.session.getItem(KEY);
    this.forget();
    return PAID.includes(stored ?? '') ? (stored as PlanIntent) : null;
  }

  forget(): void {
    this.session.removeItem(KEY);
  }

  /**
   * `SessionService.clear()` derruba o sessionStorage INTEIRO, e o login passa por
   * ele — sem isto a intenção morreria no meio do trajeto que ela existe para
   * atravessar. Devolve a função que a recoloca DEPOIS do wipe.
   *
   * Mesmo idioma que o `oauth-success` já usa para o convite pendente, cinco
   * linhas acima: ler antes, regravar depois.
   */
  preserveAcrossSessionWipe(): () => void {
    const kept = this.session.getItem(KEY);
    return () => {
      if (kept) this.session.setItem(KEY, kept);
    };
  }
}
