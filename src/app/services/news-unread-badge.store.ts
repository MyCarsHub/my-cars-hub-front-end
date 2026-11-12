import { Injectable, computed, signal } from '@angular/core';

/**
 * Quantas novidades o usuário ainda não leu — o "N novas" do item Novidades no menu.
 *
 * Sem dependências, de propósito: a sidebar só LÊ este número e não pode passar a exigir
 * `HttpClient` de quem a monta. Quem busca e atualiza é o `NewsFeedService`.
 */
@Injectable({ providedIn: 'root' })
export class NewsUnreadBadgeStore {
  private readonly count = signal(0);
  /** Novidades que o popup tirou da fila nesta carga (lidas): a página apaga o "Nova" delas. */
  private readonly readNow = signal<ReadonlySet<string>>(new Set());

  readonly unread = this.count.asReadonly();
  readonly readIds = this.readNow.asReadonly();

  /** Texto do chip ("1 nova", "3 novas"); vazio quando não há não lidas. */
  readonly label = computed(() => {
    const n = this.count();
    if (n <= 0) return '';
    return n === 1 ? '1 nova' : `${n} novas`;
  });

  set(n: number): void {
    this.count.set(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }

  /** A novidade `id` saiu do popup (lida): uma a menos no chip, nunca abaixo de zero. */
  markRead(id: string): void {
    if (this.readNow().has(id)) return;
    this.readNow.update((ids) => new Set(ids).add(id));
    this.count.update((n) => Math.max(0, n - 1));
  }

  /** Logout: a próxima pessoa começa do zero. */
  clear(): void {
    this.count.set(0);
    this.readNow.set(new Set());
  }
}
