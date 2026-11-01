import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routes } from '../../../app.routes';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { adminGuard } from '../../../services/admin.guard';
import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon, CouponCompany } from '../../../types/admin-coupon.types';
import type { AdminCapabilityCode } from '../../../types/admin-roles.types';
import { By } from '@angular/platform-browser';
import { AdminCoupons, MAX_NAME_READS } from './admin-coupons';
import { CouponSheet } from './coupon-sheet';
import { AdminCouponsService } from './admin-coupons.service';

const CODE: AdminCoupon = {
  couponId: 'c-code',
  mode: 'PROMOTION_CODE',
  status: 'ACTIVE',
  companyId: 'co-1',
  planCode: 'PRO_MONTHLY_STRIPE',
  amountOffCents: 4990,
  percentOff: null,
  durationMonths: 2,
  timesRedeemed: 0,
  promotionCode: 'MCH-7KQ2M9XA',
  expiresAt: '2099-11-29T10:00:00',
  createdAt: '2026-10-30T10:00:00',
};

const APPLIED: AdminCoupon = {
  ...CODE,
  couponId: 'c-sub',
  mode: 'APPLIED_TO_SUBSCRIPTION',
  amountOffCents: null,
  percentOff: 20,
  durationMonths: 1,
  timesRedeemed: 1,
  promotionCode: null,
  expiresAt: null,
};

const COMPANY: CouponCompany = {
  id: 'co-1',
  name: 'Locadora Teste',
  documentMasked: null,
  planCode: 'PRO_MONTHLY_STRIPE',
  planName: 'PRO',
};

const COMPANY_UUID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

const DONO: AdminCapabilityCode[] = ['ver', 'cupom.gerir'];
const LEITURA: AdminCapabilityCode[] = ['ver'];

describe('AdminCoupons', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let notify: Record<'success' | 'error' | 'warning', ReturnType<typeof vi.fn>>;
  let queryParams: Record<string, string>;
  let writeText: ReturnType<typeof vi.fn>;

  const configure = (codes: AdminCapabilityCode[]): void => {
    const granted = new Set(codes);
    TestBed.configureTestingModule({
      imports: [AdminCoupons],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AdminCouponsService, useValue: service },
        { provide: AdminCapabilitiesService, useValue: { can: (c: AdminCapabilityCode) => granted.has(c), ensureLoaded: () => of(null) } },
        { provide: NotificationService, useValue: notify },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    });
  };

  const render = (codes: AdminCapabilityCode[] = DONO): { fixture: ComponentFixture<AdminCoupons>; el: HTMLElement } => {
    configure(codes);
    const fixture = TestBed.createComponent(AdminCoupons);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };

  const openKebab = (scope: HTMLElement, fixture: ComponentFixture<AdminCoupons>): void => {
    (scope.querySelector('app-actions-menu button[aria-haspopup="menu"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  const clickDeactivate = (el: HTMLElement, fixture: ComponentFixture<AdminCoupons>): void => {
    const card = el.querySelector('[data-testid="coupon-card"]') as HTMLElement;
    openKebab(card, fixture);
    (card.querySelector('[data-testid="menu-deactivate"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  const confirmButton = (el: HTMLElement): HTMLButtonElement =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('app-confirm-dialog button')).find(
      (b) => b.textContent?.trim() === 'Desativar',
    ) as HTMLButtonElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
    queryParams = {};
    service = {
      list: vi.fn(() => of([CODE, APPLIED])),
      company: vi.fn(() => of(COMPANY)),
      deactivate: vi.fn(() => of({ ...CODE, status: 'DEACTIVATED' })),
      plans: vi.fn(() => of([])),
      searchCompanies: vi.fn(() => of([])),
      preview: vi.fn(() => NEVER),
      create: vi.fn(() => NEVER),
    };
    notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => vi.restoreAllMocks());

  it('a rota é lazy e fica sob o adminGuard', () => {
    const find = (list: typeof routes, path: string): (typeof routes)[number] | undefined => {
      for (const route of list) {
        if (route.path === path) return route;
        const inner = find(route.children ?? [], path);
        if (inner) return inner;
      }
      return undefined;
    };
    const admin = find(routes, 'admin');
    expect(admin?.canActivate).toContain(adminGuard);
    const child = admin?.children?.find((r) => r.path === 'cupons');
    expect(child?.loadComponent).toBeTypeOf('function');
  });

  describe('lista', () => {
    it('mostra código, empresa, desconto, duração, validade e situação', () => {
      const { el } = render();
      const row = el.querySelector('[data-testid="coupon-row"]') as HTMLElement;
      for (const text of ['MCH-7KQ2M9XA', 'Locadora Teste', 'R$ 49,90', '2 meses', 'Até 29/11/2099', 'Ativo']) {
        expect(row.textContent).toContain(text);
      }
      expect(row.querySelector('a')?.getAttribute('href')).toBe('/admin/companies/co-1');
      const card = el.querySelector('[data-testid="coupon-card"]') as HTMLElement;
      expect(card.textContent).toContain('MCH-7KQ2M9XA');
    });

    it('cupom na assinatura diz que não tem código', () => {
      const { el } = render();
      const row = el.querySelectorAll('[data-testid="coupon-row"]')[1] as HTMLElement;
      expect(row.textContent).toContain('Direto na assinatura');
      expect(row.textContent).toContain('20%');
    });

    it('busca cada empresa uma vez só, por mais cupons que ela tenha', () => {
      render();
      expect(service['company']).toHaveBeenCalledTimes(1);
    });

    it('falha ao achar o nome não derruba a lista', () => {
      service['company'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
      const { el } = render();
      const row = el.querySelector('[data-testid="coupon-row"]') as HTMLElement;
      expect(row.textContent).toContain('MCH-7KQ2M9XA');
      expect(row.querySelector('a')?.textContent).toContain('co-1');
    });

    it('tentar de novo busca outra vez o nome que falhou', () => {
      service['list'].mockReturnValueOnce(of([CODE])).mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 }))).mockReturnValue(of([CODE]));
      service['company'].mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
      const { fixture } = render();
      const page = fixture.componentInstance as unknown as { load(): void };
      page.load();
      page.load();
      fixture.detectChanges();
      expect(service['company']).toHaveBeenCalledTimes(2);
    });

    it('limita as leituras simultâneas de nomes', () => {
      const pending: Subject<CouponCompany>[] = [];
      service['list'].mockReturnValue(of(Array.from({ length: 9 }, (_, i) => ({ ...CODE, couponId: `c${i}`, companyId: `co-${i}` }))));
      service['company'].mockImplementation(() => {
        const answer = new Subject<CouponCompany>();
        pending.push(answer);
        return answer;
      });
      render();
      expect(pending).toHaveLength(MAX_NAME_READS);
      pending[0].next(COMPANY);
      pending[0].complete();
      expect(pending).toHaveLength(MAX_NAME_READS + 1);
    });

    it.each([
      ['encerrado', { createdAt: '2026-01-01T10:00:00' }, 'Encerrado'],
      ['desativado', { status: 'DEACTIVATED' as const }, 'Desativado'],
    ])('desconto %s não promete as próximas faturas', (_label, over, status) => {
      service['list'].mockReturnValue(of([{ ...APPLIED, ...over }]));
      const { el } = render();
      const row = el.querySelector('[data-testid="coupon-row"]') as HTMLElement;
      expect(row.textContent).toContain(status);
      expect(row.textContent).not.toContain('Nas próximas faturas');
    });

    it('chip de situação é só texto: sem bolinha dentro', () => {
      const { el } = render();
      const chip = el.querySelector('[data-testid="coupon-row"] app-status-chip') as HTMLElement;
      expect(chip.textContent?.trim()).toBe('Ativo');
      expect(chip.children).toHaveLength(0);
    });

    it('lista vazia explica e, para o Dono, oferece criar', () => {
      service['list'].mockReturnValue(of([]));
      const { el } = render();
      expect(el.querySelector('[data-testid="empty"]')?.textContent).toMatch(/nenhum cupom/i);
      expect(el.querySelector('[data-testid="empty-create"]')).not.toBeNull();
    });

    it('erro de carga traduz e deixa tentar de novo', () => {
      service['list'].mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
      const { el, fixture } = render();
      expect(el.querySelector('app-alert-banner')?.textContent).toMatch(/stripe/i);
      expect(el.querySelector('[data-testid="empty"]')).toBeNull();
      (el.querySelector('[data-testid="retry"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="coupon-row"]')).not.toBeNull();
    });

    it('enquanto carrega mostra o esqueleto, não "nenhum cupom"', () => {
      service['list'].mockReturnValue(NEVER);
      const { el } = render();
      expect(el.querySelector('[data-testid="skeleton"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="empty"]')).toBeNull();
    });
  });

  describe('capacidade', () => {
    it('Dono cria e desativa', () => {
      const { el, fixture } = render(DONO);
      expect(el.querySelector('[data-testid="create-coupon"]')).not.toBeNull();
      const card = el.querySelector('[data-testid="coupon-card"]') as HTMLElement;
      openKebab(card, fixture);
      expect(card.querySelector('[data-testid="menu-copy"]')).not.toBeNull();
      expect(card.querySelector('[data-testid="menu-deactivate"]')).not.toBeNull();
    });

    it('outros papéis só leem: sem criar, sem desativar', () => {
      const { el, fixture } = render(LEITURA);
      expect(el.querySelector('[data-testid="create-coupon"]')).toBeNull();
      const card = el.querySelector('[data-testid="coupon-card"]') as HTMLElement;
      openKebab(card, fixture);
      expect(card.querySelector('[data-testid="menu-copy"]')).not.toBeNull();
      expect(card.querySelector('[data-testid="menu-deactivate"]')).toBeNull();
    });

    it('leitura de cupom sem código fica sem kebab', () => {
      service['list'].mockReturnValue(of([APPLIED]));
      const { el } = render(LEITURA);
      expect(el.querySelector('app-actions-menu')).toBeNull();
    });

    it('lista vazia para leitura não oferece criar', () => {
      service['list'].mockReturnValue(of([]));
      const { el } = render(LEITURA);
      expect(el.querySelector('[data-testid="empty-create"]')).toBeNull();
    });
  });

  describe('copiar código', () => {
    it('leva o código à área de transferência', async () => {
      const { el, fixture } = render();
      const card = el.querySelector('[data-testid="coupon-card"]') as HTMLElement;
      openKebab(card, fixture);
      (card.querySelector('[data-testid="menu-copy"]') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith('MCH-7KQ2M9XA');
      expect(notify.success).toHaveBeenCalledWith('Código copiado.');
    });

    it('sem área de transferência não finge que copiou', async () => {
      writeText.mockRejectedValue(new Error('negado'));
      const { el, fixture } = render();
      const card = el.querySelector('[data-testid="coupon-card"]') as HTMLElement;
      openKebab(card, fixture);
      (card.querySelector('[data-testid="menu-copy"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve));
      expect(notify.success).not.toHaveBeenCalled();
      expect(notify.warning).toHaveBeenCalledWith(expect.stringContaining('MCH-7KQ2M9XA'));
    });
  });

  describe('desativar', () => {
    it('pede confirmação antes de chamar o servidor', () => {
      const { el, fixture } = render();
      clickDeactivate(el, fixture);
      expect(service['deactivate']).not.toHaveBeenCalled();
      expect(el.querySelector('app-confirm-dialog')?.textContent).toContain('MCH-7KQ2M9XA');
    });

    it('a confirmação do desconto na assinatura diz o que acontece com as faturas', () => {
      service['list'].mockReturnValue(of([APPLIED]));
      const { el, fixture } = render();
      clickDeactivate(el, fixture);
      expect(el.querySelector('app-confirm-dialog')?.textContent).toMatch(/valor cheio/i);
    });

    it('dois cliques desativam uma vez e a linha muda sem recarregar', () => {
      const pending = new Subject<AdminCoupon>();
      service['deactivate'].mockReturnValue(pending);
      const { el, fixture } = render();
      clickDeactivate(el, fixture);
      const button = confirmButton(el);
      button.click();
      button.click();
      fixture.detectChanges();
      expect(service['deactivate']).toHaveBeenCalledExactlyOnceWith('c-code');
      pending.next({ ...CODE, status: 'DEACTIVATED' });
      pending.complete();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="coupon-row"]')?.textContent).toContain('Desativado');
      expect(notify.success).toHaveBeenCalledTimes(1);
      expect(service['list']).toHaveBeenCalledTimes(1);
    });

    it('já desativado não oferece desativar de novo', () => {
      service['list'].mockReturnValue(of([{ ...CODE, status: 'DEACTIVATED' }]));
      const { el, fixture } = render();
      const card = el.querySelector('[data-testid="coupon-card"]') as HTMLElement;
      openKebab(card, fixture);
      expect(card.querySelector('[data-testid="menu-deactivate"]')).toBeNull();
    });

    it('falha da Stripe traduz, fecha o diálogo e a linha continua ativa', () => {
      service['deactivate'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      const { el, fixture } = render();
      clickDeactivate(el, fixture);
      confirmButton(el).click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="action-error"]')?.textContent).toMatch(/continua como estava/i);
      expect(el.querySelector('[data-testid="coupon-row"]')?.textContent).toContain('Ativo');
      // O nó do diálogo só sai depois da animação de saída: o estado é que prova.
      const c = fixture.componentInstance as unknown as { deactivating(): AdminCoupon | null };
      expect(c.deactivating()).toBeNull();
    });
  });

  describe('atalho vindo da empresa', () => {
    it('?empresa= abre a folha com a empresa preenchida', () => {
      queryParams = { empresa: COMPANY_UUID };
      const { el } = render(DONO);
      expect(document.querySelector('[data-testid="coupon-company-selected"]')?.textContent ?? el.textContent).toContain(
        'Locadora Teste',
      );
    });

    it('parâmetro que não é um id é ignorado, sem chamar a API', () => {
      queryParams = { empresa: '../../billing/plans' };
      render(DONO);
      expect(service['company']).toHaveBeenCalledTimes(1);
      expect(service['company']).toHaveBeenCalledWith('co-1');
      expect(document.querySelector('[data-testid="coupon-sheet"]')).toBeNull();
    });

    it('sem cupom.gerir o atalho não abre a folha', () => {
      queryParams = { empresa: COMPANY_UUID };
      render(LEITURA);
      expect(document.querySelector('[data-testid="coupon-sheet"]')).toBeNull();
    });

    it('fechar limpa o parâmetro, para recarregar não reabrir', () => {
      queryParams = { empresa: COMPANY_UUID };
      const { fixture } = render(DONO);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      (fixture.componentInstance as unknown as { closeSheet(): void }).closeSheet();
      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: {}, replaceUrl: true }));
    });
  });

  it('criação sem resposta relê a lista', () => {
    const { fixture } = render();
    (fixture.componentInstance as unknown as { openSheet(): void }).openSheet();
    fixture.detectChanges();
    const reads = service['list'].mock.calls.length;
    const sheet = fixture.debugElement.query(By.directive(CouponSheet)).componentInstance as CouponSheet;
    sheet.listMayHaveChanged.emit();
    expect(service['list'].mock.calls.length).toBe(reads + 1);
  });

  it('cupom criado entra no topo da lista com o nome já conhecido', () => {
    service['list'].mockReturnValue(of([]));
    const { fixture, el } = render();
    (fixture.componentInstance as unknown as { onSaved(e: { coupon: AdminCoupon; company: CouponCompany }): void }).onSaved({
      coupon: CODE,
      company: COMPANY,
    });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="coupon-row"]')?.textContent).toContain('Locadora Teste');
    expect(service['company']).not.toHaveBeenCalled();
  });
});
