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
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { Router } from '@angular/router';
import { ClickOutsideDirective } from '../../utils/directives/click-outside.directive';
import { NotificationFeedService } from '../../services/notification-feed.service';
import { SessionService } from '../../services/session.service';
import { NotificationItem, NotificationSeverity } from '../../types/notification-feed.types';
import { DueAlertsPanel } from './due-alerts-panel';
import { BellTab, DUE_ALERTS_ROLES, NotificationBellStore } from './notification-bell.store';

/** Quantidade de notificações mostradas no painel do sino. */
const PANEL_SIZE = 10;

/** Acima disso o contador vira "99+" (o número real segue no aria-label). */
const BADGE_CAP = 99;

/** Prazo da notificação como texto em fundo tingido — sem bolinha (regra do dono). */
const SEVERITY_CHIP: Record<NotificationSeverity, string> = {
  DANGER: 'bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300',
  WARNING: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200',
  INFO: 'bg-surface-sunken text-fg-muted',
};

/** Ordem das abas, para as setas do teclado. */
const TABS: readonly BellTab[] = ['notificacoes', 'vencimentos'];

/**
 * Sino de notificações (canvas "Menu novo", prancha 3).
 *
 * Duas abas para dono e gerente: **Notificações** (o painel de sempre, 10 mais recentes,
 * "Marcar todas como lidas") e **Vencimentos** (o que a página `/alertas` mostrava, carregado
 * sob demanda). O motorista não tem a aba Vencimentos — `/v1/alerts/documents` é 403 para ele —
 * e vê só as notificações, sem abas.
 *
 * Abrir/fechar e a aba vivem no `NotificationBellStore`: o chip do Dashboard e um link antigo
 * para `/alertas` abrem o painel direto em Vencimentos.
 *
 * Onde mora: na barra de topo do celular (`variant="bar"`, sem caixa) e no canto de cima da
 * página no computador (`variant="floating"`, com a caixa de sempre, preso ao rolar).
 *
 * Acessibilidade: gatilho `<button aria-haspopup="dialog">` com `aria-expanded` e o número
 * real no `aria-label`; painel `role="dialog"` que recebe o foco ao abrir; abas com
 * `tablist`/`tab`/`tabpanel` e setas; `Escape` fecha e devolve o foco ao gatilho.
 */
@Component({
  selector: 'app-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ClickOutsideDirective, DueAlertsPanel],
  templateUrl: './notification-bell.html',
  host: { class: 'relative block' },
  styles: `
    .bell-panel {
      animation: bell-in 280ms cubic-bezier(0.32, 0.72, 0, 1);
      transform-origin: top right;
    }
    @keyframes bell-in {
      from {
        opacity: 0;
        transform: translateY(-8px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bell-panel {
        animation: none;
      }
    }
  `,
})
export class NotificationBell implements OnInit, OnDestroy {
  /** `bar`: dentro da barra de topo do celular. `floating`: canto da página no computador. */
  readonly variant = input<'bar' | 'floating'>('floating');

  private readonly feed = inject(NotificationFeedService);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  protected readonly store = inject(NotificationBellStore);

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly menuItems = viewChildren<ElementRef<HTMLElement>>('menuItem');
  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  /**
   * Armado quando o painel abre e consumido pelo efeito de foco. Campo simples (não signal):
   * só distingue "acabei de abrir" de "a lista recarregou", para o foco não ser roubado de
   * volta ao primeiro item enquanto o usuário navega.
   */
  private focusOnRender = false;

  protected readonly open = this.store.open;
  protected readonly tab = this.store.tab;
  protected readonly items = this.feed.items;
  protected readonly loading = this.feed.loading;
  protected readonly error = this.feed.error;
  protected readonly unreadCount = this.feed.unreadCount;

  /**
   * Abas só para quem lê os vencimentos da frota. Lido do TOKEN (a mesma fonte do `roleGuard`)
   * a cada abertura — o token não é reativo, a abertura é o gatilho.
   */
  protected readonly showTabs = computed(() => {
    this.open();
    const role = this.session.getCompanyRoleFromToken();
    return !!role && DUE_ALERTS_ROLES.includes(role);
  });

  /** Aba efetiva: sem abas, sempre Notificações. */
  protected readonly activeTab = computed<BellTab>(() =>
    this.showTabs() ? this.tab() : 'notificacoes',
  );

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
    // Abriu (pelo sino ou de fora): o foco entra no painel e a aba Notificações carrega.
    let wasOpen = false;
    effect(() => {
      const open = this.open();
      if (open && !wasOpen) {
        this.focusOnRender = true;
        untracked(() => {
          if (this.activeTab() === 'notificacoes') this.loadPanel();
        });
      }
      if (!open) this.focusOnRender = false;
      wasOpen = open;
    });

    // Foco ao abrir: primeiro item quando já há lista; senão o próprio painel.
    effect(() => {
      const items = this.menuItems();
      const panel = this.panel();
      if (!this.focusOnRender) return;
      const target = items[0]?.nativeElement ?? panel?.nativeElement;
      if (!target) return;
      this.focusOnRender = false;
      target.focus();
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

  protected close(): void {
    this.store.close();
  }

  protected selectTab(tab: BellTab): void {
    if (this.tab() === tab) return;
    this.store.selectTab(tab);
    if (tab === 'notificacoes') this.loadPanel();
  }

  /** Setas esquerda/direita, Home e End entre as abas (a seleção acompanha o foco). */
  protected onTabKeydown(event: KeyboardEvent): void {
    const current = TABS.indexOf(this.tab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    this.selectTab(TABS[next]);
    this.tabButtons()[next]?.nativeElement.focus();
  }

  /**
   * O directive escuta `pointerdown`, que dispara ANTES do `click` do gatilho. Sem ignorar
   * cliques no próprio gatilho o painel fecharia e o `click` seguinte o reabriria.
   */
  protected onClickOutside(event: Event): void {
    const triggerEl = this.trigger()?.nativeElement;
    const target = event.target;
    if (triggerEl && target instanceof Node && triggerEl.contains(target)) return;
    this.close();
  }

  /** Fecha e devolve o foco ao gatilho (Escape / seleção de item). */
  protected closeAndFocusTrigger(): void {
    this.close();
    this.trigger()?.nativeElement.focus();
  }

  protected onItemClick(item: NotificationItem): void {
    const target = item.actionUrl;
    const navigate = (): void => {
      this.closeAndFocusTrigger();
      if (target) this.router.navigateByUrl(target);
    };
    if (item.read) {
      navigate();
      return;
    }
    // Nunca otimista: navega depois do 2xx, e navega mesmo se a marcação falhar.
    this.feed.markRead(item.id).subscribe({ next: navigate, error: navigate });
  }

  protected onMarkAllRead(): void {
    this.feed.markAllRead().subscribe({ error: () => void 0 });
  }

  /** Setas percorrem os itens da lista de notificações; Home/End vão às extremidades. */
  protected onPanelKeydown(event: KeyboardEvent): void {
    const elements = this.menuItems().map((ref) => ref.nativeElement);
    if (elements.length === 0) return;
    const current = elements.findIndex((el) => el === event.target);
    let next: number | null = null;

    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % elements.length;
    else if (event.key === 'ArrowUp') next = current <= 0 ? elements.length - 1 : current - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = elements.length - 1;

    if (next === null) return;
    event.preventDefault();
    elements[next].focus();
  }

  protected severityChip(severity: NotificationSeverity): string {
    return SEVERITY_CHIP[severity] ?? SEVERITY_CHIP.INFO;
  }

  /** Vencimento relativo em pt-BR (sem `new Date()` no template). */
  protected dueLabel(item: NotificationItem): string {
    const iso = item.dueDate;
    if (!iso) return '';
    const due = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(due.getTime())) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    if (days === 0) return 'Vence hoje';
    if (days < 0) return Math.abs(days) === 1 ? 'Vencido há 1 dia' : `Vencido há ${Math.abs(days)} dias`;
    return days === 1 ? 'Falta 1 dia' : `Faltam ${days} dias`;
  }

  private loadPanel(): void {
    this.feed.list(false, 0, PANEL_SIZE).subscribe({ error: () => void 0 });
  }
}
