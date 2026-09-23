import { Injectable } from '@angular/core';

/**
 * Ganchos disparados quando o CONTEXTO DE EMPRESA muda dentro da mesma sessão
 * — troca pelo seletor de tenant, entrada e saída de impersonação — e também
 * no fim de sessão, através do `TenantCachesService`.
 *
 * ## Por que a inversão, e não uma lista fixa
 *
 * A primeira forma disto era uma lista de `inject(XService)` dentro do
 * `TenantCachesService`. Funciona, mas o `TenantCachesService` é resolvido pelo
 * shell autenticado, então cada `import` dessa lista arrasta o serviço da
 * feature para o BUNDLE INICIAL: sete deles estouraram o orçamento de 1 MB em
 * 7,8 kB e derrubaram o build de produção (o de desenvolvimento não tem
 * orçamento e passava). Quem guarda estado se registra — mesmo contrato do
 * `SessionResetRegistry`, e sem nenhum import novo no caminho crítico.
 *
 * O efeito colateral é o correto: um cache que ainda não foi instanciado não
 * está na lista, e também não tem nada da empresa anterior para vazar. A partir
 * da primeira vez que a rota da feature carrega, ele está coberto.
 *
 * ## Contrato
 *
 * - Sem dependências, de propósito: os donos de estado injetam este registro, e
 *   o `TenantCachesService` o dispara. Qualquer dependência aqui fecharia ciclo.
 * - Registre UMA vez, no construtor. Serviços `providedIn: 'root'` são
 *   instanciados uma só vez, então o gancho entra uma só vez.
 * - Um gancho que lança não impede os seguintes: parar no meio deixaria
 *   exatamente o resíduo de outra empresa que a limpeza existe para evitar.
 * - Reentrância é ignorada.
 */
@Injectable({ providedIn: 'root' })
export class TenantResetRegistry {
  private readonly hooks: Array<() => void> = [];
  private running = false;

  register(hook: () => void): void {
    this.hooks.push(hook);
  }

  /** Quantos caches estão vivos e cobertos neste momento. Só para diagnóstico e specs. */
  get size(): number {
    return this.hooks.length;
  }

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
