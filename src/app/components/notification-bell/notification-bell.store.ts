import { Injectable, signal } from '@angular/core';

/** Abas do painel do sino. */
export type BellTab = 'notificacoes' | 'vencimentos';

/**
 * Papéis que veem a aba Vencimentos: os mesmos do `roleGuard` da rota `/alertas`
 * (`GET /v1/alerts/documents` é da frota e responde 403 ao motorista). A paridade é
 * medida em `notification-bell.roles.spec.ts`.
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

  readonly open = this._open.asReadonly();
  readonly tab = this._tab.asReadonly();

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

  close(): void {
    this._open.set(false);
  }
}
