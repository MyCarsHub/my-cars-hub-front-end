import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCompanyDetail } from './admin-company-detail';
import { openDetailMenu } from './company-detail.testing';
import { AdminCompaniesService } from '../admin-companies.service';
import { AdminSegmentsService } from '../segments/admin-segments.service';
import { ContactRevealActions } from '../contact/contact-reveal-actions';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import { NotificationService } from '../../../services/notification.service';
import type { AdminCompanyDetail as Dto } from '../../../types/admin-company.types';
import type { CompanyEngagement } from '../../../types/admin-segments.types';

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * Detalhe da empresa, rodada de 18/11/2026: segmento no topo, "Próxima ação" com o motivo e a
 * mensagem pronta, atividade, operação compacta e TODA ação no ⋮ do topo.
 */
describe('AdminCompanyDetail — segmento, próxima ação e ⋮', () => {
  const ENGAGEMENT: CompanyEngagement = {
    segment: 'PAYING_ACTIVE',
    segmentReasons: [],
    recent: null,
    progress: 'RENTAL',
    lastAction: { kind: 'CHARGE_CANCELED', at: '2026-11-05T18:41:00Z' },
    lastAccessAt: '2026-11-16T13:20:00Z',
    lastSignalAt: '2026-11-16T13:20:00Z',
    deadline: { kind: 'RENEWAL', at: '2099-11-30T12:00:00Z' },
    fleet: { vehicles: 6, drivers: 7, rentals: 5, activeRentals: 5 },
    openSupportTickets: 2,
    retentionEmailOptOut: false,
    nextAction: { key: 'CHECK_IN', reason: 'NONE' },
    lastContact: {
      id: 'k',
      contactedAt: '2026-11-13T14:00:00Z',
      channel: 'WHATSAPP',
      result: 'NO_ANSWER',
      followUpDate: '2026-11-20',
      createdByName: 'Lorran',
    },
    today: { status: 'HIDDEN_UNTIL_DATE', listedReason: null, hiddenUntil: '2026-11-20' },
  };

  const COMPANY: Dto = {
    id: 'co-1',
    name: 'Facilita Locadora',
    documentMasked: null,
    status: 'ACTIVE',
    active: true,
    createdAt: '2026-09-24T10:00:00Z',
    modifiedAt: null,
    subscription: null,
    members: [
      { userId: 'u-1', name: 'Fabi Dona', email: 'f@x.com', role: 'OWNER', status: 'ACTIVE', phoneMasked: '(11) •••••-4321' },
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
    operations: {
      rentals: { total: 5, activeTotal: 5, closedTotal: 5, closedAmountCents: 1, completedTotal: 0, completedAmountCents: 0, canceledTotal: 0, paidAmountCents: 1 },
      contracts: { total: 5, generatedTotal: 5, signedTotal: 0 },
      vehicles: { total: 6, activeTotal: 6 },
      drivers: { total: 7, workingTotal: 5 },
      fines: { total: 0, pendingTotal: 0, amountCents: 0 },
      maintenances: { total: 0, costCents: 0 },
      sales: { sales: [], undos: [] },
    },
    internal: false,
    engagement: ENGAGEMENT,
    activity: {
      content: [
        {
          at: '2026-11-13T14:00:00Z',
          category: 'CONTACT',
          kind: 'CONTACT_LOGGED',
          count: 1,
          contact: { id: 'k', contactedAt: '2026-11-13T14:00:00Z', channel: 'WHATSAPP', result: 'NO_ANSWER', note: null, followUpDate: '2026-11-20', createdByName: 'Lorran' },
          subscription: null,
        },
      ],
      page: 0,
      size: 20,
      total: 1,
    },
  };

  let whatsApp: ReturnType<typeof vi.fn>;
  let activity: ReturnType<typeof vi.fn>;

  function render(company: Dto = COMPANY) {
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
            detail: signal(company),
            detailLoading: signal(false),
            statusUpdating: signal(false),
            internalUpdating: signal(false),
            loadDetail: vi.fn().mockReturnValue(of(company)),
            updateStatus: vi.fn(),
            updateInternal: vi.fn().mockReturnValue(of(company)),
            patchEngagement: vi.fn(),
            clearDetail: vi.fn(),
          },
        },
        { provide: AdminSegmentsService, useValue: { activity, registerContact: vi.fn() } },
        { provide: ContactRevealActions, useValue: { whatsApp, call: vi.fn(), copy: vi.fn() } },
        { provide: AdminCapabilitiesService, useValue: { ensureLoaded: () => of(null), can: () => true } },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } },
        { provide: ImpersonationService, useValue: { start: vi.fn(), startEdit: vi.fn(), active: () => false } },
      ],
    });
    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    // Relógio fixo: as datas da tela dependem do ano corrente (o ano só aparece fora dele).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T19:40:00Z'));
    whatsApp = vi.fn().mockResolvedValue(undefined);
    activity = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));
  });

  it('título é a empresa, com o chip do segmento e sem botão de ação solto na página', () => {
    const host = render().nativeElement as HTMLElement;
    expect(text(host.querySelector('h1'))).toBe('Facilita Locadora');
    expect(text(host.querySelector('[data-testid="segment-chip"]'))).toBe('Pagante ativo');
    // Fora do ⋮, nenhum botão de ação: só o próprio ⋮, filtros, recolher e "ver tudo".
    const loose = Array.from(host.querySelectorAll('button')).filter(
      (b) =>
        !b.closest('app-actions-menu') &&
        !b.closest('app-filter-chip-group') &&
        !b.closest('app-page-card header, [aria-label^="Expandir"], [aria-label^="Recolher"]') &&
        !b.getAttribute('aria-label')?.match(/^(Expandir|Recolher)/) &&
        b.getAttribute('data-testid') !== 'operations-toggle' &&
        !b.closest('app-bar-chart'),
    );
    expect(loose.map((b) => text(b))).toEqual([]);
  });

  afterEach(() => vi.useRealTimers());

  it('renovação de outro ano leva o ano no topo e no chip "até" (sem ele, lê como passada)', () => {
    const host = render().nativeElement as HTMLElement;
    expect(text(host)).toContain('renova em 30/11/2099');
    expect(text(host)).not.toMatch(/renova em 30\/11(?!\/)/);
  });

  it('a nota da Atividade não aponta para um "Ver na auditoria" que não existe', () => {
    const host = render().nativeElement as HTMLElement;
    expect(text(host)).toContain('Fora desta lista: o que a equipe fez na conta');
    expect(text(host)).not.toContain('Ver na auditoria');
  });

  it('Próxima ação: frase, por quê, mensagem pronta e o efeito do último contato', () => {
    const host = render().nativeElement as HTMLElement;
    expect(text(host.querySelector('[data-testid="next-action-title"]'))).toBe('Nada urgente: perguntar como está indo');
    expect(text(host.querySelector('[data-testid="next-action-why"]'))).toBe('2 chamados de suporte abertos');
    expect(text(host.querySelector('[data-testid="next-action-message"]'))).toContain(
      'Olá, Fabi! Aqui é da equipe MyCarsHub. Como está indo com o MyCarsHub na Facilita Locadora?',
    );
    expect(text(host.querySelector('[data-testid="next-action-contact"]'))).toBe(
      'Contato em 13/11, WhatsApp, sem resposta · retorno em 20/11. Até 20/11 ela fica fora de “Hoje, para agir”.',
    );
  });

  it('o ⋮ do topo: conversa primeiro (WhatsApp, Registrar contato, Estender teste apagado), depois conta', () => {
    const fixture = render();
    openDetailMenu(fixture);
    const items = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[role="menu"] [role="menuitem"]'));
    const labels = items.map((i) => text(i));
    expect(labels[0]).toContain('WhatsApp com mensagem pronta');
    expect(labels[1]).toContain('Registrar contato');
    expect(labels[2]).toContain('Estender teste');
    expect((items[2] as HTMLButtonElement).disabled).toBe(true);
    expect(labels.some((l) => l.includes('Ver como dono'))).toBe(true);
    expect(labels.some((l) => l.includes('Editar como empresa'))).toBe(true);
    expect(labels.some((l) => l.includes('Criar cupom'))).toBe(true);
    expect(labels[labels.length - 1]).toContain('Suspender empresa');
  });

  it('WhatsApp revela o número do dono com a mensagem pronta; Registrar contato abre a folha', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;
    openDetailMenu(fixture);
    (host.querySelector('[data-testid="action-whatsapp"]') as HTMLButtonElement).click();
    expect(whatsApp).toHaveBeenCalledWith('COMPANY', 'co-1', expect.stringContaining('Olá, Fabi!'));

    openDetailMenu(fixture);
    (host.querySelector('[data-testid="action-contact"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="register-contact-sheet"]')).not.toBeNull();
  });

  it('suspensa: o ⋮ oferece "Reativar empresa" em verde (success)', () => {
    const fixture = render({ ...COMPANY, active: false, status: 'SUSPENDED' });
    openDetailMenu(fixture);
    const item = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="action-reactivate"]') as HTMLElement;
    expect(item.className).toContain('emerald');
    expect(text((fixture.nativeElement as HTMLElement).querySelector('[data-testid="company-status"]'))).toBe('Suspensa');
  });

  it('atividade vem do detalhe; trocar o filtro pede a categoria ao servidor', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;
    expect(text(host.querySelector('[data-testid="activity-item"]'))).toContain('Lorran registrou contato por WhatsApp: sem resposta.');
    const contacts = Array.from(host.querySelectorAll('[data-testid="company-activity"] [role="radio"]')).find(
      (b) => text(b) === 'Contatos',
    ) as HTMLButtonElement;
    contacts.click();
    fixture.detectChanges();
    expect(activity).toHaveBeenCalledWith('co-1', 'CONTACT', 0, 20);
    expect(host.querySelector('[data-testid="activity-empty"]')).not.toBeNull();
  });

  it('operação compacta: quatro números, blocos zerados atrás de "ver tudo"', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('[data-op-tile]').length).toBe(4);
    expect(host.querySelector('[data-testid="operation-group"]')).toBeNull();
    const toggle = host.querySelector('[data-testid="operations-toggle"]') as HTMLButtonElement;
    expect(text(toggle)).toBe('Sem registro: multas, manutenções e vendas de veículo · ver tudo');
    toggle.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('[data-testid="operation-group"]').length).toBe(7);
  });

  it('assinatura, integração, cadastro e vendas abrem recolhidos', () => {
    const host = render().nativeElement as HTMLElement;
    for (const title of ['Assinatura e pagamento', 'Integração de cobranças', 'Dados cadastrais', 'Vendas de veículo']) {
      expect(host.querySelector(`button[aria-label="Expandir ${title}"]`)).not.toBeNull();
    }
    expect(host.querySelector('[data-testid="company-registration"]')).toBeNull();
  });
});
