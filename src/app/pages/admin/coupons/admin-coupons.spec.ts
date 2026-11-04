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

  /** O jsdom nao tem `matchMedia`: sem ele a tela e a de telefone. Isto liga a de `md` (tabela). */
  const stubWide = (wide: boolean): void => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: wide && query.includes('min-width'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
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
      redemptions: vi.fn(() => NEVER),
    };
    notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'matchMedia');
  });

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
      const row = el.querySelector('[data-testid="coupon-card"]') as HTMLElement;
      for (const text of ['MCH-7KQ2M9XA', 'Locadora Teste', 'R$ 49,90', '2 meses', '29/11', 'Ativo']) {
        expect(row.textContent).toContain(text);
      }
      expect(row.querySelector('a')?.getAttribute('href')).toBe('/admin/companies/co-1');
      const card = el.querySelector('[data-testid="coupon-card"]') as HTMLElement;
      expect(card.textContent).toContain('MCH-7KQ2M9XA');
    });

    it('cupom na assinatura diz que não tem código', () => {
      const { el } = render();
      const row = el.querySelectorAll('[data-testid="coupon-card"]')[1] as HTMLElement;
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
      const row = el.querySelector('[data-testid="coupon-card"]') as HTMLElement;
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
      const row = el.querySelector('[data-testid="coupon-card"]') as HTMLElement;
      expect(row.textContent).toContain(status);
      expect(row.textContent).not.toContain('Nas próximas faturas');
    });

    it('chip de situação é só texto: sem bolinha dentro', () => {
      const { el } = render();
      const chip = el.querySelector('[data-testid="coupon-card"] app-status-chip:not([data-testid="coupon-kind"])') as HTMLElement;
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
      expect(el.querySelector('[data-testid="coupon-card"]')).not.toBeNull();
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

    it('leitura de cupom sem código só tem "Ver detalhes" no kebab', () => {
      service['list'].mockReturnValue(of([APPLIED]));
      const { el, fixture } = render(LEITURA);
      const card = el.querySelector('[data-testid="coupon-card"]') as HTMLElement;
      openKebab(card, fixture);
      const items = Array.from(card.querySelectorAll('[role="menuitem"]')).map((i) => i.getAttribute('data-testid'));
      expect(items).toEqual(['menu-detail']);
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
      expect(el.querySelector('[data-testid="coupon-card"]')?.textContent).toContain('Desativado');
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
      expect(el.querySelector('[data-testid="coupon-card"]')?.textContent).toContain('Ativo');
      // O nó do diálogo só sai depois da animação de saída: o estado é que prova.
      const c = fixture.componentInstance as unknown as { deactivating(): AdminCoupon | null };
      expect(c.deactivating()).toBeNull();
    });
  });

  describe('detalhe do cupom', () => {
    const redemptions = {
      coupon: CODE,
      redemptions: [],
      uses: 0,
      totalDiscountCents: 0,
      truncated: false,
    };
    const detail = (el: HTMLElement): HTMLElement | null => el.querySelector('app-coupon-detail');
    const first = (el: HTMLElement): HTMLElement => el.querySelector('[data-testid="coupon-card"]') as HTMLElement;

    beforeEach(() => {
      service['redemptions'].mockReturnValue(of(redemptions));
    });

    it('clicar no ingresso abre o detalhe daquele cupom', () => {
      const { el, fixture } = render();
      first(el).click();
      fixture.detectChanges();
      expect(detail(el)).not.toBeNull();
      expect(service['redemptions']).toHaveBeenCalledWith('c-code');
    });

    it('clicar na linha da tabela abre o detalhe', () => {
      stubWide(true);
      const { el, fixture } = render();
      fixture.detectChanges();
      const row = el.querySelector('tr[data-testid="coupon-card"]') as HTMLElement;
      row.click();
      fixture.detectChanges();
      expect(detail(el)).not.toBeNull();
    });

    it('"Ver detalhes" é o primeiro item do kebab e abre o detalhe', () => {
      const { el, fixture } = render();
      const card = first(el);
      openKebab(card, fixture);
      const items = Array.from(card.querySelectorAll('[role="menuitem"]'));
      expect(items[0].getAttribute('data-testid')).toBe('menu-detail');
      (items[0] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(detail(el)).not.toBeNull();
    });

    it('copiar o código não abre o detalhe', () => {
      const { el, fixture } = render();
      (first(el).querySelector('[data-testid="copy-code"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(detail(el)).toBeNull();
      expect(service['redemptions']).not.toHaveBeenCalled();
    });

    it('abrir o kebab não abre o detalhe', () => {
      const { el, fixture } = render();
      openKebab(first(el), fixture);
      expect(detail(el)).toBeNull();
    });

    it('clicar no link da empresa não abre o detalhe', () => {
      service['list'].mockReturnValue(of([APPLIED]));
      const { el, fixture } = render();
      const link = first(el).querySelector('a') as HTMLAnchorElement;
      link.addEventListener('click', (e) => e.preventDefault());
      link.click();
      fixture.detectChanges();
      expect(detail(el)).toBeNull();
    });

    it('Enter e Espaço na linha abrem; outra tecla não', () => {
      const { el, fixture } = render();
      const card = first(el);
      expect(card.getAttribute('tabindex')).toBe('0');
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      fixture.detectChanges();
      expect(detail(el)).toBeNull();
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      expect(detail(el)).not.toBeNull();
    });

    it('Espaço abre sem rolar a página', () => {
      const { el, fixture } = render();
      const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      first(el).dispatchEvent(event);
      fixture.detectChanges();
      expect(event.defaultPrevented).toBe(true);
      expect(detail(el)).not.toBeNull();
    });

    it('Enter no botão de copiar não abre o detalhe', () => {
      const { el, fixture } = render();
      const button = first(el).querySelector('[data-testid="copy-code"]') as HTMLButtonElement;
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      expect(detail(el)).toBeNull();
    });

    it('fechar o detalhe tira a folha da tela', async () => {
      const { el, fixture } = render();
      first(el).click();
      fixture.detectChanges();
      (el.querySelector('[data-testid="bottom-sheet-close"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 260));
      fixture.detectChanges();
      expect(detail(el)).toBeNull();
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
    expect(el.querySelector('[data-testid="coupon-card"]')?.textContent).toContain('Locadora Teste');
    expect(service['company']).not.toHaveBeenCalled();
  });
  describe('código para qualquer pessoa', () => {
    const OPEN: AdminCoupon = {
      ...CODE,
      couponId: 'c-open',
      mode: 'OPEN_CODE',
      companyId: null,
      promotionCode: 'MANOLO100OFF',
      timesRedeemed: 2,
      maxRedemptions: 5,
    };

    it('mostra o tipo, o código, os usos e nenhuma empresa, em tabela', () => {
      stubWide(true);
      service['list'].mockReturnValue(of([CODE, APPLIED, OPEN]));
      const { fixture, el } = render();
      fixture.detectChanges();
      expect(el.querySelector('table[data-testid="coupons-list"]')).not.toBeNull();
      const open = Array.from(el.querySelectorAll('[data-testid="coupon-card"]')).find((r) =>
        r.textContent?.includes('MANOLO100OFF'),
      ) as HTMLElement;
      expect(open.querySelector('[data-testid="coupon-kind"]')?.textContent).toContain('Qualquer pessoa');
      expect(open.querySelector('[data-testid="coupon-uses"]')?.textContent).toContain('2 / 5');
      expect(open.querySelector('[data-testid="coupon-validity"]')?.textContent).toContain('29/11/2099');
      expect(open.querySelector('a')).toBeNull();
    });

    it('a tabela não tem linhas entre os registros nem sublinhado no cabeçalho', () => {
      stubWide(true);
      service['list'].mockReturnValue(of([CODE, APPLIED, OPEN]));
      const { fixture, el } = render();
      fixture.detectChanges();
      const lined = Array.from(el.querySelectorAll('table, thead, tbody, tr, th, td')).filter((n) =>
        /(^|\s)(border(-[btlrxy])?(-\d+)?|divide-\S+)(\s|$)/.test(n.className),
      );
      expect(lined).toHaveLength(0);
    });

    it('no celular vira ingresso: código, desconto, linha tracejada e canhoto com as mesmas ações', () => {
      service['list'].mockReturnValue(of([OPEN]));
      const { fixture, el } = render();
      fixture.detectChanges();
      expect(el.querySelector('table')).toBeNull();
      const card = el.querySelector('article[data-testid="coupon-card"]') as HTMLElement;
      expect(card.querySelector('[data-testid="coupon-title"]')?.textContent).toContain('MANOLO100OFF');
      expect(card.querySelector('[data-testid="coupon-discount"]')?.textContent).toContain('por 2 meses');
      expect(card.querySelector('[data-testid="coupon-uses"]')?.textContent).toContain('2 / 5');
      expect(card.querySelector('[data-testid="coupon-validity"]')?.textContent).toContain('29/11');
      expect(card.querySelectorAll('.border-dashed')).toHaveLength(1);
      expect(card.querySelector('[data-testid="copy-code"]')).not.toBeNull();
      expect(card.querySelector('app-actions-menu')).not.toBeNull();
    });

    it('desconto direto no ingresso: sem código, sem usos, só o kebab', () => {
      service['list'].mockReturnValue(of([APPLIED]));
      const { fixture, el } = render();
      fixture.detectChanges();
      const card = el.querySelector('article[data-testid="coupon-card"]') as HTMLElement;
      expect(card.textContent).toContain('Locadora Teste');
      expect(card.textContent).toContain('Próximas faturas');
      expect(card.querySelector('[data-testid="copy-code"]')).toBeNull();
      expect(card.querySelector('[data-testid="coupon-uses"]')).toBeNull();
      expect(card.querySelector('app-actions-menu')).not.toBeNull();
    });

    it('os quatro cartões do topo trazem números da lista, com o desconto marcado como estimado', () => {
      service['list'].mockReturnValue(of([CODE, APPLIED, OPEN]));
      const { el } = render();
      const kpi = (name: string): string => el.querySelector(`[data-kpi="${name}"]`)?.textContent ?? '';
      expect(kpi('total')).toContain('3');
      expect(kpi('total')).toContain('ativos');
      expect(kpi('discount')).toContain('estimado');
      expect(kpi('discount')).toContain('≈');
      expect(kpi('uses')).toContain('3');
      expect(kpi('expiring')).toContain('Vencem em 7 dias');
      expect(kpi('expiring')).toContain('de 2 códigos ativos');
    });

    it('as abas mostram a contagem e filtram por Ativos, Esgotados e Encerrados', () => {
      const EXHAUSTED: AdminCoupon = { ...OPEN, couponId: 'c-ex', promotionCode: 'BLACK15', timesRedeemed: 5 };
      const ENDED: AdminCoupon = { ...CODE, couponId: 'c-off', promotionCode: 'OLD-1', status: 'DEACTIVATED' };
      service['list'].mockReturnValue(of([CODE, OPEN, EXHAUSTED, ENDED]));
      const { fixture, el } = render();
      const tab = (v: string): HTMLButtonElement => el.querySelector(`[data-testid="tab-${v}"]`) as HTMLButtonElement;
      const cards = (): number => el.querySelectorAll('[data-testid="coupon-card"]').length;
      expect(tab('ALL').textContent).toContain('4');
      expect(tab('ACTIVE').textContent).toContain('2');
      expect(tab('EXHAUSTED').textContent).toContain('1');
      expect(tab('ENDED').textContent).toContain('1');
      expect(tab('ALL').getAttribute('aria-checked')).toBe('true');
      tab('EXHAUSTED').click();
      fixture.detectChanges();
      expect(cards()).toBe(1);
      expect(el.querySelector('[data-testid="coupon-title"]')?.textContent).toContain('BLACK15');
      expect(tab('EXHAUSTED').getAttribute('aria-checked')).toBe('true');
      tab('ENDED').click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="coupon-status"]')?.textContent).toContain('Desativado');
    });

    it('busca pelo código e filtra por tipo e situação', () => {
      service['list'].mockReturnValue(of([CODE, APPLIED, OPEN]));
      const { fixture, el } = render();
      const page = fixture.componentInstance as unknown as {
        searchControl: { setValue(v: string): void };
        setTypeFilter(v: string): void;
        setSituationFilter(v: string): void;
      };
      const cards = (): number => el.querySelectorAll('[data-testid="coupon-card"]').length;
      expect(cards()).toBe(3);
      page.searchControl.setValue('manolo');
      fixture.detectChanges();
      expect(cards()).toBe(1);
      page.searchControl.setValue('');
      page.setTypeFilter('APPLIED_TO_SUBSCRIPTION');
      fixture.detectChanges();
      expect(cards()).toBe(1);
      page.setSituationFilter('ENDED');
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="empty-filtered"]')).not.toBeNull();
      const select = el.querySelector('[data-filter-type]') as HTMLSelectElement;
      select.value = 'ALL';
      select.dispatchEvent(new Event('change'));
      (el.querySelector('[data-testid="empty-filtered"] [data-clear-filters]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(cards()).toBe(3);
    });

    it('copia o código com um toque', async () => {
      service['list'].mockReturnValue(of([OPEN]));
      const { fixture, el } = render();
      fixture.detectChanges();
      (el.querySelector('[data-testid="coupon-card"] [data-testid="copy-code"]') as HTMLButtonElement).click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith('MANOLO100OFF');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="copy-code"] svg.pop')).not.toBeNull();
      expect(el.textContent).toContain('Copiado');
    });
  });
});
