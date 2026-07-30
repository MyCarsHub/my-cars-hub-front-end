import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ClickOutsideDirective } from '../../utils/directives/click-outside.directive';
import { NotificationFeedService } from '../../services/notification-feed.service';
import { NotificationItem, NotificationSeverity } from '../../types/notification-feed.types';

/** Quantidade de notificações mostradas no painel do sino. */
const PANEL_SIZE = 10;

/** Acima disso o badge vira "99+" (o número real segue no aria-label). */
const BADGE_CAP = 99;

const SEVERITY_DOT: Record<NotificationSeverity, string> = {
  DANGER: 'bg-rose-500',
  WARNING: 'bg-amber-500',
  INFO: 'bg-sky-500',
};

/**
 * Sino de notificações do header — painel com as 10 mais recentes, ação de
 * "marcar todas como lidas" e atalho para `/alertas`.
 *
 * Acessibilidade: gatilho é `<button aria-haspopup="menu">` com `aria-expanded`
 * e `aria-label` contendo o número de não lidas; o painel é `role="menu"`
 * navegável por setas; `Escape` fecha e devolve o foco ao gatilho; o contador
 * é anunciado por uma região `aria-live="polite"`.
 *
 * Mobile: o painel vira uma folha full-width ancorada abaixo do header em vez
 * de um dropdown estreito cortado pela borda da tela.
 */
@Component({
  selector: 'app-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ClickOutsideDirective],
  templateUrl: './notification-bell.html',
  host: { class: 'relative block' },
})
export class NotificationBell implements OnInit, OnDestroy {
  private readonly feed = inject(NotificationFeedService);
  private readonly router = inject(Router);

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menuItems = viewChildren<ElementRef<HTMLElement>>('menuItem');

  protected readonly open = signal(false);
  protected readonly items = this.feed.items;
  protected readonly loading = this.feed.loading;
  protected readonly error = this.feed.error;
  protected readonly unreadCount = this.feed.unreadCount;

  /** Texto do badge: escondido em 0, "99+" acima do teto. */
  protected readonly badgeLabel = computed(() => {
    const n = this.unreadCount();
    return n > BADGE_CAP ? `${BADGE_CAP}+` : `${n}`;
  });

  protected readonly hasUnread = computed(() => this.unreadCount() > 0);

  /** Rótulo do gatilho e da região aria-live — sempre com o número real. */
  protected readonly ariaLabel = computed(() => {
    const n = this.unreadCount();
    if (n === 0) return 'Notificações, nenhuma não lida';
    if (n === 1) return 'Notificações, 1 não lida';
    return `Notificações, ${n} não lidas`;
  });

  ngOnInit(): void {
    // Polling do contador (60s, pausado com a aba escondida) sobe na primeira
    // montagem do sino — nunca antes do usuário estar autenticado.
    this.feed.startPolling();
  }

  ngOnDestroy(): void {
    this.feed.stopPolling();
  }

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) this.loadPanel();
  }

  protected close(): void {
    this.open.set(false);
  }

  /**
   * O directive escuta `pointerdown`, que dispara ANTES do `click` do gatilho.
   * Sem ignorar cliques no próprio gatilho o painel fecharia e o `click`
   * seguinte o reabriria, tornando impossível fechar pelo sino.
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

  /** Setas percorrem os itens do painel; Home/End vão às extremidades. */
  protected onPanelKeydown(event: KeyboardEvent): void {
    const elements = this.menuItems().map((ref) => ref.nativeElement);
    if (elements.length === 0) return;

    // `event.target` é o elemento focado (o handler está no container do menu),
    // o que evita tocar em `document` dentro do componente.
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

  protected severityDot(severity: NotificationSeverity): string {
    return SEVERITY_DOT[severity] ?? SEVERITY_DOT.INFO;
  }

  /**
   * Vencimento relativo em pt-BR. Sem `new Date()` no template (proibido) —
   * a conta vive aqui.
   */
  protected dueLabel(item: NotificationItem): string {
    const iso = item.dueDate;
    if (!iso) return '';
    const due = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(due.getTime())) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    if (days === 0) return 'vence hoje';
    if (days < 0) return `vencido há ${Math.abs(days)} dia(s)`;
    return `faltam ${days} dia(s)`;
  }

  private loadPanel(): void {
    this.feed.list(false, 0, PANEL_SIZE).subscribe({ error: () => void 0 });
  }
}
