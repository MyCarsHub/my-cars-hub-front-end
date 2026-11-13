import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  Type,
  untracked,
  afterNextRender,
  viewChild,
  viewChildren,
} from '@angular/core';
import { DOCUMENT, NgComponentOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { ClickOutsideDirective } from '../../utils/directives/click-outside.directive';
import { NotificationFeedService } from '../../services/notification-feed.service';
import { SessionService } from '../../services/session.service';
import { NotificationItem, NotificationSeverity } from '../../types/notification-feed.types';
import { BellTab, DUE_ALERTS_ROLES, NotificationBellStore } from './notification-bell.store';

/** Quantidade de notificações mostradas no painel do sino. */
const PANEL_SIZE = 10;

/** Prazo da notificação como texto em fundo tingido — sem bolinha (regra do dono). */
const SEVERITY_CHIP: Record<NotificationSeverity, string> = {
  DANGER: 'bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300',
  WARNING: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200',
  INFO: 'bg-surface-sunken text-fg-muted',
};

/** Ordem das abas, para as setas do teclado. */
const TABS: readonly BellTab[] = ['notificacoes', 'vencimentos'];

/**
 * O painel do sino (canvas "Menu novo", prancha 3), baixado na primeira abertura: só o
 * gatilho e o contador moram no pacote inicial (`NotificationBell`).
 *
 * Dono e gerente: abas **Notificações** (10 mais recentes, "Marcar todas como lidas") e
 * **Vencimentos** (a antiga página `/alertas`, baixada à parte na primeira vez que a aba
 * aparece). Motorista: só Notificações, sem abas — `/v1/alerts/documents` é 403 para ele.
 *
 * Abre e fecha pelo `NotificationBellStore`. Recebe o foco ao nascer; `Escape` e a escolha
 * de um item fecham e devolvem o foco ao gatilho (`store.close(true)`).
 */
@Component({
  selector: 'app-bell-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ClickOutsideDirective, NgComponentOutlet],
  templateUrl: './bell-panel.html',
  host: { class: 'contents' },
  styles: `
    .bell-panel {
      animation: bell-in 280ms cubic-bezier(0.32, 0.72, 0, 1);
      transform-origin: top right;
    }
    /* Computador, aba Vencimentos: painel largo para a tabela (sem passar da coluna de conteúdo). */
    @media (min-width: 1024px) {
      .bell-panel[data-wide='true'] {
        width: min(780px, calc(100vw - var(--sidebar-w, 300px) - 3rem));
      }
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
export class BellPanel {
  /** O gatilho do sino: um toque nele não conta como "fora" (é ele quem alterna). */
  readonly trigger = input<HTMLElement | null>(null);

  private readonly feed = inject(NotificationFeedService);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly store = inject(NotificationBellStore);
  private readonly doc = inject(DOCUMENT);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly menuItems = viewChildren<ElementRef<HTMLElement>>('menuItem');
  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  /** O painel nasce ao abrir: o primeiro render leva o foco para dentro dele. */
  private focusOnRender = true;

  protected readonly tab = this.store.tab;
  protected readonly items = this.feed.items;
  protected readonly loading = this.feed.loading;
  protected readonly error = this.feed.error;
  protected readonly hasUnread = computed(() => this.feed.unreadCount() > 0);

  /** Abas só para quem lê os vencimentos da frota (papel do TOKEN, a fonte do `roleGuard`). */
  protected readonly showTabs = signal(
    DUE_ALERTS_ROLES.includes(this.session.getCompanyRoleFromToken() ?? ''),
  );

  /** Aba efetiva: sem abas, sempre Notificações. */
  protected readonly activeTab = computed<BellTab>(() =>
    this.showTabs() ? this.tab() : 'notificacoes',
  );

  /** A aba Vencimentos, baixada com `import()` na primeira vez que aparece. */
  protected readonly duePanel = signal<Type<unknown> | null>(null);
  /** O download da aba falhou (deploy novo trocou os arquivos, rede caiu): erro + tentar de novo. */
  protected readonly duePanelFailed = signal(false);

  constructor() {
    untracked(() => {
      if (this.activeTab() === 'notificacoes') this.loadNotifications();
    });

    // Aba Vencimentos visível (pelo sino, pelo Dashboard ou por um link antigo): baixa a aba.
    effect(() => {
      if (this.activeTab() === 'vencimentos') untracked(() => this.ensureDuePanel());
    });

    // Foco ao abrir: depois do primeiro desenho, o primeiro item se a lista já veio; senão o
    // próprio painel (`tabindex="-1"`), e o primeiro item quando a lista chegar — desde que o
    // foco ainda esteja no painel (quem já foi para outro lugar não é puxado de volta).
    afterNextRender(() => this.focusFirst(true));
    effect(() => {
      this.menuItems();
      untracked(() => this.focusFirst(false));
    });
  }

  private focusFirst(initial: boolean): void {
    if (!this.focusOnRender) return;
    const panel = this.panel()?.nativeElement;
    const first = this.menuItems()[0]?.nativeElement;
    if (!panel) return;
    if (!initial && this.doc.activeElement !== panel) return;
    if (first) {
      this.focusOnRender = false;
      first.focus();
    } else if (initial) {
      panel.focus();
    }
  }

  protected selectTab(tab: BellTab): void {
    if (this.tab() === tab) return;
    this.store.selectTab(tab);
    if (tab === 'notificacoes') this.loadNotifications();
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
    const triggerEl = this.trigger();
    const target = event.target;
    if (triggerEl && target instanceof Node && triggerEl.contains(target)) return;
    this.store.close();
  }

  /** Fecha e devolve o foco ao gatilho (Escape / seleção de item). */
  protected closeAndFocusTrigger(): void {
    this.store.close(true);
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

  /** "Tentar de novo" depois de o download da aba Vencimentos falhar. */
  protected retryDuePanel(): void {
    this.duePanelFailed.set(false);
    this.ensureDuePanel();
  }

  private ensureDuePanel(): void {
    if (this.duePanel() || this.duePanelFailed()) return;
    import('./due-alerts-panel').then(
      (m) => this.duePanel.set(m.DueAlertsPanel),
      () => this.duePanelFailed.set(true),
    );
  }

  private loadNotifications(): void {
    this.feed.list(false, 0, PANEL_SIZE).subscribe({ error: () => void 0 });
  }
}
