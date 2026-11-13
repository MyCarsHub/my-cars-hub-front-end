import { Injectable, inject, signal } from '@angular/core';
import { SessionResetRegistry } from '../../services/session-reset.registry';

/** Abas do painel do sino. */
export type BellTab = 'notificacoes' | 'vencimentos';

/**
 * Papéis que veem a aba Vencimentos: os mesmos do `roleGuard` da rota `/alertas`
 * (`GET /v1/alerts/documents` é da frota e responde 403 ao motorista). A paridade é
 * medida em `notification-bell.tabs.spec.ts`.
 */
export const DUE_ALERTS_ROLES: readonly string[] = ['OWNER', 'MANAGER'];

/**
 * Estado do painel do sino, fora do componente: quem abre o sino nem sempre é o
 * próprio sino. O chip "documentos a vencer" do Dashboard e um link antigo para
 * `/alertas` abrem o painel direto na aba Vencimentos.
 *
 * Um sino só fica montado por vez (barra de topo no celular, canto da página no
 * computador), então um estado único basta.
 */
@Injectable({ providedIn: 'root' })
export class NotificationBellStore {
  private readonly _open = signal(false);
  private readonly _tab = signal<BellTab>('notificacoes');

  private readonly _focusRequests = signal(0);

  readonly open = this._open.asReadonly();
  readonly tab = this._tab.asReadonly();
  /** Conta os pedidos de foco de volta ao gatilho (o sino observa e foca). */
  readonly focusRequests = this._focusRequests.asReadonly();

  constructor() {
    inject(SessionResetRegistry).register(() => this.reset());
  }

  /** Abre o painel já na aba pedida. */
  openOn(tab: BellTab): void {
    this._tab.set(tab);
    this._open.set(true);
  }

  /** Alterna o painel; ao abrir pelo próprio sino, a aba é Notificações. */
  toggle(): void {
    if (this._open()) {
      this._open.set(false);
      return;
    }
    this.openOn('notificacoes');
  }

  selectTab(tab: BellTab): void {
    this._tab.set(tab);
  }

  /** Fecha; `returnFocus` devolve o foco ao gatilho (Escape, item escolhido). */
  close(returnFocus = false): void {
    this._open.set(false);
    if (returnFocus) this._focusRequests.update((n) => n + 1);
  }

  /** Fim de sessão: a próxima pessoa não herda um painel aberto nem a aba (review L4). */
  reset(): void {
    this._open.set(false);
    this._tab.set('notificacoes');
  }
}
