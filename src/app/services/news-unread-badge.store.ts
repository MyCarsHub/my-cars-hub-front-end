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

  readonly unread = this.count.asReadonly();

  /** Texto do chip ("1 nova", "3 novas"); vazio quando não há não lidas. */
  readonly label = computed(() => {
    const n = this.count();
    if (n <= 0) return '';
    return n === 1 ? '1 nova' : `${n} novas`;
  });

  set(n: number): void {
    this.count.set(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }

  /** Uma novidade saiu do popup (lida): uma a menos, nunca abaixo de zero. */
  decrement(): void {
    this.count.update((n) => Math.max(0, n - 1));
  }
}
