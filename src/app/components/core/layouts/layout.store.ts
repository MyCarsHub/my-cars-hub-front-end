import { computed, Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from '../../../services/session.service';

export interface Tenant {
  id: string;
  name: string;
  role: string;
  initial: string;
}

const FALLBACK_TENANT: Tenant = { id: '', name: 'Sem Empresa', role: '', initial: '-' };

@Injectable({ providedIn: 'root' })
export class LayoutStore {
  private readonly router = inject(Router);
  private readonly sessionService = inject(SessionService);

  /** Whether the sidebar is collapsed (desktop only) */
  readonly isCollapsed = signal(false);

  /** Whether the mobile drawer is open */
  readonly isMobileOpen = signal(false);

  /** Whether the tenant dropdown is open */
  readonly isTenantOpen = signal(false);

  /** Whether the viewport is mobile-sized */
  readonly isMobile = signal(false);

  /** Available tenants */
  readonly tenants = signal<Tenant[]>(this.loadTenantsFromStorage());

  /** Currently selected tenant */
  readonly selectedTenant = signal<Tenant>(this.loadSelectedTenantFromStorage(this.tenants()));

  /** Current sidebar width token for animations */
  readonly sidebarWidth = computed(() => (this.isCollapsed() ? '72px' : '260px'));

  private loadTenantsFromStorage(): Tenant[] {
    try {
      const stored = this.sessionService.getItem('userCompanies');
      if (stored) {
        const companies = JSON.parse(stored) as any[];
        return companies.map(c => ({
          id: c.companyId,
          name: c.companyName,
          role: c.role,
          initial: c.companyName ? c.companyName.charAt(0).toUpperCase() : 'C'
        }));
      }
    } catch {
      // fail silent: corrupted userCompanies falls back to empty tenant list
    }
    return [];
  }

  private loadSelectedTenantFromStorage(tenants: Tenant[]): Tenant {
    const selectedId = this.sessionService.getItem('selectedCompanyId');
    if (selectedId) {
      const found = tenants.find(t => t.id === selectedId);
      if (found) return found;
    }
    return tenants.length > 0 ? tenants[0] : FALLBACK_TENANT;
  }

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
    
    this.sessionService.setItem('selectedCompanyId', tenant.id);
    this.sessionService.setItem('selectedCompanyName', tenant.name);
    this.sessionService.setItem('selectedRole', tenant.role);
    
    this.router.navigate(['/dashboard']);
  }

  refreshTenants(): void {
    const newTenants = this.loadTenantsFromStorage();
    this.tenants.set(newTenants);
    this.selectedTenant.set(this.loadSelectedTenantFromStorage(newTenants));
  }

  setMobile(isMobile: boolean): void {
    this.isMobile.set(isMobile);
    if (!isMobile) {
      this.isMobileOpen.set(false);
    }
  }
}