import { NavItem } from '../../../components/sidebar/sidebar';
import { AdminCapabilityCode } from '../../../types/admin-roles.types';

/** Um destino do menu da administração. Só rotas de `/admin`: nenhuma tela de empresa entra aqui. */
export interface AdminMenuItem {
  id: string;
  label: string;
  /** Rota absoluta, sempre debaixo de `/admin`. */
  route: string;
  /** Traçado do ícone (viewBox 24), o mesmo do protótipo AdminApp.dc.html. */
  icon: string;
  /** Capacidade que o papel precisa para ver o item (o servidor confere de novo em toda rota). */
  capability: AdminCapabilityCode;
  /** `true` = só a URL exata marca o item (Visão geral); os demais marcam também as telas filhas. */
  exact?: boolean;
}

export interface AdminMenuGroup {
  label: string;
  items: AdminMenuItem[];
  /**
   * Presente = a sidebar desenha o conjunto como GRUPO que abre e fecha (como "Frota"), com este
   * rótulo e este ícone. Ausente = os itens sobem soltos para o primeiro nível.
   */
  collapsible?: { label: string; icon: string };
}

/**
 * Menu da administração, na ordem do protótipo (grupos GERAL / PESSOAS / DINHEIRO / OPERAÇÃO /
 * SEGURANÇA). A capacidade de cada item é a mesma que o servidor exige da tela e que o atalho
 * correspondente em `admin-home.ts` já usa: o item some para quem não pode abri-la.
 *
 * "Ver como" NÃO é item de menu: é uma ação explícita dentro de usuário/empresa/suporte, com
 * confirmação e trilha. Nenhuma página de empresa (dashboard, aluguéis…) é item daqui.
 */
export const ADMIN_MENU: readonly AdminMenuGroup[] = [
  {
    label: 'GERAL',
    items: [
      {
        id: 'home',
        label: 'Visão geral',
        route: '/admin',
        icon: 'M3 12l9-9l9 9M5 10v10h14V10',
        capability: 'ver',
        exact: true,
      },
    ],
  },
  {
    label: 'PESSOAS',
    items: [
      {
        id: 'users',
        label: 'Usuários',
        route: '/admin/users',
        icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
        capability: 'ver',
      },
      {
        id: 'companies',
        label: 'Empresas',
        route: '/admin/companies',
        icon: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4',
        capability: 'ver',
      },
      {
        id: 'admins',
        label: 'Administradores',
        route: '/admin/admins',
        icon: 'M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6z',
        capability: 'admins.gerir',
      },
    ],
  },
  {
    label: 'DINHEIRO',
    collapsible: {
      label: 'Dinheiro',
      icon: 'M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6',
    },
    items: [
      {
        id: 'charges',
        label: 'Cobranças',
        route: '/admin/cobrancas',
        icon: 'M2 7h20v10H2zM2 11h20',
        capability: 'ver',
      },
      {
        id: 'billing',
        label: 'Billing',
        route: '/admin/billing',
        icon: 'M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6',
        capability: 'ver',
      },
      {
        id: 'coupons',
        label: 'Cupons',
        route: '/admin/cupons',
        icon: 'M20 12l-8 8l-9-9V3h8z',
        capability: 'ver',
      },
    ],
  },
  {
    label: 'OPERAÇÃO',
    collapsible: { label: 'Operação', icon: 'M21 12a8 8 0 0 1-12 7l-5 2l2-5a8 8 0 1 1 15-4' },
    items: [
      {
        id: 'support',
        label: 'Suporte',
        route: '/admin/suporte',
        icon: 'M21 12a8 8 0 0 1-12 7l-5 2l2-5a8 8 0 1 1 15-4',
        capability: 'ver',
      },
      {
        id: 'feedback',
        label: 'Feedback',
        route: '/admin/feedback',
        icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4',
        capability: 'suporte.atender',
      },
      {
        id: 'notifications',
        label: 'Notificações',
        route: '/admin/notificacoes',
        icon: 'M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3l2 3H4l2-3v-3a7 7 0 0 1 4-6M9 19a3 3 0 0 0 6 0',
        capability: 'ver',
      },
      {
        id: 'blog',
        label: 'Blog',
        route: '/admin/blog',
        icon: 'M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4zM8 8h8',
        capability: 'blog',
      },
    ],
  },
  {
    label: 'SEGURANÇA',
    items: [
      {
        id: 'audit',
        label: 'Auditoria',
        route: '/admin/auditoria',
        icon: 'M9 4h6M8 2h8v4H8zM6 4H5v18h14V4h-1M9 12h6M9 16h6',
        capability: 'ver',
      },
    ],
  },
];

/** A URL está na área de administração? (`/admin`, `/admin/...`, com ou sem query/fragmento). */
export function isAdminAreaUrl(url: string): boolean {
  return /^\/admin(?:[/?#]|$)/.test(url);
}

/** Menu que o papel enxerga: itens sem a capacidade somem e grupo vazio some junto. */
export function visibleAdminMenu(can: (code: AdminCapabilityCode) => boolean): AdminMenuGroup[] {
  return ADMIN_MENU.map((group) => ({
    label: group.label,
    collapsible: group.collapsible,
    items: group.items.filter((item) => can(item.capability)),
  })).filter((group) => group.items.length > 0);
}

/** Item do menu que "dona" de uma rota de `/admin` (a tela de detalhe pertence à lista). */
export function adminMenuItemForUrl(url: string): AdminMenuItem | null {
  const path = url.split(/[?#]/)[0];
  const all = ADMIN_MENU.flatMap((g) => g.items);
  if (path === '/admin' || path === '/admin/') return all.find((i) => i.exact) ?? null;
  return (
    all.find((i) => !i.exact && (path === i.route || path.startsWith(i.route + '/'))) ?? null
  );
}

/** Mesmo molde de ícone do menu de empresa (20px, traço 2), para as duas áreas não divergirem. */
function navIcon(path: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

/**
 * O menu da administração no modelo da sidebar de empresa (`NavItem`): grupos com `collapsible`
 * viram grupo que abre e fecha; os demais itens sobem soltos. Grupo com UM item visível vira
 * item, a mesma regra do menu de empresa.
 */
export function buildAdminNavItems(groups: readonly AdminMenuGroup[]): NavItem[] {
  const toItem = (item: AdminMenuItem): NavItem => ({
    route: item.route,
    label: item.label,
    icon: navIcon(item.icon),
    exactMatch: item.exact,
  });
  return groups.flatMap((group): NavItem[] => {
    if (group.items.length === 0) return [];
    if (!group.collapsible || group.items.length === 1) return group.items.map(toItem);
    return [
      {
        label: group.collapsible.label,
        icon: navIcon(group.collapsible.icon),
        children: group.items.map(toItem),
      },
    ];
  });
}
