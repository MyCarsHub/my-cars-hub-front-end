import { computed, Injectable, signal } from '@angular/core';

export interface Tenant {
  id: string;
  name: string;
  role: string;
  initial: string;
}

const DEFAULT_TENANTS: Tenant[] = [
  { id: '1', name: 'Transportes ABC', role: 'Dono', initial: 'T' },
  { id: '2', name: 'Logística XYZ', role: 'Driver', initial: 'L' },
  { id: '3', name: 'Frota Pessoal', role: 'Dono', initial: 'F' },
];

@Injectable({ providedIn: 'root' })
export class LayoutStore {
  /** Whether the sidebar is collapsed (desktop only) */
  readonly isCollapsed = signal(false);

  /** Whether the mobile drawer is open */
  readonly isMobileOpen = signal(false);

  /** Whether the tenant dropdown is open */
  readonly isTenantOpen = signal(false);

  /** Whether the viewport is mobile-sized */
  readonly isMobile = signal(false);

  /** Available tenants */
  readonly tenants = signal<Tenant[]>(DEFAULT_TENANTS);

  /** Currently selected tenant */
  readonly selectedTenant = signal<Tenant>(DEFAULT_TENANTS[0]);

  /** Current sidebar width token for animations */
  readonly sidebarWidth = computed(() => (this.isCollapsed() ? '72px' : '260px'));

  toggleCollapse(): void {
    this.isCollapsed.update((v) => !v);
  }

  openMobile(): void {
    this.isMobileOpen.set(true);
  }

  closeMobile(): void {
    this.isMobileOpen.set(false);
  }

  toggleMobile(): void {
    this.isMobileOpen.update((v) => !v);
  }

  toggleTenant(): void {
    this.isTenantOpen.update((v) => !v);
  }

  closeTenant(): void {
    this.isTenantOpen.set(false);
  }

  selectTenant(tenant: Tenant): void {
    this.selectedTenant.set(tenant);
    this.isTenantOpen.set(false);
  }

  setMobile(isMobile: boolean): void {
    this.isMobile.set(isMobile);
    if (!isMobile) {
      this.isMobileOpen.set(false);
    }
  }
}