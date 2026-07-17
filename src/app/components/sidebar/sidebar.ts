import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { filter, map, startWith } from 'rxjs';
import { signal } from '@angular/core';
import { LayoutStore, Tenant } from '../core/layouts/layout.store';
import { SessionService } from '../../services/session.service';

interface NavItem {
  route?: string;
  label: string;
  icon: string;
  roles?: string[];
  requiresPlatformAdmin?: boolean;
  pinBottom?: boolean;
  children?: NavItem[];
  exactMatch?: boolean;
}

const ICON_ADMIN = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`;
const ICON_DASHBOARD = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
const ICON_RENTALS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`;
const ICON_VEHICLES = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>`;
const ICON_MAINT = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const ICON_FINES = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const ICON_FINANCING = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
const ICON_DRIVERS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const ICON_REPORTS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
const ICON_ROADMAP = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>`;
const ICON_BILLING = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
const ICON_COMPANY = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 9h.01"/><path d="M9 13h.01"/><path d="M9 17h.01"/><path d="M15 9h.01"/><path d="M15 13h.01"/><path d="M15 17h.01"/></svg>`;
const ICON_INTEGRATIONS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
const ICON_SETTINGS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const ICON_PROFILE = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const ICON_SUPPORT = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.52 3.48A11.9 11.9 0 0 0 12 0C5.37 0 0 5.37 0 12a11.9 11.9 0 0 0 1.72 6.19L0 24l5.99-1.68A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.19-1.24-6.19-3.48-8.52zM12 22a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.55.99.99-3.47-.24-.36A9.9 9.9 0 0 1 2 12C2 6.48 6.48 2 12 2s10 4.48 10 10-4.48 10-10 10zm5.42-7.47c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.66.15-.2.3-.76.96-.93 1.15-.17.2-.35.22-.65.07-.3-.15-1.24-.46-2.36-1.46-.87-.78-1.46-1.73-1.63-2.03-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.66-1.6-.9-2.19-.24-.57-.48-.5-.66-.51h-.56c-.2 0-.5.07-.76.37-.26.3-1 1-1 2.44 0 1.44 1.03 2.83 1.17 3.03.15.2 2.04 3.11 4.94 4.36 2.9 1.25 2.9.83 3.42.78.52-.05 1.75-.71 2-1.4.24-.7.24-1.28.17-1.4-.07-.13-.27-.2-.57-.35z"/></svg>`;

const NAV_ITEMS: NavItem[] = [
  { route: '/admin', label: 'Administração', icon: ICON_ADMIN, requiresPlatformAdmin: true },
  { route: '/dashboard', label: 'Dashboard', icon: ICON_DASHBOARD },
  { route: '/alugueis', label: 'Aluguéis', icon: ICON_RENTALS, roles: ['OWNER', 'MANAGER'] },
  {
    label: 'Frota',
    icon: ICON_VEHICLES,
    children: [
      { route: '/veiculos', label: 'Veículos', icon: ICON_VEHICLES, roles: ['OWNER', 'MANAGER'] },
      { route: '/manutencoes', label: 'Manutenções', icon: ICON_MAINT, roles: ['OWNER', 'MANAGER'] },
      { route: '/multas', label: 'Multas', icon: ICON_FINES, roles: ['OWNER', 'MANAGER'] },
      { route: '/financiamentos', label: 'Financiamentos', icon: ICON_FINANCING, roles: ['OWNER', 'MANAGER'] },
    ],
  },
  { route: '/motoristas', label: 'Motoristas', icon: ICON_DRIVERS, roles: ['OWNER', 'MANAGER'] },
  { route: '/relatorios', label: 'Relatórios', icon: ICON_REPORTS, roles: ['OWNER'] },
  { route: '/roadmap', label: 'Roadmap', icon: ICON_ROADMAP },
  { route: '/billing', label: 'Assinatura', icon: ICON_BILLING, roles: ['OWNER'] },
  {
    label: 'Configurações',
    icon: ICON_SETTINGS,
    children: [
      { route: '/configuracoes', label: 'Empresa', icon: ICON_COMPANY, roles: ['OWNER'], exactMatch: true },
      { route: '/configuracoes/integracoes/asaas', label: 'Integrações', icon: ICON_INTEGRATIONS, roles: ['OWNER', 'MANAGER'] },
      { route: '/configuracoes/contratos', label: 'Contratos', icon: ICON_COMPANY, roles: ['OWNER', 'MANAGER'] },
    ],
  },
  { route: '/suporte', label: 'Suporte', icon: ICON_SUPPORT, pinBottom: true },
  { route: '/perfil', label: 'Perfil', icon: ICON_PROFILE, pinBottom: true },
];

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
  animations: [
    trigger('sidebarWidth', [
      state('expanded', style({ width: '260px' })),
      state('collapsed', style({ width: '72px' })),
      transition('expanded <=> collapsed', animate('300ms cubic-bezier(0.4, 0, 0.2, 1)')),
    ]),
    trigger('fadeLabel', [
      transition(':enter', [
        style({ opacity: 0, width: 0, overflow: 'hidden' }),
        animate('200ms 100ms ease-out', style({ opacity: 1, width: '*' })),
      ]),
      transition(':leave', [
        style({ opacity: 1, overflow: 'hidden' }),
        animate('150ms ease-in', style({ opacity: 0, width: 0 })),
      ]),
    ]),
    trigger('dropdownSlide', [
      transition(':enter', [
        style({ height: 0, opacity: 0, overflow: 'hidden' }),
        animate('250ms cubic-bezier(0.4, 0, 0.2, 1)', style({ height: '*', opacity: 1 })),
      ]),
      transition(':leave', [
        style({ overflow: 'hidden' }),
        animate('200ms cubic-bezier(0.4, 0, 0.2, 1)', style({ height: 0, opacity: 0 })),
      ]),
    ]),
    trigger('overlayFade', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('200ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [animate('200ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('mobileSlide', [
      transition(':enter', [
        style({ transform: 'translateX(-100%)' }),
        animate('300ms cubic-bezier(0.4, 0, 0.2, 1)', style({ transform: 'translateX(0)' })),
      ]),
      transition(':leave', [
        animate(
          '250ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ transform: 'translateX(-100%)' })
        ),
      ]),
    ]),
    trigger('rotateChevron', [
      state('expanded', style({ transform: 'rotate(0deg)' })),
      state('collapsed', style({ transform: 'rotate(180deg)' })),
      transition('expanded <=> collapsed', animate('300ms cubic-bezier(0.4, 0, 0.2, 1)')),
    ]),
    trigger('rotateTenantChevron', [
      state('closed', style({ transform: 'rotate(0deg)' })),
      state('open', style({ transform: 'rotate(180deg)' })),
      transition('closed <=> open', animate('250ms cubic-bezier(0.4, 0, 0.2, 1)')),
    ]),
    trigger('rotateGroupChevron', [
      state('collapsed', style({ transform: 'rotate(0deg)' })),
      state('expanded', style({ transform: 'rotate(90deg)' })),
      transition('collapsed <=> expanded', animate('200ms cubic-bezier(0.4, 0, 0.2, 1)')),
    ]),
  ],
})
export class Sidebar {
  protected readonly layout = inject(LayoutStore);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  private readonly userState = signal<ReadonlyMap<string, 'open' | 'closed'>>(new Map());

  private readonly allowedItems = computed<NavItem[]>(() => {
    const role = this.layout.selectedTenant()?.role;
    const isAdmin = this.session.isPlatformAdmin();
    const passes = (item: NavItem) => {
      if (item.requiresPlatformAdmin && !isAdmin) return false;
      if (item.roles && !(role && item.roles.includes(role))) return false;
      return true;
    };
    return NAV_ITEMS.reduce<NavItem[]>((acc, item) => {
      if (!passes(item)) return acc;
      if (item.children) {
        const visibleChildren = item.children.filter(passes);
        if (visibleChildren.length === 0) return acc;
        acc.push({ ...item, children: visibleChildren });
      } else {
        acc.push(item);
      }
      return acc;
    }, []);
  });

  protected readonly navItems = computed(() =>
    this.allowedItems().filter(item => !item.pinBottom),
  );

  protected readonly bottomNavItems = computed(() =>
    this.allowedItems().filter(item => item.pinBottom),
  );

  protected isExpanded(item: NavItem): boolean {
    const state = this.userState().get(item.label);
    if (state) return state === 'open';
    const url = this.currentUrl();
    return item.children?.some(c => !!c.route && url.startsWith(c.route)) ?? false;
  }

  protected safeIcon(icon: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(icon);
  }

  protected onMobileOverlayClick(): void {
    this.layout.closeMobile();
  }

  protected onNavClick(): void {
    if (this.layout.isMobile()) {
      this.layout.closeMobile();
    }
  }

  protected onParentClick(item: NavItem): void {
    if (this.layout.isCollapsed() && !this.layout.isMobile()) {
      this.layout.isCollapsed.set(false);
    }
    const currentlyOpen = this.isExpanded(item);
    this.userState.update(prev => {
      const next = new Map(prev);
      next.set(item.label, currentlyOpen ? 'closed' : 'open');
      return next;
    });
  }

  protected onSelectTenant(tenant: Tenant): void {
    this.layout.selectTenant(tenant);
  }

  protected trackByKey(_index: number, item: NavItem): string {
    return item.route ?? item.label;
  }

  protected trackByTenantId(_index: number, item: Tenant): string {
    return item.id;
  }
}
