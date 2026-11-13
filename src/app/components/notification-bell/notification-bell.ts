import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  Type,
  untracked,
  viewChild,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { NotificationFeedService } from '../../services/notification-feed.service';
import { NotificationBellStore } from './notification-bell.store';

/** Acima disso o contador vira "99+" (o número real segue no aria-label). */
const BADGE_CAP = 99;

/**
 * Sino de notificações (canvas "Menu novo", prancha 3) — o GATILHO e o contador.
 *
 * O painel (abas Notificações e Vencimentos) é o `BellPanel`, baixado com `import()` na
 * primeira abertura: ele não pesa no pacote inicial, onde o menu e o sino moram. Se o
 * download falhar, o lugar do painel mostra o erro com "Tentar de novo".
 *
 * Abrir/fechar e a aba vivem no `NotificationBellStore`: o chip do Dashboard e um link antigo
 * para `/alertas` abrem o painel direto em Vencimentos.
 *
 * Onde mora: na barra de topo do celular (`variant="bar"`, sem caixa) e na faixa do topo do
 * conteúdo no computador (`variant="floating"`, com a caixa de sempre).
 *
 * Acessibilidade: `<button aria-haspopup="dialog">` com `aria-expanded` e o número real no
 * `aria-label`; o contador também sai numa região `aria-live`. `Escape` e a escolha de um
 * item devolvem o foco ao gatilho (`store.close(true)`).
 */
@Component({
  selector: 'app-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgComponentOutlet],
  templateUrl: './notification-bell.html',
  host: { class: 'relative block' },
})
export class NotificationBell implements OnInit, OnDestroy {
  /** `bar`: dentro da barra de topo do celular. `floating`: faixa do topo no computador. */
  readonly variant = input<'bar' | 'floating'>('floating');

  private readonly feed = inject(NotificationFeedService);
  protected readonly store = inject(NotificationBellStore);

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  protected readonly triggerEl = computed(() => this.trigger()?.nativeElement ?? null);

  protected readonly open = this.store.open;
  private readonly unreadCount = this.feed.unreadCount;

  /** O painel, baixado na primeira abertura. */
  protected readonly panel = signal<Type<unknown> | null>(null);
  protected readonly panelFailed = signal(false);

  protected readonly badgeLabel = computed(() => {
    const n = this.unreadCount();
    return n > BADGE_CAP ? `${BADGE_CAP}+` : `${n}`;
  });

  protected readonly hasUnread = computed(() => this.unreadCount() > 0);

  protected readonly ariaLabel = computed(() => {
    const n = this.unreadCount();
    if (n === 0) return 'Notificações, nenhuma não lida';
    if (n === 1) return 'Notificações, 1 não lida';
    return `Notificações, ${n} não lidas`;
  });

  protected readonly triggerClass = computed(() =>
    this.variant() === 'bar'
      ? 'rounded-xl hover:bg-surface-sunken'
      : 'rounded-lg bg-surface shadow-md border border-gray-200 dark:border-edge hover:bg-canvas',
  );

  constructor() {
    // Abriu (pelo sino ou de fora): baixa o painel, se ainda não veio.
    effect(() => {
      if (this.open()) untracked(() => this.ensurePanel());
    });

    // O painel pediu o foco de volta (Escape, item escolhido).
    let seen = this.store.focusRequests();
    effect(() => {
      const requests = this.store.focusRequests();
      if (requests === seen) return;
      seen = requests;
      this.trigger()?.nativeElement.focus();
    });
  }

  ngOnInit(): void {
    // Polling do contador (60s, pausado com a aba escondida) sobe na primeira montagem.
    this.feed.startPolling();
  }

  ngOnDestroy(): void {
    this.feed.stopPolling();
  }

  protected toggle(): void {
    this.store.toggle();
  }

  protected closeAndFocusTrigger(): void {
    this.store.close(true);
  }

  protected retryPanel(): void {
    this.panelFailed.set(false);
    this.ensurePanel();
  }

  private ensurePanel(): void {
    if (this.panel() || this.panelFailed()) return;
    import('./bell-panel').then(
      (m) => this.panel.set(m.BellPanel),
      () => this.panelFailed.set(true),
    );
  }
}
