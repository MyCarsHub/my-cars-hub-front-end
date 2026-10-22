import { InjectionToken } from '@angular/core';

/**
 * Menu do MOTORISTA, na ordem do protótipo do dono (handoff `design_handoff_motorista`):
 * Dashboard · Financeiro (Ganhos, Custos, Metas) · Veículo (Meu aluguel, Vistorias, Multas) ·
 * Alertas · Roadmap · Configurações e, no rodapé (como no menu do dono), Suporte · Perfil.
 * Sem badges numéricos.
 *
 * Cada item é uma CHAVE; a URL vem de um mapa à parte (`DRIVER_NAV_ROUTES`). Chave sem URL
 * (`null`) não aparece: é como o menu esconde o que o motorista ainda não pode abrir — Multas
 * e Alertas são telas da FROTA (`roleGuard(['OWNER', 'MANAGER'])` em `app.routes.ts`).
 * Quem criar a rota de uma chave `null` troca o `null` pela URL, e só isso.
 *
 * Outro mapa pode ser fornecido pelo token (um shell de demonstração, um teste): o desenho do
 * menu é o mesmo, só as URLs mudam.
 */
export const DRIVER_NAV_KEYS = [
  'dashboard',
  'ganhos',
  'custos',
  'metas',
  'aluguel',
  'vistorias',
  'multas',
  'alertas',
  'roadmap',
  'configuracoes',
  'suporte',
  'perfil',
] as const;

export type DriverNavKey = (typeof DRIVER_NAV_KEYS)[number];

export type DriverNavRoutes = Record<DriverNavKey, string | null>;

/** URLs do app real. `null` = item oculto (ver o comentário do topo). */
export const DRIVER_PROD_ROUTES: DriverNavRoutes = {
  dashboard: '/meu-painel',
  ganhos: '/meu-painel/ganhos',
  custos: '/meu-painel/custos',
  metas: '/meu-painel/metas',
  aluguel: '/alugueis',
  vistorias: '/vistorias',
  multas: null,
  alertas: null,
  roadmap: '/roadmap',
  // Sem endpoint de preferências ainda (`services/driver-preferences.service.ts`): a tela
  // existe, mas só sai no menu quando gravar de verdade.
  configuracoes: null,
  suporte: '/suporte',
  perfil: '/perfil',
};

export const DRIVER_NAV_ROUTES = new InjectionToken<DriverNavRoutes>('DRIVER_NAV_ROUTES', {
  providedIn: 'root',
  factory: () => DRIVER_PROD_ROUTES,
});

/** Estrutura do menu: chave, rótulo, nome do ícone e grupo. Os ícones vivem em `sidebar.ts`. */
export interface DriverNavEntry {
  key?: DriverNavKey;
  label: string;
  icon: DriverNavIcon;
  /** Grupo aberto na primeira visita (Financeiro, pelo protótipo). */
  defaultOpen?: boolean;
  /**
   * Vai para o rodapé da sidebar, acima de "Recolher" — o MESMO lugar (e o mesmo bloco do
   * template) em que dono e gerente têm Suporte e Perfil. Só vale para item de primeiro nível.
   */
  pinBottom?: boolean;
  exactMatch?: boolean;
  children?: DriverNavEntry[];
}

export type DriverNavIcon =
  | 'dashboard'
  | 'finance'
  | 'earnings'
  | 'costs'
  | 'goals'
  | 'vehicle'
  | 'rental'
  | 'inspection'
  | 'fines'
  | 'alerts'
  | 'roadmap'
  | 'settings'
  | 'support'
  | 'profile';

export const DRIVER_NAV: readonly DriverNavEntry[] = [
  // `exactMatch`: `/meu-painel/lancamentos` é filha e não deve acender o Dashboard.
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', exactMatch: true },
  {
    label: 'Financeiro',
    icon: 'finance',
    defaultOpen: true,
    children: [
      { key: 'ganhos', label: 'Ganhos', icon: 'earnings' },
      { key: 'custos', label: 'Custos', icon: 'costs' },
      { key: 'metas', label: 'Metas', icon: 'goals' },
    ],
  },
  {
    label: 'Veículo',
    icon: 'vehicle',
    children: [
      { key: 'aluguel', label: 'Meu aluguel', icon: 'rental' },
      { key: 'vistorias', label: 'Vistorias', icon: 'inspection' },
      { key: 'multas', label: 'Multas', icon: 'fines' },
    ],
  },
  { key: 'alertas', label: 'Alertas', icon: 'alerts' },
  { key: 'roadmap', label: 'Roadmap', icon: 'roadmap' },
  { key: 'configuracoes', label: 'Configurações', icon: 'settings', exactMatch: true },
  // Rodapé, como no menu do dono: pedido do dono depois do lançamento do app do motorista.
  { key: 'suporte', label: 'Suporte', icon: 'support', pinBottom: true },
  { key: 'perfil', label: 'Perfil', icon: 'profile', pinBottom: true },
];
