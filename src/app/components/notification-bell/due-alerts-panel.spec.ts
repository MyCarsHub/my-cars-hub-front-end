import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DueAlertsPanel } from './due-alerts-panel';
import { NotificationBellStore } from './notification-bell.store';
import { AlertSettingsService } from '../../services/alert-settings.service';
import { ApiErrorService } from '../../services/api-error.service';
import { environment } from '../../../environments/environment';
import type { AlertSettings } from '../../types/alert-settings.types';
import type { DocumentAlert } from '../../types/notification-feed.types';

/**
 * Aba Vencimentos do sino: herda da antiga página `/alertas` a fonte
 * (`GET /v1/alerts/documents`), os chips de janela da empresa, o filtro por tipo, os grupos
 * por urgência com contagem, os detalhes por item e os estados; a paginação vira
 * "Carregar mais", que SOMA a página seguinte à lista.
 */
describe('DueAlertsPanel (aba Vencimentos do sino)', () => {
  const URL = `${environment.apiUrl}/alerts/documents`;

  const alert = (over: Partial<DocumentAlert>): DocumentAlert => ({
    type: 'CNH_DUE_SOON',
    typeLabel: 'CNH',
    severity: 'WARNING',
    title: 'CNH de Carlos Mendes',
    subtitle: 'Carlos Mendes',
    entityType: 'DRIVER',
    entityId: 'd-1',
    dueDate: '2026-11-18',
    daysRemaining: 5,
    actionUrl: '/motoristas/d-1',
    ...over,
  });

  const SETTINGS: AlertSettings = {
    windows: [30, 15, 7],
    customized: false,
    defaultWindows: [30, 15, 7],
    minWindowDays: 1,
    maxWindowDays: 90,
    maxWindowCount: 5,
  };

  let http: HttpTestingController;
  let settings: ReturnType<typeof signal<AlertSettings | null>>;
  let settingsLoad: ReturnType<typeof vi.fn>;

  function setup(opts: { forbidden?: boolean } = {}) {
    settings = signal<AlertSettings | null>(null);
    settingsLoad = vi.fn(() => {
      if (opts.forbidden) return throwError(() => new Error('403'));
      settings.set(SETTINGS);
      return of(SETTINGS);
    });
    TestBed.configureTestingModule({
      imports: [DueAlertsPanel],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AlertSettingsService, useValue: { settings, load: settingsLoad } },
        { provide: ApiErrorService, useValue: { claim: vi.fn() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DueAlertsPanel);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => http.verify());

  it('lê /v1/alerts/documents, agrupa por urgência com contagem e mostra os detalhes do item', () => {
    const { fixture, host } = setup();
    // Primeira busca sai sem janela; a da janela da empresa sai depois que a configuração chega.
    const first = http.expectOne((r) => r.url === URL && r.params.get('page') === '0');
    expect(first.request.params.get('size')).toBe('20');
    first.flush({
      content: [
        alert({ title: 'CNH vencida', daysRemaining: -2, severity: 'DANGER', entityId: 'a' }),
        alert({ title: 'Seguro hoje', daysRemaining: 0, type: 'INSURANCE_DUE_SOON', typeLabel: 'Seguro', entityId: 'b' }),
        alert({ title: 'IPVA em 12', daysRemaining: 12, type: 'IPVA_DUE_SOON', typeLabel: 'IPVA', entityId: 'c' }),
      ],
      page: 0,
      size: 20,
      total: 3,
    });
    fixture.detectChanges();

    const headings = Array.from(host.querySelectorAll('[data-due-group] h3')).map((h) =>
      // Os pedaços do título são itens flex (o espaço entre eles é `gap`, não texto).
      h.textContent!.replace(/\s+/g, ' ').replace(/\s*\(/, ' (').trim(),
    );
    expect(headings).toEqual(['Vencidos (1)', 'Vence hoje — 18/11/2026 (1)', 'Próximos 15 dias (1)']);

    const first0 = host.querySelector<HTMLAnchorElement>('[data-due-item]')!;
    expect(first0.textContent).toContain('CNH vencida');
    expect(first0.textContent).toContain('Vencido há 2 dias');
    expect(first0.textContent).toContain('CNH · Carlos Mendes');
    expect(first0.textContent).toContain('Crítico');
    expect(first0.textContent).toContain('Ver detalhes');
    expect(first0.getAttribute('href')).toBe('/motoristas/d-1');
    // Fim da lista: tudo carregado, sem "Carregar mais".
    expect(host.querySelector('[data-due-more]')).toBeNull();
    expect(host.querySelector('[data-due-end]')?.textContent).toContain('Mostrando 3 de 3');
  });

  it('chips de janela vêm da empresa; trocar a janela refaz a busca com withinDays', () => {
    const { fixture, host } = setup();
    http.expectOne((r) => r.url === URL).flush({ content: [], page: 0, size: 20, total: 0 });
    fixture.detectChanges();

    const windows = host.querySelector('[data-due-windows]')!;
    const chips = Array.from(windows.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(chips.map((c) => c.textContent!.trim())).toEqual(['7 dias', '15 dias', '30 dias']);
    expect(windows.textContent).toContain('Avisos da empresa: 30, 15 e 7 dias antes do vencimento');

    chips[0].click();
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === URL);
    expect(req.request.params.get('withinDays')).toBe('7');
    req.flush({ content: [], page: 0, size: 20, total: 0 });
  });

  it('sem a configuração (o gerente recebe 403) a régua some e a lista continua', () => {
    const { fixture, host } = setup({ forbidden: true });
    http.expectOne((r) => r.url === URL).flush({ content: [alert({})], page: 0, size: 20, total: 1 });
    fixture.detectChanges();
    expect(host.querySelector('[data-due-windows]')).toBeNull();
    expect(host.querySelectorAll('[data-due-item]')).toHaveLength(1);
  });

  it('o filtro por tipo recorta o que está carregado, sem nova busca', () => {
    const { fixture, host } = setup();
    http.expectOne((r) => r.url === URL).flush({
      content: [
        alert({ entityId: 'a' }),
        alert({ entityId: 'b', type: 'IPVA_DUE_SOON', typeLabel: 'IPVA', title: 'IPVA do Onix' }),
      ],
      page: 0,
      size: 20,
      total: 2,
    });
    fixture.detectChanges();

    const ipva = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (b) => b.textContent!.trim() === 'IPVA',
    )!;
    ipva.click();
    fixture.detectChanges();

    const items = host.querySelectorAll('[data-due-item]');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('IPVA do Onix');
    http.expectNone((r) => r.url === URL);
  });

  it('"Carregar mais" pede a página seguinte e SOMA à lista; avisa que o filtro vale para o carregado', () => {
    const { fixture, host } = setup();
    http.expectOne((r) => r.url === URL).flush({
      content: [alert({ entityId: 'a', title: 'Primeiro' })],
      page: 0,
      size: 20,
      total: 2,
    });
    fixture.detectChanges();

    const ipva = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (b) => b.textContent!.trim() === 'CNH',
    )!;
    ipva.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-due-partial]')).not.toBeNull();

    host.querySelector<HTMLButtonElement>('[data-due-more]')!.click();
    fixture.detectChanges();
    const next = http.expectOne((r) => r.url === URL);
    expect(next.request.params.get('page')).toBe('1');
    next.flush({ content: [alert({ entityId: 'b', title: 'Segundo' })], page: 1, size: 20, total: 2 });
    fixture.detectChanges();

    const titles = Array.from(host.querySelectorAll('[data-due-item]')).map((a) => a.textContent);
    expect(titles).toHaveLength(2);
    expect(titles[0]).toContain('Primeiro');
    expect(titles[1]).toContain('Segundo');
    expect(host.querySelector('[data-due-more]')).toBeNull();
    expect(host.querySelector('[data-due-partial]')).toBeNull();
  });

  it('estados: carregando, vazio e erro', () => {
    const { fixture, host } = setup();
    expect(host.querySelector('[data-due-loading]')).not.toBeNull();

    http.expectOne((r) => r.url === URL).flush({ content: [], page: 0, size: 20, total: 0 });
    fixture.detectChanges();
    expect(host.querySelector('[data-due-loading]')).toBeNull();
    expect(host.querySelector('[data-due-empty]')?.textContent).toContain(
      'Nenhum documento vencendo neste período.',
    );
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Nenhum vencimento');

    // Troca de janela que falha: banner de erro, sem "vazio".
    host.querySelector<HTMLButtonElement>('[data-due-windows] [role="radio"]')!.click();
    fixture.detectChanges();
    http
      .expectOne((r) => r.url === URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(host.textContent).toContain('Não foi possível carregar os alertas de vencimento.');
    expect(host.querySelector('[data-due-empty]')).toBeNull();
  });

  it('"Carregar mais" seguido de troca de janela: a página da janela antiga é CANCELADA (review M2)', () => {
    const { fixture, host } = setup();
    http.expectOne((r) => r.url === URL).flush({
      content: [alert({ entityId: 'a', title: 'Janela 30, página 0' })],
      page: 0,
      size: 20,
      total: 40,
    });
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('[data-due-more]')!.click();
    fixture.detectChanges();
    const stale = http.expectOne((r) => r.url === URL && r.params.get('page') === '1');

    // Troca a janela antes de a página 1 voltar.
    host.querySelector<HTMLButtonElement>('[data-due-windows] [role="radio"]')!.click();
    fixture.detectChanges();
    expect(stale.cancelled).toBe(true);
    const fresh = http.expectOne((r) => r.url === URL && r.params.get('withinDays') === '7');
    expect(fresh.request.params.get('page')).toBe('0');
    fresh.flush({
      content: [alert({ entityId: 'b', title: 'Janela 7, página 0' })],
      page: 0,
      size: 20,
      total: 1,
    });
    fixture.detectChanges();

    const titles = Array.from(host.querySelectorAll('[data-due-item]')).map((a) => a.textContent);
    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain('Janela 7, página 0');
    expect(host.querySelector('[data-due-end]')?.textContent).toContain('Mostrando 1 de 1');
  });

  it('"Carregar mais" que falha mostra o erro com "Tentar de novo", que repete a página', () => {
    const { fixture, host } = setup();
    http.expectOne((r) => r.url === URL).flush({
      content: [alert({ entityId: 'a', title: 'Primeiro' })],
      page: 0,
      size: 20,
      total: 2,
    });
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('[data-due-more]')!.click();
    fixture.detectChanges();
    http
      .expectOne((r) => r.url === URL && r.params.get('page') === '1')
      .flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    // A lista que já veio fica; o erro oferece a saída.
    expect(host.querySelectorAll('[data-due-item]')).toHaveLength(1);
    host.querySelector<HTMLButtonElement>('[data-due-retry]')!.click();
    fixture.detectChanges();

    http
      .expectOne((r) => r.url === URL && r.params.get('page') === '1')
      .flush({ content: [alert({ entityId: 'b', title: 'Segundo' })], page: 1, size: 20, total: 2 });
    fixture.detectChanges();
    expect(host.querySelectorAll('[data-due-item]')).toHaveLength(2);
    expect(host.querySelector('[data-due-error]')).toBeNull();
  });

  it('computador: cada grupo também sai como tabela (Severidade, Documento, Referência, Vencimento, Prazo)', () => {
    const { fixture, host } = setup();
    http.expectOne((r) => r.url === URL).flush({ content: [alert({})], page: 0, size: 20, total: 1 });
    fixture.detectChanges();
    const table = host.querySelector('[data-due-table]')!;
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent!.trim());
    expect(headers).toEqual(['Severidade', 'Documento', 'Referência', 'Vencimento', 'Prazo', 'Ações']);
    const row = table.querySelector('[data-due-row]')!;
    expect(row.textContent).toContain('Atenção');
    expect(row.textContent).toContain('18/11/2026');
    expect(row.textContent).toContain('Vence em 5 dias');
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/motoristas/d-1');
    expect(table.className).toContain('lg:table');
  });

  it('escolher um item fecha o sino', () => {
    const { fixture, host } = setup();
    const store = TestBed.inject(NotificationBellStore);
    store.openOn('vencimentos');
    http.expectOne((r) => r.url === URL).flush({ content: [alert({})], page: 0, size: 20, total: 1 });
    fixture.detectChanges();

    host.querySelector<HTMLAnchorElement>('[data-due-item]')!.click();
    expect(store.open()).toBe(false);
  });
});
