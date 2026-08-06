/**
 * Janelas de aviso configuráveis por empresa
 * (`GET`/`PUT /v1/companies/current/alert-settings`).
 *
 * `GET` é aberto a qualquer membro autenticado — é dele que a página `/alertas`
 * deriva os atalhos de janela. `PUT` é restrito a OWNER/MANAGER e é
 * **substituição completa**: o corpo `{ windows }` passa a ser a lista inteira,
 * não um incremento.
 *
 * Os limites viajam na própria resposta (`minWindowDays` / `maxWindowDays` /
 * `maxWindowCount`) justamente para o cliente não manter uma cópia própria que
 * possa divergir do servidor. Zero é rejeitado de propósito: avisar no dia do
 * vencimento não é aviso.
 */
export interface AlertSettings {
  /** Janelas em vigor, em ordem decrescente. */
  windows: number[];
  /**
   * `false` = a empresa nunca configurou e está usando `defaultWindows`.
   * `true` = configurou — ainda que o resultado coincida com o padrão.
   * A distinção é mostrada na interface, não escondida.
   */
  customized: boolean;
  /** Padrão do sistema, usado pelo botão "Restaurar padrão". */
  defaultWindows: number[];
  minWindowDays: number;
  maxWindowDays: number;
  maxWindowCount: number;
}

/** Corpo do `PUT` — substituição completa da lista. */
export interface AlertSettingsUpdate {
  windows: number[];
}
