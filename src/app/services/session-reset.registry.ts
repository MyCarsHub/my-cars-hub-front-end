import { Injectable } from '@angular/core';

/**
 * Ganchos disparados por `SessionService.clear()`.
 *
 * ## Por que existe
 *
 * `sessionStorage.clear()` zera o ARMAZENAMENTO, mas os serviços
 * `providedIn: 'root'` continuam vivos na mesma aba com o estado em memória
 * intacto. Enquanto isso dependeu de cada chamador lembrar de limpar o resto,
 * ficou errado: das seis chamadas de `clear()` no app, só a do `logout()`
 * derrubava a sessão de impersonação e os caches por empresa. As outras cinco
 * (dois ramos do `errorInterceptor`, o `authGuard` e três do `oauth-success`)
 * deixavam o sinal de impersonação "ativo" sem nenhuma credencial atrás dele —
 * e o `impersonationInterceptor` passava a recusar todo POST, inclusive o
 * `/auth/login`, prendendo o administrador fora da própria conta.
 *
 * Inverter a responsabilidade resolve a classe inteira: quem zera a sessão não
 * precisa saber quem mais guarda estado dela. Quem guarda estado se registra.
 *
 * ## Contrato
 *
 * - Sem dependências, de propósito: `SessionService` injeta este registro, e
 *   os donos de estado injetam `SessionService`. Qualquer dependência aqui
 *   fecharia esse ciclo.
 * - Os ganchos rodam DEPOIS do `sessionStorage.clear()`, então um gancho que
 *   releia o armazenamento (ex.: `NotificationFeedService.reset()`) já enxerga
 *   a sessão vazia.
 * - Reentrância é ignorada: um gancho que acabe chamando `clear()` de novo não
 *   reexecuta a lista.
 * - Um gancho que lança não impede os seguintes. A limpeza é best-effort e
 *   parar no meio deixaria justamente o resíduo que ela existe para evitar.
 */
@Injectable({ providedIn: 'root' })
export class SessionResetRegistry {
  private readonly hooks: Array<() => void> = [];
  private running = false;

  /** Registra um gancho. Idempotente do ponto de vista do chamador: registre uma vez, no construtor. */
  register(hook: () => void): void {
    this.hooks.push(hook);
  }

  /** Executa todos os ganchos registrados. Chamado só por `SessionService.clear()`. */
  run(): void {
    if (this.running) return;
    this.running = true;
    try {
      for (const hook of this.hooks) {
        try {
          hook();
        } catch {
          // Best-effort: ver contrato acima.
        }
      }
    } finally {
      this.running = false;
    }
  }
}
