import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AlertsPage } from './alerts-page';
import { AlertsService } from '../../services/alerts.service';
import { AlertSettingsService } from '../../services/alert-settings.service';
import { SessionService } from '../../services/session.service';
import type { AlertSettings } from '../../types/alert-settings.types';
import type {
  AlertWindow,
  DocumentAlert,
  NotificationType,
} from '../../types/notification-feed.types';

/**
 * Cobre `/alertas`:
 *  - agrupamento por urgência na ordem Vencidos → hoje → amanhã → 7 → 15 → 30,
 *    sem seções vazias, com a data ao lado dos rótulos relativos;
 *  - o alerta de IPVA (tipo novo) tem chip próprio e link para o veículo;
 *  - paginação server-side sobre o envelope `content`/`page`/`size`/`total`;
 *  - filtro por tipo é local (não refaz a requisição) e o de janela refaz;
 *  - estado vazio.
 */
describe('AlertsPage', () => {
  function alert(
    partial: Partial<DocumentAlert> & { entityId: string; daysRemaining: number },
  ): DocumentAlert {
    return {
      type: 'CNH_DUE_SOON',
      typeLabel: 'CNH',
      severity: 'WARNING',
      title: `Alerta ${partial.entityId}`,
      subtitle: 'Motorista',
      entityType: 'DRIVER',
      dueDate: '2026-08-10',
      actionUrl: `/motoristas/${partial.entityId}`,
      ...partial,
    };
  }

  const DEFAULT_SETTINGS: AlertSettings = {
    windows: [30, 15, 7, 1],
    customized: false,
    defaultWindows: [30, 15, 7, 1],
    minWindowDays: 1,
    maxWindowDays: 365,
    maxWindowCount: 6,
  };

  let documentAlerts: ReturnType<typeof signal<DocumentAlert[]>>;
  let page: ReturnType<typeof signal<number>>;
  let size: ReturnType<typeof signal<number>>;
  let total: ReturnType<typeof signal<number>>;
  let listSpy: ReturnType<typeof vi.fn>;
  /** Janelas da empresa; `null` simula a leitura que falhou. */
  let companySettings: AlertSettings | null;
  let selectedRole: string;
  let settingsSignal: ReturnType<typeof signal<AlertSettings | null>>;

  interface PageInternals {
    groups: () => {
      key: string;
      label: string;
      dateHint: string | null;
      alerts: DocumentAlert[];
    }[];
    onTypeChange: (value: NotificationType | 'ALL') => void;
    onWindowChange: (value: AlertWindow) => void;
    prev: () => void;
    next: () => void;
  }

  function configure(): void {
    settingsSignal = signal<AlertSettings | null>(null);
    documentAlerts = signal<DocumentAlert[]>([]);
    page = signal(0);
    size = signal(20);
    total = signal(0);
    listSpy = vi.fn().mockImplementation((_withinDays: number, requestedPage = 0) => {
      page.set(requestedPage);
      return of({
        content: documentAlerts(),
        page: requestedPage,
        size: size(),
        total: total(),
      });
    });

    TestBed.configureTestingModule({
      imports: [AlertsPage],
      providers: [
        provideRouter([]),
        {
          provide: AlertsService,
          useValue: {
            documentAlerts,
            page,
            size,
            total,
            loading: signal(false),
            error: signal<string | null>(null),
            listDocumentAlerts: listSpy,
          },
        },
        {
          provide: AlertSettingsService,
          useValue: {
            settings: settingsSignal,
            load: vi.fn(() => {
              if (!companySettings) {
                return throwError(() => new HttpErrorResponse({ status: 500 }));
              }
              settingsSignal.set(companySettings);
              return of(companySettings);
            }),
          },
        },
        {
          provide: SessionService,
          useValue: { getItem: (key: string) => (key === 'selectedRole' ? selectedRole : null) },
        },
      ],
    });
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    companySettings = DEFAULT_SETTINGS;
    selectedRole = 'OWNER';
    configure();
  });

  it('agrupa por urgência na ordem Vencidos → hoje → amanhã → 7 → 15 → 30 e omite grupos vazios', () => {
    documentAlerts.set([
      alert({ entityId: 'a', daysRemaining: -5 }),
      alert({ entityId: 'b', daysRemaining: 0, dueDate: '2026-08-05' }),
      alert({ entityId: 'c', daysRemaining: 1, dueDate: '2026-08-06' }),
      alert({ entityId: 'd', daysRemaining: 3 }),
      alert({ entityId: 'e', daysRemaining: 22 }),
    ]);

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const groups = (fixture.componentInstance as unknown as PageInternals).groups();
    expect(groups.map((g) => g.label)).toEqual([
      'Vencidos',
      'Vence hoje',
      'Vence amanhã',
      'Próximos 7 dias',
      'Próximos 30 dias',
    ]);
    expect(groups[0].alerts[0].entityId).toBe('a');
  });

  /**
   * O "hoje" que define o bucket é calculado em UTC pelo backend, então perto
   * da meia-noite em Brasília o rótulo sozinho enganaria. A data ao lado o
   * torna verificável — e o frontend NÃO compensa o offset.
   */
  it('mostra a data ao lado de "Vence hoje" e "Vence amanhã", e não nos demais grupos', () => {
    documentAlerts.set([
      alert({ entityId: 'b', daysRemaining: 0, dueDate: '2026-08-05' }),
      alert({ entityId: 'c', daysRemaining: 1, dueDate: '2026-08-06' }),
      alert({ entityId: 'd', daysRemaining: 3 }),
    ]);

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const groups = (fixture.componentInstance as unknown as PageInternals).groups();
    expect(groups[0].dateHint).toBe('05/08/2026');
    expect(groups[1].dateHint).toBe('06/08/2026');
    expect(groups[2].dateHint).toBeNull();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Vence hoje');
    expect(text).toContain('05/08/2026');
  });

  it('inclui itens já vencidos (daysRemaining negativo) com rótulo "vencido há"', () => {
    documentAlerts.set([alert({ entityId: 'a', daysRemaining: -2 })]);

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('vencido há 2 dia(s)');
  });

  it('renderiza o alerta de IPVA com rótulo próprio e link para o veículo', () => {
    documentAlerts.set([
      alert({
        entityId: 'v-9',
        daysRemaining: 2,
        type: 'IPVA_DUE_SOON',
        typeLabel: 'IPVA a vencer',
        title: 'IPVA do ABC1D23',
        subtitle: 'IPVA — R$ 1.240,00',
        entityType: 'VEHICLE',
        actionUrl: '/veiculos/v-9',
      }),
    ]);

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('IPVA a vencer');
    expect(host.textContent).toContain('R$ 1.240,00');
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('a[href]'));
    expect(links.some((a) => a.getAttribute('href') === '/veiculos/v-9')).toBe(true);
  });

  it('oferece um chip de filtro para IPVA', () => {
    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const chips = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[aria-labelledby="alerts-type-label"] button'),
    );

    expect(chips.map((b) => b.textContent?.trim())).toEqual([
      'Todos',
      'CNH',
      'CRLV',
      'IPVA',
      'Seguro',
      'Financiamento',
    ]);
  });

  it('filtra por tipo localmente, sem nova requisição', () => {
    documentAlerts.set([
      alert({ entityId: 'a', daysRemaining: 3, type: 'CNH_DUE_SOON' }),
      alert({ entityId: 'b', daysRemaining: 4, type: 'IPVA_DUE_SOON' }),
    ]);

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as PageInternals;
    const callsBefore = listSpy.mock.calls.length;

    component.onTypeChange('IPVA_DUE_SOON');
    fixture.detectChanges();

    expect(listSpy.mock.calls.length).toBe(callsBefore);
    const flattened = component.groups().flatMap((g) => g.alerts);
    expect(flattened).toHaveLength(1);
    expect(flattened[0].entityId).toBe('b');
  });

  /**
   * A primeira busca sai SEM `withinDays`: o backend já responde pela maior
   * janela da empresa, então encadear a leitura da configuração antes da lista
   * só atrasaria a tela. A configuração chega depois, apenas para marcar o chip.
   */
  it('busca sem withinDays na entrada e deixa a janela por conta do backend', () => {
    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenLastCalledWith(null, 0, 20);
  });

  it('trocar a janela refaz a requisição com o novo withinDays e volta para a página 0', () => {
    total.set(47);
    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    expect(listSpy).toHaveBeenLastCalledWith(null, 0, 20);

    const component = fixture.componentInstance as unknown as PageInternals;
    component.next();
    fixture.detectChanges();
    expect(listSpy).toHaveBeenLastCalledWith(30, 1, 20);

    component.onWindowChange(7);

    expect(listSpy).toHaveBeenLastCalledWith(7, 0, 20);
  });

  function windowChips(host: HTMLElement): HTMLButtonElement[] {
    return Array.from(
      host.querySelectorAll<HTMLButtonElement>('[aria-labelledby="alerts-window-label"] button'),
    );
  }

  /** Troca a configuração da empresa ANTES de criar o componente. */
  function withCompanySettings(settings: AlertSettings | null): void {
    companySettings = settings;
    TestBed.resetTestingModule();
    configure();
  }

  it('oferece as janelas configuradas com o rótulo de 1 dia no singular', () => {
    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    expect(
      windowChips(fixture.nativeElement as HTMLElement).map((b) => b.textContent?.trim()),
    ).toEqual(['1 dia', '7 dias', '15 dias', '30 dias']);
  });

  /**
   * O ponto do item: os atalhos vêm de
   * `GET /companies/current/alert-settings`, não de constante no código — senão
   * a tela mentiria para quem configurasse outra coisa.
   */
  it('deriva os atalhos das janelas da empresa, não de constante no código', () => {
    withCompanySettings({
      ...DEFAULT_SETTINGS,
      windows: [90, 45, 5],
      customized: true,
    });

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(windowChips(host).map((b) => b.textContent?.trim())).toEqual([
      '5 dias',
      '45 dias',
      '90 dias',
    ]);
    // A maior janela é a que o backend usou na busca sem parâmetro.
    expect(windowChips(host)[2].getAttribute('aria-checked')).toBe('true');
  });

  it('agrupa pelas faixas da empresa em vez das faixas fixas 7/15/30', () => {
    withCompanySettings({ ...DEFAULT_SETTINGS, windows: [90, 45, 5], customized: true });
    documentAlerts.set([
      alert({ entityId: 'a', daysRemaining: 4 }),
      alert({ entityId: 'b', daysRemaining: 40 }),
      alert({ entityId: 'c', daysRemaining: 80 }),
    ]);

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const groups = (fixture.componentInstance as unknown as PageInternals).groups();
    expect(groups.map((g) => g.label)).toEqual([
      'Próximos 5 dias',
      'Próximos 45 dias',
      'Próximos 90 dias',
    ]);
  });

  /**
   * A tela `/configuracoes/alertas` deixou de existir: o editor de janelas é uma
   * SEÇÃO desta página. Como `/alertas` é aberta a qualquer membro, o papel que
   * o `roleGuard` guardava passou a ser checado aqui — membro comum continua
   * lendo o estado, sem o editor.
   */
  it('mostra o estado das janelas para todo membro e o editor só para OWNER/MANAGER', () => {
    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain(
      'Avisos da empresa: 30, 15, 7 e 1 dia antes do vencimento (padrão do sistema).',
    );
    expect(host.querySelector('app-alert-windows')).not.toBeNull();
    expect(host.textContent).toContain('Substituir janelas');
  });

  it('esconde o editor de janelas de quem não é OWNER nem MANAGER', () => {
    selectedRole = 'USER';
    TestBed.resetTestingModule();
    configure();

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Avisos da empresa:');
    expect(host.querySelector('app-alert-windows')).toBeNull();
    expect(host.textContent).not.toContain('Substituir janelas');
  });

  /** Nenhuma rota de Configurações sobrou apontada a partir desta página. */
  it('não linka mais para /configuracoes/alertas', () => {
    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('a[href="/configuracoes/alertas"]')).toBeNull();
  });

  it('diz quando as janelas foram personalizadas pela empresa', () => {
    withCompanySettings({ ...DEFAULT_SETTINGS, windows: [60, 10], customized: true });

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Avisos da empresa: 60 e 10 dias antes do vencimento (configurado pela empresa).',
    );
  });

  /** Falhar a configuração não pode derrubar a lista de vencimentos. */
  it('esconde a régua de janelas quando a configuração não carrega, mas mantém a lista', () => {
    withCompanySettings(null);
    documentAlerts.set([alert({ entityId: 'a', daysRemaining: 3 })]);

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(windowChips(host)).toHaveLength(0);
    expect(host.textContent).toContain('Alerta a');
    expect(listSpy).toHaveBeenLastCalledWith(null, 0, 20);
  });

  it('a janela de 1 dia refaz a requisição com withinDays=1 e fica marcada', () => {
    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const chips = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[aria-labelledby="alerts-window-label"] button'),
    );
    chips[0].click();
    fixture.detectChanges();

    expect(listSpy).toHaveBeenLastCalledWith(1, 0, 20);
    expect(chips[0].getAttribute('aria-checked')).toBe('true');
    expect(chips[3].getAttribute('aria-checked')).toBe('false');
  });

  /**
   * O envelope substituiu o antigo corte silencioso em 200 linhas: o excedente
   * está na página seguinte e `total` diz quantos são.
   */
  describe('paginação', () => {
    function paginationButtons(host: HTMLElement): HTMLButtonElement[] {
      return Array.from(
        host.querySelectorAll<HTMLButtonElement>(
          'nav[aria-label="Paginação dos vencimentos"] button',
        ),
      );
    }

    it('mostra o total e a posição da página a partir do envelope', () => {
      documentAlerts.set([alert({ entityId: 'a', daysRemaining: 3 })]);
      total.set(47);

      const fixture = TestBed.createComponent(AlertsPage);
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        '47 vencimento(s) — página 1 de 3',
      );
    });

    it('avança e volta de página pedindo o page correspondente ao backend', () => {
      documentAlerts.set([alert({ entityId: 'a', daysRemaining: 3 })]);
      total.set(47);

      const fixture = TestBed.createComponent(AlertsPage);
      fixture.detectChanges();

      const [prevBtn, nextBtn] = paginationButtons(fixture.nativeElement as HTMLElement);
      expect(prevBtn.disabled).toBe(true);

      nextBtn.click();
      fixture.detectChanges();
      expect(listSpy).toHaveBeenLastCalledWith(30, 1, 20);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('página 2 de 3');

      paginationButtons(fixture.nativeElement as HTMLElement)[0].click();
      fixture.detectChanges();
      expect(listSpy).toHaveBeenLastCalledWith(30, 0, 20);
    });

    it('desabilita "Próxima" na última página e não dispara requisição', () => {
      documentAlerts.set([alert({ entityId: 'a', daysRemaining: 3 })]);
      total.set(15);

      const fixture = TestBed.createComponent(AlertsPage);
      fixture.detectChanges();

      const [prevBtn, nextBtn] = paginationButtons(fixture.nativeElement as HTMLElement);
      expect(prevBtn.disabled).toBe(true);
      expect(nextBtn.disabled).toBe(true);

      const callsBefore = listSpy.mock.calls.length;
      (fixture.componentInstance as unknown as PageInternals).next();
      expect(listSpy.mock.calls.length).toBe(callsBefore);
    });

    it('avisa que o filtro por tipo só recorta a página corrente quando há mais de uma', () => {
      documentAlerts.set([alert({ entityId: 'a', daysRemaining: 3, type: 'IPVA_DUE_SOON' })]);
      total.set(47);

      const fixture = TestBed.createComponent(AlertsPage);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).not.toContain('O filtro por tipo se aplica');

      (fixture.componentInstance as unknown as PageInternals).onTypeChange('IPVA_DUE_SOON');
      fixture.detectChanges();

      expect(host.textContent).toContain(
        'O filtro por tipo se aplica só aos vencimentos desta página.',
      );
    });
  });

  it('mostra o estado vazio quando não há vencimentos no período', () => {
    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Nenhum documento vencendo neste período.',
    );
  });
});
