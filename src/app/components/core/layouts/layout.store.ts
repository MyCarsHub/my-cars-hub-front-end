import { computed, Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';

export interface Tenant {
  id: string;
  name: string;
  role: string;
  initial: string;
}

function loadTenantsFromStorage(): Tenant[] {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return [];
  try {
    const stored = sessionStorage.getItem('userCompanies');
    if (stored) {
      const companies = JSON.parse(stored) as any[];
      return companies.map(c => ({
        id: c.companyId,
        name: c.companyName,
        role: c.role,
        initial: c.companyName ? c.companyName.charAt(0).toUpperCase() : 'C'
      }));
    }
  } catch (e) {
    console.error('Failed to parse userCompanies', e);
  }
  return [];
}

const FALLBACK_TENANT: Tenant = { id: '', name: 'Sem Empresa', role: '', initial: '-' };

function loadSelectedTenantFromStorage(tenants: Tenant[]): Tenant {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return FALLBACK_TENANT;
  const selectedId = sessionStorage.getItem('selectedCompanyId');
  if (selectedId) {
    const found = tenants.find(t => t.id === selectedId);
    if (found) return found;
  }
  return tenants.length > 0 ? tenants[0] : FALLBACK_TENANT;
}

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
  readonly tenants = signal<Tenant[]>(loadTenantsFromStorage());

  /** Currently selected tenant */
  readonly selectedTenant = signal<Tenant>(loadSelectedTenantFromStorage(loadTenantsFromStorage()));

  private readonly router = inject(Router);

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
    
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('selectedCompanyId', tenant.id);
      sessionStorage.setItem('selectedCompanyName', tenant.name);
      sessionStorage.setItem('selectedRole', tenant.role);
    }
    
    this.router.navigate(['/dashboard']);
  }

  refreshTenants(): void {
    const newTenants = loadTenantsFromStorage();
    this.tenants.set(newTenants);
    this.selectedTenant.set(loadSelectedTenantFromStorage(newTenants));
  }

  setMobile(isMobile: boolean): void {
    this.isMobile.set(isMobile);
    if (!isMobile) {
      this.isMobileOpen.set(false);
    }
  }
}