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

  /**
   * A `app-data-list` desenha a tabela E os cartões; o CSS (que o jsdom não aplica) mostra um
   * só. `[data-row]` é a linha da tabela (a partir de 1024px), `[data-card]` o cartão do celular.
   */
  const rows = (el: HTMLElement): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>('[data-row]'));
  const firstRow = (el: HTMLElement): HTMLElement => rows(el)[0];
  const firstCard = (el: HTMLElement): HTMLElement => el.querySelector('[data-card]') as HTMLElement;

  /** Com `matchMedia`, o movimento vale (sem "reduzir movimento"): a linha que sai se apaga antes. */
  const stubMotion = (): void => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
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
    const row = firstRow(el);
    openKebab(row, fixture);
    (row.querySelector('[data-testid="menu-deactivate"]') as HTMLButtonElement).click();
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

  describe('padrão da plataforma', () => {
    it('lista dentro do cartão "Lista", com toolbar e a lista compartilhada', () => {
      const { el } = render();
      const card = el.querySelector('app-page-card') as HTMLElement;
      expect(card.querySelector('h2')?.textContent?.trim()).toBe('Lista');
      expect(card.querySelector('[data-testid="create-coupon"]')).not.toBeNull();
      expect(card.querySelector('app-list-toolbar')).not.toBeNull();
      expect(card.querySelector('app-data-list[data-testid="coupons-list"]')).not.toBeNull();
      expect(card.querySelector('[data-list-results]')?.textContent).toContain('2 cupons');
      expect(card.querySelector('[data-export]')?.textContent).toContain('Exportar');
    });

    it('situação filtra por pílula (uma fileira), não por aba deslizante', () => {
      const { el } = render();
      expect(el.querySelector('app-pill-tabs')).toBeNull();
      expect(el.querySelectorAll('app-list-toolbar [role="radiogroup"]')).toHaveLength(1);
    });

    it('o select de tipo tem 16px (sem zoom do iPhone)', () => {
      const { el } = render();
      const select = el.querySelector('[data-filter-type]') as HTMLSelectElement;
      expect(select.className).toContain('text-base');
      expect(select.className).not.toMatch(/(^|\s)(md:|sm:)?text-sm(\s|$)/);
    });

    it('o tipo é rótulo: chip neutro, a cor fica só na situação', () => {
      service['list'].mockReturnValue(of([{ ...CODE, mode: 'OPEN_CODE', companyId: null }]));
      const { el } = render();
      const kind = firstRow(el).querySelector('[data-testid="coupon-kind"]') as HTMLElement;
      const status = firstRow(el).querySelector('[data-testid="coupon-status"]') as HTMLElement;
      expect(kind.textContent).toContain('Qualquer pessoa');
      expect(kind.className).toContain('bg-surface-sunken');
      expect(kind.className).not.toMatch(/primary/);
      expect(status.className).toContain('bg-emerald-100');
    });
  });

  describe('lista', () => {
    it('mostra código, empresa, desconto, duração, validade com ano, criação e situação', () => {
      const { el } = render();
      const row = firstRow(el);
      for (const text of ['MCH-7KQ2M9XA', 'Locadora Teste', 'R$ 49,90', 'por 2 meses', 'Até 29/11/2099', 'Criado em 30/10/2026', 'Ativo']) {
        expect(row.textContent).toContain(text);
      }
      expect(row.querySelector('a')?.getAttribute('href')).toBe('/admin/companies/co-1');
    });

    it('cupom na assinatura diz que não tem código', () => {
      const { el } = render();
      const row = rows(el)[1];
      expect(row.textContent).toContain('Direto na assinatura');
      expect(row.textContent).toContain('20%');
      expect(row.textContent).toContain('Nas próximas faturas');
      expect(row.querySelector('[data-testid="copy-code"]')).toBeNull();
    });

    it('código vencido diz quando venceu', () => {
      service['list'].mockReturnValue(of([{ ...CODE, expiresAt: '2026-01-02T10:00:00' }]));
      const { el } = render();
      expect(firstRow(el).querySelector('[data-testid="coupon-validity"]')?.textContent).toContain('Venceu em 02/01/2026');
    });

    it('busca cada empresa uma vez só, por mais cupons que ela tenha', () => {
      render();
      expect(service['company']).toHaveBeenCalledTimes(1);
    });

    it('falha ao achar o nome não derruba a lista', () => {
      service['company'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
      const { el } = render();
      const row = firstRow(el);
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
      const row = firstRow(el);
      expect(row.textContent).toContain(status);
      expect(row.textContent).not.toContain('Nas próximas faturas');
    });

    it('chip de situação é só texto: sem bolinha dentro', () => {
      const { el } = render();
      const chip = firstRow(el).querySelector('[data-testid="coupon-status"]') as HTMLElement;
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
      expect(firstRow(el)).toBeTruthy();
    });

    it('enquanto carrega mostra o esqueleto, não "nenhum cupom"', () => {
      service['list'].mockReturnValue(NEVER);
      const { el } = render();
      expect(el.querySelector('[data-testid="skeleton"] [data-loading]')).not.toBeNull();
      expect(el.querySelector('[data-testid="empty"]')).toBeNull();
    });
  });

  describe('capacidade', () => {
    it('Dono cria e desativa', () => {
      const { el, fixture } = render(DONO);
      expect(el.querySelector('[data-testid="create-coupon"]')).not.toBeNull();
      const row = firstRow(el);
      openKebab(row, fixture);
      expect(row.querySelector('[data-testid="menu-copy"]')).not.toBeNull();
      expect(row.querySelector('[data-testid="menu-deactivate"]')).not.toBeNull();
    });

    it('outros papéis só leem: sem criar, sem desativar', () => {
      const { el, fixture } = render(LEITURA);
      expect(el.querySelector('[data-testid="create-coupon"]')).toBeNull();
      const row = firstRow(el);
      openKebab(row, fixture);
      expect(row.querySelector('[data-testid="menu-copy"]')).not.toBeNull();
      expect(row.querySelector('[data-testid="menu-deactivate"]')).toBeNull();
    });

    it('leitura de cupom sem código: "Ver detalhes" e "Abrir empresa" no kebab', () => {
      service['list'].mockReturnValue(of([APPLIED]));
      const { el, fixture } = render(LEITURA);
      const row = firstRow(el);
      openKebab(row, fixture);
      const items = Array.from(row.querySelectorAll('[role="menuitem"]')).map((i) => i.getAttribute('data-testid'));
      expect(items).toEqual(['menu-detail', 'menu-company']);
      expect(row.querySelector('[data-testid="menu-company"]')?.getAttribute('href')).toBe('/admin/companies/co-1');
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
      const row = firstRow(el);
      openKebab(row, fixture);
      (row.querySelector('[data-testid="menu-copy"]') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith('MCH-7KQ2M9XA');
      expect(notify.success).toHaveBeenCalledWith('Código copiado.');
    });

    it('sem área de transferência não finge que copiou', async () => {
      writeText.mockRejectedValue(new Error('negado'));
      const { el, fixture } = render();
      const row = firstRow(el);
      openKebab(row, fixture);
      (row.querySelector('[data-testid="menu-copy"]') as HTMLButtonElement).click();
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
      expect(firstRow(el).textContent).toContain('Desativado');
      expect(notify.success).toHaveBeenCalledTimes(1);
      expect(service['list']).toHaveBeenCalledTimes(1);
    });

    it('a linha que sai do filtro se apaga antes de sumir', async () => {
      stubMotion();
      const { el, fixture } = render();
      (fixture.componentInstance as unknown as { setSituationFilter(v: string): void }).setSituationFilter('ACTIVE');
      fixture.detectChanges();
      expect(rows(el)).toHaveLength(2);
      clickDeactivate(el, fixture);
      confirmButton(el).click();
      fixture.detectChanges();
      expect(firstRow(el).querySelector('[data-leaving]')).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 320));
      fixture.detectChanges();
      expect(rows(el)).toHaveLength(1);
      expect(el.querySelector('[data-leaving]')).toBeNull();
    });

    it('já desativado não oferece desativar de novo', () => {
      service['list'].mockReturnValue(of([{ ...CODE, status: 'DEACTIVATED' }]));
      const { el, fixture } = render();
      const row = firstRow(el);
      openKebab(row, fixture);
      expect(row.querySelector('[data-testid="menu-deactivate"]')).toBeNull();
    });

    it('falha da Stripe traduz, fecha o diálogo e a linha continua ativa', () => {
      service['deactivate'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      const { el, fixture } = render();
      clickDeactivate(el, fixture);
      confirmButton(el).click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="action-error"]')?.textContent).toMatch(/continua como estava/i);
      expect(firstRow(el).textContent).toContain('Ativo');
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

    beforeEach(() => {
      service['redemptions'].mockReturnValue(of(redemptions));
    });

    it('tocar no cartão do celular abre o detalhe daquele cupom', () => {
      const { el, fixture } = render();
      firstCard(el).click();
      fixture.detectChanges();
      expect(detail(el)).not.toBeNull();
      expect(service['redemptions']).toHaveBeenCalledWith('c-code');
    });

    it('clicar na linha da tabela abre o detalhe', () => {
      const { el, fixture } = render();
      firstRow(el).click();
      fixture.detectChanges();
      expect(detail(el)).not.toBeNull();
    });

    it('o nome do cupom é o botão do teclado: abre o detalhe', () => {
      const { el, fixture } = render();
      const title = firstRow(el).querySelector('[data-testid="coupon-title"]') as HTMLButtonElement;
      expect(title.tagName).toBe('BUTTON');
      expect(title.getAttribute('aria-label')).toBe('Ver detalhes do cupom MCH-7KQ2M9XA');
      title.click();
      fixture.detectChanges();
      expect(detail(el)).not.toBeNull();
      expect(service['redemptions']).toHaveBeenCalledTimes(1);
    });

    it('"Ver detalhes" é o primeiro item do kebab e abre o detalhe', () => {
      const { el, fixture } = render();
      const row = firstRow(el);
      openKebab(row, fixture);
      const items = Array.from(row.querySelectorAll('[role="menuitem"]'));
      expect(items[0].getAttribute('data-testid')).toBe('menu-detail');
      (items[0] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(detail(el)).not.toBeNull();
    });

    it('copiar o código não abre o detalhe', () => {
      const { el, fixture } = render();
      (firstRow(el).querySelector('[data-testid="copy-code"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(detail(el)).toBeNull();
      expect(service['redemptions']).not.toHaveBeenCalled();
    });

    it('abrir o kebab não abre o detalhe', () => {
      const { el, fixture } = render();
      openKebab(firstRow(el), fixture);
      expect(detail(el)).toBeNull();
    });

    it('clicar no link da empresa não abre o detalhe', () => {
      const { el, fixture } = render();
      const link = firstRow(el).querySelector('a') as HTMLAnchorElement;
      link.addEventListener('click', (e) => e.preventDefault());
      link.click();
      fixture.detectChanges();
      expect(detail(el)).toBeNull();
    });

    it('fechar o detalhe tira a folha da tela', async () => {
      const { el, fixture } = render();
      firstRow(el).click();
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
    expect(firstRow(el).textContent).toContain('Locadora Teste');
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

    it('mostra o tipo, o código, os usos e nenhuma empresa, na tabela', () => {
      service['list'].mockReturnValue(of([CODE, APPLIED, OPEN]));
      const { el } = render();
      expect(el.querySelector('[data-testid="coupons-list"] table')).not.toBeNull();
      const open = rows(el).find((r) => r.textContent?.includes('MANOLO100OFF')) as HTMLElement;
      expect(open.querySelector('[data-testid="coupon-kind"]')?.textContent).toContain('Qualquer pessoa');
      expect(open.querySelector('[data-testid="coupon-uses"]')?.textContent).toContain('2 / 5');
      expect(open.querySelector('[data-testid="coupon-uses"]')?.textContent).toContain('2 de 5 usos');
      expect(open.querySelector('[data-testid="coupon-uses"] [title="2 de 5 usos"]')).not.toBeNull();
      expect(open.querySelector('[data-testid="coupon-validity"]')?.textContent).toContain('Até 29/11/2099');
      expect(open.querySelector('a')).toBeNull();
    });

    it('a lista não tem linhas entre os registros nem tracejado', () => {
      service['list'].mockReturnValue(of([CODE, APPLIED, OPEN]));
      const { el } = render();
      const list = el.querySelector('[data-testid="coupons-list"]') as HTMLElement;
      const lined = Array.from(list.querySelectorAll('table, thead, tbody, tr, th, td, ul, li')).filter((n) =>
        /(^|\s)(border(-[btlrxy])?(-\d+)?|border-dashed|divide-\S+)(\s|$)/.test(n.className),
      );
      expect(lined).toHaveLength(0);
      expect(el.querySelectorAll('.border-dashed')).toHaveLength(0);
    });

    it('no celular vira cartão: código, desconto, usos e validade, com copiar e kebab', () => {
      service['list'].mockReturnValue(of([OPEN]));
      const { el } = render();
      const card = firstCard(el);
      expect(card.querySelector('[data-testid="coupon-title"]')?.textContent).toContain('MANOLO100OFF');
      expect(card.querySelector('[data-testid="coupon-discount"]')?.textContent).toContain('por 2 meses');
      expect(card.querySelector('[data-testid="coupon-uses"]')?.textContent).toContain('2 / 5');
      expect(card.querySelector('[data-testid="coupon-validity"]')?.textContent).toContain('29/11/2099');
      expect(card.querySelector('[data-testid="copy-code"]')).not.toBeNull();
      expect(card.querySelector('app-actions-menu')).not.toBeNull();
    });

    it('desconto direto no cartão: sem código, sem usos, só o kebab', () => {
      service['list'].mockReturnValue(of([APPLIED]));
      const { el } = render();
      const card = firstCard(el);
      expect(card.textContent).toContain('Locadora Teste');
      expect(card.textContent).toContain('Nas próximas faturas');
      expect(card.querySelector('[data-testid="copy-code"]')).toBeNull();
      expect(card.querySelector('[data-testid="coupon-uses"]')?.textContent?.trim()).toBe('—');
      expect(card.querySelector('app-actions-menu')).not.toBeNull();
    });

    it('os quatro cartões do topo trazem números da lista, com o desconto estimado em reais com centavos', () => {
      service['list'].mockReturnValue(of([CODE, APPLIED, OPEN]));
      const { el } = render();
      const kpi = (name: string): string => el.querySelector(`[data-kpi="${name}"]`)?.textContent ?? '';
      expect(kpi('total')).toContain('3');
      expect(kpi('total')).toContain('ativos');
      expect(kpi('discount')).toContain('estimado');
      expect(kpi('discount').replace(/\s+/g, ' ')).toMatch(/≈ R\$ [\d.]+,\d{2}/);
      expect(kpi('uses')).toContain('3');
      expect(kpi('expiring')).toContain('Vencem em 7 dias');
      expect(kpi('expiring')).toContain('de 2 códigos ativos');
    });

    it('as pílulas mostram a contagem e filtram por Ativos, Esgotados e Encerrados', () => {
      const EXHAUSTED: AdminCoupon = { ...OPEN, couponId: 'c-ex', promotionCode: 'BLACK15', timesRedeemed: 5 };
      const ENDED: AdminCoupon = { ...CODE, couponId: 'c-off', promotionCode: 'OLD-1', status: 'DEACTIVATED' };
      service['list'].mockReturnValue(of([CODE, OPEN, EXHAUSTED, ENDED]));
      const { fixture, el } = render();
      const pill = (label: string): HTMLButtonElement =>
        Array.from(el.querySelectorAll<HTMLButtonElement>('app-list-toolbar [role="radio"]')).find((b) =>
          b.textContent?.trim().startsWith(label),
        ) as HTMLButtonElement;
      expect(pill('Todos').textContent).toContain('4');
      expect(pill('Ativos').textContent).toContain('2');
      expect(pill('Esgotados').textContent).toContain('1');
      expect(pill('Encerrados').textContent).toContain('1');
      expect(pill('Ativos').textContent).not.toContain('·');
      // Entrada em cascata da própria app-data-list (`animateRows`); a página só anima a saída.
      expect(el.querySelector('[data-row]')?.classList.contains('enter-up')).toBe(true);
      expect(pill('Todos').getAttribute('aria-checked')).toBe('true');
      pill('Esgotados').click();
      fixture.detectChanges();
      expect(rows(el)).toHaveLength(1);
      expect(firstRow(el).querySelector('[data-testid="coupon-title"]')?.textContent).toContain('BLACK15');
      expect(pill('Esgotados').getAttribute('aria-checked')).toBe('true');
      pill('Encerrados').click();
      fixture.detectChanges();
      expect(firstRow(el).querySelector('[data-testid="coupon-status"]')?.textContent).toContain('Desativado');
    });

    it('busca pelo código e filtra por tipo e situação', () => {
      service['list'].mockReturnValue(of([CODE, APPLIED, OPEN]));
      const { fixture, el } = render();
      const page = fixture.componentInstance as unknown as {
        setQuery(v: string): void;
        setTypeFilter(v: string): void;
        setSituationFilter(v: string): void;
      };
      expect(rows(el)).toHaveLength(3);
      page.setQuery('manolo');
      fixture.detectChanges();
      expect(rows(el)).toHaveLength(1);
      page.setQuery('');
      page.setTypeFilter('APPLIED_TO_SUBSCRIPTION');
      fixture.detectChanges();
      expect(rows(el)).toHaveLength(1);
      page.setSituationFilter('ENDED');
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="empty-filtered"]')).not.toBeNull();
      expect(el.querySelector('[data-list-clear]')).not.toBeNull();
      (el.querySelector('[data-testid="empty-filtered"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(rows(el)).toHaveLength(3);
      expect((el.querySelector('[data-filter-type]') as HTMLSelectElement).value).toBe('ALL');
    });

    it('a busca do toolbar filtra a lista', () => {
      service['list'].mockReturnValue(of([CODE, APPLIED, OPEN]));
      const { fixture, el } = render();
      const input = el.querySelector('[data-list-search]') as HTMLInputElement;
      expect(input.className).toContain('text-base');
      input.value = 'locadora';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(rows(el)).toHaveLength(2);
      expect(el.querySelector('[data-list-results]')?.textContent).toContain('2 cupons');
    });

    it('copia o código com um toque', async () => {
      service['list'].mockReturnValue(of([OPEN]));
      const { fixture, el } = render();
      (firstRow(el).querySelector('[data-testid="copy-code"]') as HTMLButtonElement).click();
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
