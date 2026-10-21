import { InjectionToken } from '@angular/core';

/**
 * Menu do MOTORISTA, na ordem do protótipo do dono (handoff `design_handoff_motorista`):
 * Dashboard · Financeiro (Ganhos, Custos, Metas) · Veículo (Meu aluguel, Vistorias, Multas) ·
 * Alertas · Roadmap · Configurações · Suporte · Perfil. Sem badges numéricos.
 *
 * Cada item é uma CHAVE; a URL vem de um mapa à parte (`DRIVER_NAV_ROUTES`). Chave sem URL
 * (`null`) não aparece: é como o menu esconde o que o motorista ainda não pode abrir — Multas
 * e Alertas são telas da FROTA (`roleGuard(['OWNER', 'MANAGER'])` em `app.routes.ts`) e Ganhos,
 * Custos e Metas ainda não têm rota. Quem criar a rota troca o `null` pela URL, e só isso.
 *
 * O mesmo desenho serve a demo local (`pages/dev/driver-demo.routes.ts`), que fornece outro
 * mapa com as URLs `/dev/driver/*` — por isso o menu da demo é o menu de produção.
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
  ganhos: null,
  custos: null,
  metas: null,
  aluguel: '/alugueis',
  vistorias: '/vistorias',
  multas: null,
  alertas: null,
  roadmap: '/roadmap',
  configuracoes: '/configuracoes',
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
  /** Linha divisória antes do item (Suporte, pelo protótipo). */
  separatorBefore?: boolean;
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
  { key: 'suporte', label: 'Suporte', icon: 'support', separatorBefore: true },
  { key: 'perfil', label: 'Perfil', icon: 'profile' },
];
