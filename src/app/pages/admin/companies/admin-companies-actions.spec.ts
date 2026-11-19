import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminCompanies } from './admin-companies';
import { AdminCompaniesService } from '../admin-companies.service';
import { AdminSegmentsService } from '../segments/admin-segments.service';
import { ContactRevealActions } from '../contact/contact-reveal-actions';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import type { AdminCompanyListItem } from '../../../types/admin-company.types';
import type { AdminCapabilityCode } from '../../../types/admin-roles.types';
import type { CompanyEngagement } from '../../../types/admin-segments.types';

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * Empresas, 18/11/2026: o ⋮ da linha tem WhatsApp com mensagem pronta, Registrar contato,
 * Estender/Reabrir teste (só em teste) e Ver detalhe — e mais nada. Cada item obedece à
 * capacidade do admin (falha fechada).
 */
describe('AdminCompanies — ⋮ da linha', () => {
  const ENGAGEMENT: CompanyEngagement = {
    segment: 'TRIAL_STALLED',
    segmentReasons: ['NO_RECENT_SIGNAL'],
    recent: null,
    progress: 'SIGNUP_ONLY',
    lastAction: null,
    lastAccessAt: null,
    lastSignalAt: null,
    deadline: { kind: 'TRIAL_ENDS', at: '2030-01-10T12:00:00Z' },
    fleet: { vehicles: 0, drivers: 0, rentals: 0, activeRentals: 0 },
    openSupportTickets: 0,
    retentionEmailOptOut: false,
    nextAction: { key: 'HELP_FIRST_VEHICLE', reason: 'NO_RECENT_SIGNAL' },
    lastContact: null,
    today: { status: 'LISTED', listedReason: 'SEGMENT', hiddenUntil: null },
  };

  const COMPANY: AdminCompanyListItem = {
    id: 'co-1',
    name: 'Locadora Alpha',
    documentMasked: null,
    planCode: 'TRIAL_MONTHLY',
    planName: 'Teste',
    subscriptionStatus: 'TRIALING',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    active: true,
    memberCount: 1,
    createdAt: null,
    internal: false,
    ownerName: 'Ana Souza',
    trialEndsAt: '2030-01-10T12:00:00',
    engagement: ENGAGEMENT,
  };

  let caps: Set<AdminCapabilityCode>;
  let whatsApp: ReturnType<typeof vi.fn>;
  let rows: ReturnType<typeof signal<AdminCompanyListItem[]>>;

  function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanies],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: AdminCompaniesService,
          useValue: {
            companies: rows,
            loading: signal(false),
            total: signal(1),
            segmentCounts: signal({}),
            load: vi.fn().mockReturnValue(of({})),
            patchEngagement: vi.fn(),
          },
        },
        { provide: AdminSegmentsService, useValue: { today: () => of(null), registerContact: vi.fn() } },
        { provide: ContactRevealActions, useValue: { whatsApp, call: vi.fn(), copy: vi.fn() } },
        { provide: AdminCapabilitiesService, useValue: { ensureLoaded: () => of(null), can: (c: AdminCapabilityCode) => caps.has(c) } },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AdminCompanies);
    fixture.detectChanges();
    return fixture;
  }

  function openRowMenu(fixture: ReturnType<typeof render>): HTMLElement {
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector('button[aria-label="Ações da empresa Locadora Alpha"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    return host.querySelector('[role="menu"]') as HTMLElement;
  }

  beforeEach(() => {
    caps = new Set<AdminCapabilityCode>(['ver', 'contato.ver', 'empresa.teste']);
    whatsApp = vi.fn().mockResolvedValue(undefined);
    rows = signal([COMPANY]);
  });

  it('em teste: WhatsApp, Registrar contato, Estender teste e Ver detalhe, nessa ordem', () => {
    const menu = openRowMenu(render());
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((i) => text(i));
    expect(items).toHaveLength(4);
    expect(items[0]).toContain('WhatsApp com mensagem pronta');
    expect(items[0]).toContain('Posso te mostrar em 5 minutos');
    expect(items[1]).toContain('Registrar contato');
    expect(items[2]).toBe('Estender teste');
    expect(items[3]).toContain('Ver detalhe');
    expect(menu.textContent).not.toContain('Suspender');
  });

  it('vencido sem ativação: "Reabrir teste"; pagante não tem a opção', () => {
    rows.set([{ ...COMPANY, engagement: { ...ENGAGEMENT, segment: 'NO_ACTIVATION' } }]);
    expect(text(openRowMenu(render()))).toContain('Reabrir teste');
    rows.set([{ ...COMPANY, engagement: { ...ENGAGEMENT, segment: 'PAYING_ACTIVE' } }]);
    expect(text(openRowMenu(render()))).not.toContain('teste');
  });

  it('WhatsApp revela o telefone do dono (auditado) com a mensagem pronta do segmento', () => {
    const fixture = render();
    const menu = openRowMenu(fixture);
    (menu.querySelector('[data-testid="menu-whatsapp"]') as HTMLButtonElement).click();
    expect(whatsApp).toHaveBeenCalledWith(
      'COMPANY',
      'co-1',
      'Olá, Ana! Aqui é da equipe MyCarsHub. Posso te mostrar em 5 minutos como cadastrar o primeiro carro?',
    );
  });

  it('Registrar contato abre a folha da empresa', () => {
    const fixture = render();
    (openRowMenu(fixture).querySelector('[data-testid="menu-contact"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const sheet = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="register-contact-sheet"]');
    expect(sheet).not.toBeNull();
    expect(sheet?.textContent).toContain('Locadora Alpha');
  });

  it('sem contato.ver nem empresa.teste: só Ver detalhe', () => {
    caps = new Set<AdminCapabilityCode>(['ver']);
    const items = Array.from(openRowMenu(render()).querySelectorAll('[role="menuitem"]'));
    expect(items).toHaveLength(1);
    expect(text(items[0])).toContain('Ver detalhe');
  });
});
