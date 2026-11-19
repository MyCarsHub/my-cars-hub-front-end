import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminCompanies } from './admin-companies';
import { AdminCompanyDetail } from './admin-company-detail';
import { revealDetail } from './company-detail.testing';
import { AdminTrialConversion } from './admin-trial-conversion';
import { AdminCompaniesService } from '../admin-companies.service';
import { AdminChargesService } from '../charges/admin-charges.service';
import { AdminContactService } from '../contact/admin-contact.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { AdminSegmentsService } from '../segments/admin-segments.service';
import type {
  AdminCompanyDetail as AdminCompanyDetailDto,
  AdminCompanyListItem,
} from '../../../types/admin-company.types';
import type { TrialConversionItem } from '../../../types/admin-charges.types';

/**
 * Padrão de lista da plataforma (auditoria 18/11/2026 §2.4–§2.6): abas em pílula, cartão "Lista",
 * busca + pílulas de situação + select de plano, chips só com cor de situação, sem linhas,
 * diálogo de suspender da plataforma com campo de 16px.
 */
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const NOTIFY = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), push: vi.fn() };

describe('Empresas (lista) — padrão da plataforma', () => {
  const COMPANY: AdminCompanyListItem = {
    id: 'co-1',
    name: 'Locadora Alpha',
    documentMasked: null,
    planCode: 'PRO_MONTHLY',
    planName: 'Pro',
    subscriptionStatus: 'ACTIVE',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    active: true,
    memberCount: 3,
    createdAt: null,
    internal: true,
  };

  let load: ReturnType<typeof vi.fn>;
  let total: ReturnType<typeof signal<number>>;

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
            companies: signal([COMPANY]),
            loading: signal(false),
            total,
            segmentCounts: signal({ ALL: 42, PAYING_ACTIVE: 3, EX_CLIENT: 0 }),
            load,
            patchEngagement: vi.fn(),
          },
        },
        { provide: AdminSegmentsService, useValue: { today: () => of(null) } },
        { provide: AdminCapabilitiesService, useValue: { ensureLoaded: () => of(null), can: () => true } },
        { provide: NotificationService, useValue: NOTIFY },
      ],
    });
    const fixture = TestBed.createComponent(AdminCompanies);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    load = vi.fn().mockReturnValue(of({}));
    total = signal(1);
  });

  it('cartão "Lista", pílulas de segmento no lugar das abas, "Todas" marcada, contagem de resultados', () => {
    const host = render().nativeElement as HTMLElement;
    expect(host.textContent).toContain('Lista');
    expect(host.querySelector('[data-testid="tab-convert"]')).toBeNull();
    const pills = Array.from(host.querySelectorAll('app-list-toolbar [role="radio"]'));
    expect(text(pills[0])).toBe('Todas 42');
    expect(pills[0].getAttribute('aria-checked')).toBe('true');
    // Zero continua visível.
    expect(pills.map(text)).toContain('Ex-cliente 0');
    expect(text(host.querySelector('[data-list-results]'))).toBe('1 empresa');
  });

  it('a pílula filtra no servidor; "Limpar filtros" volta para "Todas"', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ segment: null, internal: false, page: 0 }));
    const pill = Array.from(host.querySelectorAll('app-list-toolbar [role="radio"]')).find((b) =>
      text(b).startsWith('Pagante ativo'),
    ) as HTMLButtonElement;
    pill.click();
    fixture.detectChanges();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ segment: 'PAYING_ACTIVE', page: 0 }));

    (host.querySelector('[data-list-clear]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ segment: null, search: '' }));
  });

  it('chip "Interna" é neutro; nenhuma bolinha', () => {
    const host = render().nativeElement as HTMLElement;
    const badge = host.querySelector('[data-testid="internal-badge"]') as HTMLElement;
    expect(badge.className).toContain('bg-surface-sunken');
    expect(badge.className).not.toContain('blue');
    expect(host.querySelector('[class*="rounded-full"][class*="size-2"], [class*="w-2 h-2"]')).toBeNull();
  });

  it('paginação no rodapé da lista, com o total de empresas', () => {
    total = signal(45);
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;
    expect(text(host.querySelector('[data-pager-text]'))).toBe('45 empresas · página 1 de 3');
    (host.querySelector('[data-page-next]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
  });
});

describe('Converter testes — padrão da plataforma', () => {
  const ITEM: TrialConversionItem = {
    companyId: 'co-9',
    companyName: 'Frota Exemplo',
    companyStatus: 'ACTIVE',
    internal: false,
    signupAt: '2026-09-01T10:00:00',
    trialEndsAt: '2026-10-20T10:00:00',
    daysSinceTrialEnd: 8,
    subscriptionStatus: 'TRIALING',
    planName: 'Pro',
    vehicles: 2,
    drivers: 1,
    rentals: 0,
    lastSeenAt: null,
    lastLoginAt: '2026-10-25T09:00:00',
    activationStage: 2,
    ownerUserId: 'usr-9',
    ownerName: 'Maria Dona Exemplo',
    ownerPhoneMasked: '(21) •••••-1234',
  };
  const OTHER: TrialConversionItem = { ...ITEM, companyId: 'co-8', companyName: 'Auto Beta', ownerName: 'João' };

  let trialConversion: ReturnType<typeof vi.fn>;

  function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminTrialConversion],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        { provide: AdminChargesService, useValue: { trialConversion } },
        { provide: AdminContactService, useValue: { reveal: vi.fn() } },
        { provide: NotificationService, useValue: NOTIFY },
      ],
    });
    const fixture = TestBed.createComponent(AdminTrialConversion);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    trialConversion = vi.fn().mockReturnValue(of([ITEM, OTHER]));
  });

  it('lista no app-data-list, sinais em texto corrido, estágio em chip, explica a ordem', () => {
    const host = render().nativeElement as HTMLElement;
    expect(trialConversion).toHaveBeenCalledWith(false);
    const row = host.querySelector('[data-row]') as HTMLElement;
    expect(text(row)).toContain('Frota Exemplo');
    expect(text(row)).toContain('Cadastrou motorista');
    expect(text(row)).toContain('Teste acabou há 8 dias · cadastro em 01/09/2026');
    expect(text(row)).toContain('(21) •••••-1234');
    expect(text(row.querySelector('[data-testid="signals"]'))).toBe('2 veículos · 1 motorista · 0 aluguéis');
    expect(text(host.querySelector('[data-testid="order-explainer"]'))).toContain('Até onde chegou');
    // Sem contorno: nada de borda no explicador nem pílulas contornadas nos sinais.
    expect(host.querySelector('[data-testid="order-explainer"]')?.className).not.toContain('border');
    expect(host.querySelector('[data-testid="tab-convert"]')?.getAttribute('aria-checked')).toBe('true');
    expect(text(host.querySelector('[data-list-results]'))).toBe('2 empresas');
  });

  it('busca local por empresa ou dono, sem acento, na ordem do servidor', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector('[data-list-search]') as HTMLInputElement;
    input.value = 'joao';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.querySelectorAll('[data-row]').length).toBe(1);
    expect(text(host.querySelector('[data-row]'))).toContain('Auto Beta');
    expect(trialConversion).toHaveBeenCalledTimes(1);

    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(text(host.querySelector('[data-empty-text]'))).toBe('Nenhuma empresa com essa busca.');
  });

  it('"Incluir empresas internas" recarrega do servidor', () => {
    const fixture = render();
    const toggle = fixture.nativeElement.querySelector('[data-testid="toggle-internal"]') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(trialConversion).toHaveBeenLastCalledWith(true);
  });

  it('a mensagem pré-preenchida é curta, em pt-BR, com o primeiro nome e a empresa', () => {
    const fixture = render();
    const msg = (fixture.componentInstance as unknown as { whatsAppText(i: TrialConversionItem): string })
      .whatsAppText(ITEM);
    expect(msg.startsWith('Olá, Maria!')).toBe(true);
    expect(msg).toContain('Frota Exemplo');
    expect(msg).toContain('terminou');
    expect(msg).toContain('Posso te ajudar');
    expect(msg.length).toBeLessThan(200);
  });
});

describe('Detalhe da empresa — padrão da plataforma', () => {
  const COMPANY: AdminCompanyDetailDto = {
    id: 'co-1',
    name: 'Locadora Alfa',
    documentMasked: null,
    status: 'ACTIVE',
    active: true,
    createdAt: '2025-01-01T00:00:00Z',
    modifiedAt: null,
    subscription: {
      id: 'sub-1',
      planCode: 'PRO_MONTHLY',
      planName: 'Pro',
      status: 'ACTIVE',
      billingCycle: 'MONTHLY',
      gateway: 'STRIPE',
      externalIdMasked: 'sub_***9',
      trialEndsAt: null,
      currentPeriodStart: '2026-11-01',
      currentPeriodEnd: '2026-11-30',
      nextBillingDate: '2026-12-01',
      cancelAtPeriodEnd: false,
    },
    members: [
      { userId: 'u-1', name: 'Dona Ana', email: 'ana@alfa.com', role: 'OWNER', status: 'ACTIVE', lastSeenAt: null },
      { userId: 'u-2', name: 'Gil Gerente', email: 'gil@alfa.com', role: 'MANAGER', status: 'INVITED', lastSeenAt: null },
    ],
    chargeIntegration: null,
    registration: {
      phone: null,
      email: null,
      addressStreet: null,
      addressNumber: null,
      addressComplement: null,
      addressDistrict: null,
      addressCep: null,
      addressCity: null,
      addressUf: null,
      representativeName: null,
      representativeRole: null,
    },
    internal: false,
  } as AdminCompanyDetailDto;

  let updateStatus: ReturnType<typeof vi.fn>;

  function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanyDetail],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'co-1' })) } },
        {
          provide: AdminCompaniesService,
          useValue: {
            detail: signal(COMPANY),
            detailLoading: signal(false),
            statusUpdating: signal(false),
            internalUpdating: signal(false),
            loadDetail: vi.fn().mockReturnValue(of(COMPANY)),
            updateStatus,
            clearDetail: vi.fn(),
          },
        },
        {
          provide: AdminCapabilitiesService,
          useValue: { ensureLoaded: () => of(void 0), can: () => true },
        },
        { provide: AdminContactService, useValue: { reveal: vi.fn() } },
        { provide: AdminSegmentsService, useValue: { activity: vi.fn() } },
        { provide: NotificationService, useValue: NOTIFY },
        { provide: ImpersonationService, useValue: { start: vi.fn(), active: () => false } },
      ],
    });
    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();
    revealDetail(fixture);
    return fixture;
  }

  beforeEach(() => {
    updateStatus = vi.fn().mockReturnValue(of({ active: false }));
  });

  it('sem caixa alta e sem linha entre informações', () => {
    const host = render().nativeElement as HTMLElement;
    // O rótulo pequeno em caixa alta do KPI é do próprio componente (padrão do tenant).
    const upper = Array.from(host.querySelectorAll('.uppercase')).filter(
      (el) => !el.closest('[data-tile]') && !el.closest('[role="menu"]'),
    );
    expect(upper).toEqual([]);
    expect(host.querySelector('[class*="divide-"]')).toBeNull();
    expect(host.querySelector('[class*="border-b"], [class*="border-t"]')).toBeNull();
    expect(host.querySelectorAll('dl[appKvList]').length).toBeGreaterThan(0);
  });

  it('situação e período legíveis: chip da plataforma e "dd/mm/aaaa a dd/mm/aaaa"', () => {
    const host = render().nativeElement as HTMLElement;
    // Empresa ativa não ganha chip de situação no topo (só suspensa/cancelada); a assinatura tem o dela.
    expect(host.querySelector('[data-testid="company-status"]')).toBeNull();
    expect(text(host.querySelector('[data-testid="subscription-status"]'))).toBe('Ativa');
    expect(text(host.querySelector('[data-testid="current-period"]'))).toBe('01/11/2026 a 30/11/2026');
  });

  it('membros no app-data-list: papel neutro, vínculo em português com cor', () => {
    const host = render().nativeElement as HTMLElement;
    const rows = Array.from(host.querySelectorAll('[data-row]'));
    expect(rows.length).toBe(2);
    expect(text(rows[1])).toContain('Gerenciador');
    expect(text(rows[1])).toContain('Convidado');
    expect(text(rows[1])).not.toContain('INVITED');
    const chips = Array.from(rows[1].querySelectorAll('app-status-chip')) as HTMLElement[];
    const role = chips.find((c) => text(c) === 'Gerenciador')!;
    const status = chips.find((c) => text(c) === 'Convidado')!;
    expect(role.className).toContain('bg-surface-sunken');
    expect(status.className).toContain('blue');
  });

  it('suspender usa o diálogo da plataforma, campo de 16px, e exige a palavra', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;
    // Toda ação mora no ⋮ do topo (o ajudante já o abriu).
    (host.querySelector('[data-testid="action-suspend"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const dialog = host.querySelector('app-confirm-dialog [role="dialog"]');
    expect(dialog).not.toBeNull();
    const input = host.querySelector('[data-testid="suspend-confirm-input"]') as HTMLInputElement;
    expect(input.className).toContain('text-base');

    const confirm = Array.from(dialog!.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Suspender',
    )!;
    confirm.click();
    fixture.detectChanges();
    expect(updateStatus).not.toHaveBeenCalled();
    expect(text(dialog!.querySelector('app-alert-banner'))).toContain('SUSPENDER');

    input.value = 'suspender';
    input.dispatchEvent(new Event('input'));
    confirm.click();
    expect(updateStatus).toHaveBeenCalledWith('co-1', false);
  });
});
