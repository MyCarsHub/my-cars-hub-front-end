import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DashboardHome } from './dashboard-home';
import { BillingAccessService } from '../../services/billing-access.service';
import { DashboardService } from '../../services/dashboard.service';
import { FleetActivationService } from '../../services/fleet-activation.service';
import { SessionService } from '../../services/session.service';

/**
 * Production bug (2026-11-06): on a hard reload the board had ONE child in the chart row (the chart
 * card waits for data), so the calendar took the whole row and its aspect-square cells grew to
 * ~205px. Every slot now holds a placeholder while loading, and the calendar caps its own cells.
 */
vi.setConfig({ testTimeout: 30000 });

function render(overview: unknown): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [DashboardHome],
    providers: [
      provideRouter([]),
      provideNoopAnimations(),
      {
        provide: DashboardService,
        useValue: {
          loadOverview: vi.fn().mockReturnValue(overview),
          loadCashAccumulation: vi.fn().mockReturnValue(NEVER),
        },
      },
      { provide: BillingAccessService, useValue: { status: signal(null) } },
      { provide: FleetActivationService, useValue: { hasVehicles: vi.fn().mockReturnValue(of(true)) } },
      {
        provide: SessionService,
        useValue: { getItem: () => 'OWNER', isPlatformAdmin: () => false, getCompanyRoleFromToken: () => 'OWNER' },
      },
    ],
  });
  const fixture = TestBed.createComponent(DashboardHome);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('DashboardHome — loading layout', () => {
  it('while loading, every board slot has a placeholder (no card is missing from its slot)', () => {
    const host = render(NEVER);
    expect(host.querySelectorAll('[data-chart-skeleton]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-ring-skeleton]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-money-skeleton]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-cash-skeleton]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-ranking-skeleton]')).toHaveLength(2);
    // same two-column chart row as the loaded page: the calendar is NOT alone on the row
    expect(host.querySelector('[data-result-section]')!.className).toContain('xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]');
    expect(host.querySelector('[data-result-section]')!.children).toHaveLength(2);
    expect(host.querySelector('[data-distributions]')!.className).toContain('xl:col-span-8');
  });

  it('KPI cards keep their value slot while loading', () => {
    const host = render(NEVER);
    expect(host.querySelectorAll('[data-kpi-grid] > *')).toHaveLength(6);
    expect(host.querySelectorAll('[data-kpi-grid] .animate-pulse').length).toBeGreaterThanOrEqual(6);
  });

  it('the calendar caps its own width, so square cells stay compact on any card width', () => {
    const host = render(NEVER);
    const board = host.querySelector('[data-calendar-board]')!;
    expect(board.className).toContain('max-w-[23rem]');
    expect(board.className).toContain('mx-auto');
    expect(board.querySelector('button')!.className).toContain('aspect-square');
  });

  it('when the summary fails the placeholders go away and the calendar is still capped', () => {
    const host = render(throwError(() => ({ error: { message: 'boom' } })));
    expect(host.querySelectorAll('[data-chart-skeleton]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-ring-skeleton]')).toHaveLength(0);
    expect(host.querySelector('[data-calendar-board]')!.className).toContain('max-w-[23rem]');
  });
});

describe('DashboardHome — row of four cards', () => {
  it('every header is either one truncated line or a reserved two-line slot, so the bodies below start at the same height', () => {
    const host = render(NEVER);
    const titles = Array.from(host.querySelectorAll('[data-board] app-card-skeleton h2'));
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) {
      expect(t.className.includes('truncate') || t.className.includes('md:min-h-12')).toBe(true);
    }
  });

  it('the money, vehicle and driver cards of the last row reserve two lines and wrap instead of an ellipsis', () => {
    const host = render(NEVER);
    for (const sel of ['[data-money-skeleton]', '[data-ranking-skeleton]']) {
      const cards = Array.from(host.querySelectorAll(sel));
      expect(cards.length).toBeGreaterThan(0);
      for (const c of cards) {
        const h2 = c.querySelector('h2')!;
        expect(h2.className).toContain('md:min-h-12');
        expect(h2.className).not.toContain('truncate');
      }
    }
  });
});

describe('DashboardHome — quick actions on a phone', () => {
  it('is a real 2x2 grid below sm (class grid-cols-2, not a min-width variant), tiles truncate', () => {
    const host = render(NEVER);
    const grid = host.querySelector('[data-quick-actions]')!;
    expect(grid.className.split(/\s+/)).toContain('grid-cols-2');
    expect(grid.className).not.toContain('grid-cols-1');
    for (const a of Array.from(grid.querySelectorAll('app-quick-action-card a'))) {
      expect(a.className.split(/\s+/)).toContain('flex-col');
      expect(a.querySelector('.truncate')).not.toBeNull();
    }
  });
});
