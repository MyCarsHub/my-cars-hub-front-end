import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router, Route } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../../app.routes';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { NotificationService } from '../../../services/notification.service';
import { AdminAnnouncement, AnnouncementRequest } from '../../../types/announcement.types';
import type { AdminCapabilityCode } from '../../../types/admin-roles.types';
import { visibleAdminMenu } from '../shell/admin-menu';
import { AdminAnnouncements } from './admin-announcements';
import { AdminAnnouncementsService } from './admin-announcements.service';
import { isAllowedLink } from './announcement-sheet';
import { periodLabel } from './announcement-copy';

function ann(extra: Partial<AdminAnnouncement> = {}): AdminAnnouncement {
  return {
    id: 'a1',
    title: 'Gastos da locadora no painel',
    body: 'Agora você lança despesas.',
    items: ['Gasto com ou sem veículo'],
    linkUrl: '/gastos',
    linkLabel: 'Ver Gastos',
    audiences: ['LOCADORA'],
    status: 'PUBLISHED',
    startsOn: '2026-11-12',
    endsOn: '2026-11-30',
    publishedAt: '2026-11-12T10:00:00',
    endedAt: null,
    createdDate: '2026-11-10T10:00:00',
    modifyDate: '2026-11-10T10:00:00',
    readCount: 38,
    ...extra,
  };
}

type Svc = Record<keyof AdminAnnouncementsService, ReturnType<typeof vi.fn>>;

describe('AdminAnnouncements (F2)', () => {
  let service: Svc;
  let notify: { push: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    notify = { push: vi.fn() };
    service = {
      list: vi.fn(() => of([ann(), ann({ id: 'd1', title: 'Rascunho X', status: 'DRAFT', audiences: [], startsOn: null, endsOn: null, readCount: 0 }), ann({ id: 'e1', title: 'Velha', status: 'EXPIRED' })])),
      get: vi.fn(),
      create: vi.fn((req: AnnouncementRequest) => of(ann({ ...req, id: 'n1', status: 'DRAFT' }))),
      update: vi.fn((id: string, req: AnnouncementRequest) => of(ann({ ...req, id }))),
      publish: vi.fn((id: string) => of(ann({ id, status: 'PUBLISHED' }))),
      unpublish: vi.fn((id: string) => of(ann({ id, status: 'EXPIRED' }))),
      delete: vi.fn(() => of(undefined)),
    } as unknown as Svc;
    TestBed.configureTestingModule({
      imports: [AdminAnnouncements],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AdminAnnouncementsService, useValue: service },
        { provide: NotificationService, useValue: notify },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  function render(): { f: ComponentFixture<AdminAnnouncements>; el: HTMLElement } {
    const f = TestBed.createComponent(AdminAnnouncements);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }
  /** O BottomSheet e o menu ⋮ vivem no corpo do documento (fixed). */
  const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
  const $$ = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));

  function type(sel: string, value: string, f: ComponentFixture<unknown>): void {
    const input = $(sel) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  function openMenu(row: number, f: ComponentFixture<unknown>): void {
    const trigger = $$('[data-testid="announcement-row"]')[row].querySelector<HTMLButtonElement>('app-actions-menu button')!;
    trigger.click();
    f.detectChanges();
  }

  it('lista com chip de situação, público, período e filtro por situação', () => {
    const { f, el } = render();
    const rows = el.querySelectorAll('[data-testid="announcement-row"]');
    expect(rows.length).toBe(3);
    expect(Array.from(el.querySelectorAll('[data-testid="row-status"]')).map((e) => e.textContent?.trim())).toEqual([
      'Publicada',
      'Rascunho',
      'Encerrada',
    ]);
    expect(el.querySelector('[data-testid="row-sub"]')?.textContent).toContain('lida por 38 pessoas');
    expect(el.querySelector('[data-testid="row-period"]')?.textContent?.trim()).toBe('12/11 a 30/11/2026');
    (el.querySelector('[data-testid="tab-DRAFT"]') as HTMLElement).click();
    f.detectChanges();
    expect(el.querySelectorAll('[data-testid="announcement-row"]').length).toBe(1);
    expect(el.querySelector('[data-testid="footer"]')?.textContent).toContain('1 novidade');
  });

  it('vazio e erro seguem a prancha (erro tem "Tentar de novo")', () => {
    service.list.mockReturnValueOnce(of([]));
    const { el } = render();
    expect(el.querySelector('[data-testid="empty"]')?.textContent).toContain('Nenhuma novidade ainda');
  });

  it('erro de carga mostra o estado de erro e tenta de novo', () => {
    service.list.mockReturnValueOnce(throwError(() => new Error('x')));
    const { f, el } = render();
    expect(el.querySelector('[data-testid="load-error"]')).not.toBeNull();
    (el.querySelector('[data-testid="retry"]') as HTMLElement).click();
    f.detectChanges();
    expect(el.querySelectorAll('[data-testid="announcement-row"]').length).toBe(3);
  });

  it('cria, vê a prévia ao vivo e publica (salva e depois publica)', () => {
    const { f, el } = render();
    (el.querySelector('[data-testid="create-announcement"]') as HTMLElement).click();
    f.detectChanges();
    TestBed.tick();
    f.detectChanges();

    const publishBtn = () => $('[data-testid="sheet-publish"]') as HTMLButtonElement;
    expect(publishBtn().disabled).toBe(true);

    type('[data-testid="field-title"]', 'Recibo do pagamento no app', f);
    type('[data-testid="field-body"]', 'O recibo fica salvo em Aluguéis.', f);
    type('[data-testid="field-item"]', 'Recibo em PDF', f);
    type('[data-testid="field-link-url"]', '/meus-alugueis', f);
    type('[data-testid="field-link-label"]', 'Ver meus aluguéis', f);

    // Prévia acompanha a digitação.
    expect($('[data-testid="announcement-preview"] [data-testid="news-title"]')?.textContent?.trim()).toBe('Recibo do pagamento no app');
    expect($('[data-testid="announcement-preview"] [data-testid="notice-message"]')?.textContent?.trim()).toBe('O recibo fica salvo em Aluguéis.');
    expect($('[data-testid="announcement-preview"] [data-testid="notice-link"]')?.textContent?.trim()).toBe('Ver meus aluguéis');

    // Sem público: Publicar fica desligado e a folha explica.
    expect(publishBtn().disabled).toBe(true);
    expect($('[data-testid="no-audience"]')).not.toBeNull();

    ($('[data-testid="aud-motorista"]') as HTMLInputElement).click();
    f.detectChanges();
    expect($('[data-testid="announcement-preview"]')?.getAttribute('data-area')).toBe('MOTORISTA');
    ($('[data-testid="aud-locadora"]') as HTMLInputElement).click();
    f.detectChanges();
    // Os dois públicos: a prévia troca de área e de aparelho.
    ($('[data-testid="area-motorista"]') as HTMLElement).click();
    ($('[data-testid="device-desk"]') as HTMLElement).click();
    f.detectChanges();
    expect($('[data-testid="announcement-preview"]')?.getAttribute('data-device')).toBe('desk');
    expect($('[data-testid="announcement-preview"]')?.getAttribute('data-area')).toBe('MOTORISTA');

    expect(publishBtn().disabled).toBe(false);
    publishBtn().click();
    f.detectChanges();

    expect(service.create).toHaveBeenCalledTimes(1);
    const req = service.create.mock.calls[0][0] as AnnouncementRequest;
    expect(req).toEqual({
      title: 'Recibo do pagamento no app',
      body: 'O recibo fica salvo em Aluguéis.',
      items: ['Recibo em PDF'],
      linkUrl: '/meus-alugueis',
      linkLabel: 'Ver meus aluguéis',
      audiences: ['LOCADORA', 'MOTORISTA'],
      startsOn: null,
      endsOn: null,
    });
    expect(service.publish).toHaveBeenCalledWith('n1');
    vi.advanceTimersByTime(400);
    f.detectChanges();
    expect(notify.push).toHaveBeenCalledWith('success', 'Novidade publicada.');
    expect($('[data-testid="announcement-sheet"]')).toBeNull();
    // Carga inicial + rascunho criado + publicada.
    expect(service.list).toHaveBeenCalledTimes(3);
  });

  it('link com o endereço completo do próprio app é gravado como rota', () => {
    const { f, el } = render();
    (el.querySelector('[data-testid="create-announcement"]') as HTMLElement).click();
    f.detectChanges();
    TestBed.tick();
    f.detectChanges();
    type('[data-testid="field-title"]', 'Ajustes', f);
    type('[data-testid="field-body"]', 'Veja os ajustes.', f);
    type('[data-testid="field-link-url"]', 'https://www.mycarshub.app.br/ajustes', f);
    type('[data-testid="field-link-label"]', 'Abrir Ajustes', f);
    ($('[data-testid="aud-locadora"]') as HTMLInputElement).click();
    f.detectChanges();
    ($('[data-testid="sheet-publish"]') as HTMLButtonElement).click();
    f.detectChanges();
    const req = service.create.mock.calls[0][0] as AnnouncementRequest;
    expect(req.linkUrl).toBe('/ajustes');
    vi.advanceTimersByTime(400);
    f.detectChanges();
  });

  it('link inválido segura salvar; javascript: e //host não passam', () => {
    expect(isAllowedLink('/gastos')).toBe(true);
    expect(isAllowedLink('https://x.com')).toBe(true);
    expect(isAllowedLink('javascript:alert(1)')).toBe(false);
    expect(isAllowedLink('//evil.com')).toBe(false);
    expect(isAllowedLink('http://x.com')).toBe(false);
    expect(isAllowedLink('/a b')).toBe(false);
    expect(isAllowedLink('/a' + String.fromCharCode(0) + 'b')).toBe(false);
    expect(isAllowedLink('https://x.com/' + String.fromCharCode(127))).toBe(false);
    expect(isAllowedLink('https://')).toBe(false);
    expect(isAllowedLink('HTTPS://x.com')).toBe(true);
    expect(isAllowedLink('/\\evil.com')).toBe(false);
    const { f, el } = render();
    (el.querySelector('[data-testid="create-announcement"]') as HTMLElement).click();
    f.detectChanges();
    type('[data-testid="field-title"]', 'T', f);
    type('[data-testid="field-body"]', 'B', f);
    type('[data-testid="field-link-url"]', 'javascript:alert(1)', f);
    type('[data-testid="field-link-label"]', 'Abrir', f);
    expect($('[data-testid="link-error"]')).not.toBeNull();
    expect(($('[data-testid="sheet-save-draft"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('criou mas a publicação falhou: a nova tentativa publica o MESMO rascunho, sem duplicar', () => {
    service.publish
      .mockReturnValueOnce(throwError(() => new Error('falhou')))
      .mockImplementation((id: string) => of(ann({ id, status: 'PUBLISHED' })));
    const { f, el } = render();
    (el.querySelector('[data-testid="create-announcement"]') as HTMLElement).click();
    f.detectChanges();
    type('[data-testid="field-title"]', 'T', f);
    type('[data-testid="field-body"]', 'B', f);
    ($('[data-testid="aud-locadora"]') as HTMLInputElement).click();
    f.detectChanges();

    ($('[data-testid="sheet-publish"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect($('[data-testid="sheet-error"]')).not.toBeNull();
    expect(service.list).toHaveBeenCalledTimes(2); // o rascunho criado já aparece na lista

    ($('[data-testid="sheet-publish"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.update).toHaveBeenCalledWith('n1', expect.objectContaining({ title: 'T' }));
    expect(service.publish.mock.calls.map((c) => c[0])).toEqual(['n1', 'n1']);
  });

  it('menu ⋮ muda com a situação; rascunho sem público abre a folha em vez de publicar', () => {
    const { f } = render();
    openMenu(0, f);
    expect($$('[role="menuitem"]').map((b) => b.textContent?.trim())).toEqual(['Editar', 'Ver prévia', 'Encerrar agora']);
    openMenu(0, f); // o gatilho fecha o próprio menu
    expect($$('[role="menuitem"]')).toHaveLength(0);

    openMenu(1, f);
    expect($$('[role="menuitem"]').map((b) => b.textContent?.trim())).toEqual(['Editar', 'Publicar', 'Excluir rascunho']);
    ($('[data-testid="menu-publish"]') as HTMLElement).click();
    f.detectChanges();
    expect(service.publish).not.toHaveBeenCalled();
    expect($('[data-testid="announcement-sheet"]')).not.toBeNull();
  });

  it('encerrar pede confirmação e chama unpublish', () => {
    const { f } = render();
    openMenu(0, f);
    ($('[data-testid="menu-unpublish"]') as HTMLElement).click();
    f.detectChanges();
    const confirm = $$('button').find((b) => b.textContent?.trim() === 'Encerrar')!;
    confirm.click();
    f.detectChanges();
    expect(service.unpublish).toHaveBeenCalledWith('a1');
  });

  it('período sem data e só com início', () => {
    expect(periodLabel({ startsOn: null, endsOn: null })).toBe('Sem data');
    expect(periodLabel({ startsOn: '2026-11-12', endsOn: null })).toBe('A partir de 12/11/2026');
    expect(periodLabel({ startsOn: '2026-12-20', endsOn: '2027-01-05' })).toBe('20/12/2026 a 05/01/2027');
  });
});

describe('Novidades — menu e rota (só novidades.gerir)', () => {
  const ids = (codes: AdminCapabilityCode[]) =>
    visibleAdminMenu((c) => codes.includes(c)).flatMap((g) => g.items.map((i) => i.id));

  it('o item some sem a capacidade e aparece com ela', () => {
    expect(ids(['ver', 'blog', 'suporte.atender'])).not.toContain('announcements');
    expect(ids(['ver', 'novidades.gerir'])).toContain('announcements');
  });

  it('a rota /admin/novidades é guardada por novidades.gerir', async () => {
    const find = (list: Route[]): Route | null => {
      for (const r of list) {
        if (r.path === 'admin' && r.children) return r.children.find((c) => c.path === 'novidades') ?? null;
        const inner = r.children ? find(r.children) : null;
        if (inner) return inner;
      }
      return null;
    };
    const route = find(routes)!;
    expect(route).not.toBeNull();
    TestBed.resetTestingModule();
    const granted = new Set<AdminCapabilityCode>(['ver']);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AdminCapabilitiesService,
          useValue: { can: (c: AdminCapabilityCode) => granted.has(c), ensureLoaded: () => of(null) },
        },
      ],
    });
    const guard = route.canActivate![0] as () => Observable<unknown>;
    const denied = await new Promise((r) => TestBed.runInInjectionContext(() => guard()).subscribe(r));
    expect(TestBed.inject(Router).serializeUrl(denied as never)).toBe('/admin');
    granted.add('novidades.gerir');
    const allowed = await new Promise((r) => TestBed.runInInjectionContext(() => guard()).subscribe(r));
    expect(allowed).toBe(true);
    TestBed.resetTestingModule();
  });
});
