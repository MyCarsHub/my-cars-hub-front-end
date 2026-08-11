/**
 * Chaves dos alvos do tour.
 *
 * Vivem numa constante compartilhada, e não soltas no template, porque quem
 * ANCORA (`sidebar.html`, via `[attr.data-tour]`) e quem PROCURA
 * (`TourService.query()`) precisam falar exatamente a mesma string. Um typo de
 * um dos lados não quebra o build — ele aparece só em produção, como um passo
 * silenciosamente pulado.
 *
 * NÃO ancore por `aria-label` ou por texto: a primeira troca de copy derrubaria
 * o tour inteiro.
 */
export const TOUR_ANCHORS = {
  dashboard: 'dashboard',
  rentals: 'rentals',
  /** Botão do acordeão "Frota" — precisa ser aberto para o item Veículos existir. */
  fleetGroup: 'fleet-group',
  vehicles: 'vehicles',
  drivers: 'drivers',
  alerts: 'alerts',
  reports: 'reports',
  roadmap: 'roadmap',
  /** Botão do acordeão "Configurações" — mesmo papel de `fleetGroup`. */
  settingsGroup: 'settings-group',
  integrations: 'integrations',
  contractTemplate: 'contract-template',
} as const;

export type TourAnchor = (typeof TOUR_ANCHORS)[keyof typeof TOUR_ANCHORS];

export interface TourStep {
  /** Valor de `data-tour` do elemento destacado. */
  readonly key: TourAnchor;
  readonly title: string;
  readonly body: string;
  /**
   * Papéis que veem o passo. Ausente = todos. Espelha `NavItem.roles` da
   * sidebar: um passo cujo item de menu não existe para o papel seria pulado de
   * qualquer forma (alvo ausente), mas filtrar antes mantém o contador
   * "3 de 6" honesto.
   */
  readonly roles?: readonly string[];
  /**
   * `data-tour` do botão de grupo que precisa estar aberto para o alvo existir
   * no DOM. Os filhos de um acordeão fechado não são renderizados.
   */
  readonly expandGroup?: TourAnchor;
  /**
   * O alvo mora dentro da barra lateral. No mobile a barra NÃO existe no DOM
   * até o drawer abrir (`sidebar.html`), então o tour precisa abri-lo antes de
   * medir.
   */
  readonly inSidebar: boolean;
}

/**
 * Roteiro do tour — as funcionalidades principais, na mesma ordem em que
 * aparecem na barra lateral. Seguir a ordem do menu evita que o holofote pule
 * de cima para baixo e de volta, o que no mobile (drawer de 260px) fica
 * especialmente confuso.
 *
 * Uma frase por passo, na linguagem de quem tem de 1 a 5 carros alugados para
 * motorista de aplicativo.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    key: TOUR_ANCHORS.dashboard,
    title: 'Seu resumo do dia',
    body: 'Quanto entrou, quanto ainda falta receber e o que precisa da sua atenção agora.',
    inSidebar: true,
  },
  {
    key: TOUR_ANCHORS.rentals,
    title: 'Onde o dinheiro começa',
    body: 'Cadastre o aluguel do motorista, defina o valor da diária e acompanhe cada pagamento.',
    roles: ['OWNER', 'MANAGER'],
    inSidebar: true,
  },
  {
    key: TOUR_ANCHORS.vehicles,
    title: 'Sua frota',
    body: 'Cada carro com documento, manutenção, multa e seguro reunidos no mesmo lugar.',
    roles: ['OWNER', 'MANAGER'],
    expandGroup: TOUR_ANCHORS.fleetGroup,
    inSidebar: true,
  },
  {
    key: TOUR_ANCHORS.drivers,
    title: 'Quem dirige seus carros',
    body: 'Guarde CNH, contato e histórico de cada motorista sem depender do WhatsApp.',
    roles: ['OWNER', 'MANAGER'],
    inSidebar: true,
  },
  {
    key: TOUR_ANCHORS.alerts,
    title: 'Avisamos antes de vencer',
    body: 'CNH, licenciamento, seguro e financiamento: você é avisado antes do prazo estourar.',
    inSidebar: true,
  },
  {
    key: TOUR_ANCHORS.reports,
    title: 'Feche o mês sem planilha',
    body: 'Exporte receitas, despesas e o resultado da frota no período que você escolher.',
    roles: ['OWNER'],
    inSidebar: true,
  },
  {
    key: TOUR_ANCHORS.roadmap,
    title: 'Peça o que falta',
    body: 'Sugira melhorias e vote nas ideias dos outros — é daí que sai o que construímos.',
    inSidebar: true,
  },
  {
    key: TOUR_ANCHORS.integrations,
    title: 'Cobrança no automático',
    body: 'Conecte o Asaas e as cobranças do aluguel passam a sair sozinhas.',
    roles: ['OWNER'],
    expandGroup: TOUR_ANCHORS.settingsGroup,
    inSidebar: true,
  },
  {
    key: TOUR_ANCHORS.contractTemplate,
    title: 'Contrato pronto',
    body: 'Monte o modelo uma vez e cada novo aluguel já nasce com o contrato gerado.',
    roles: ['OWNER'],
    expandGroup: TOUR_ANCHORS.settingsGroup,
    inSidebar: true,
  },
];
