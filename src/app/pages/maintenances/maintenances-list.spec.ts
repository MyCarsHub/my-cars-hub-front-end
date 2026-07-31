import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { MaintenancesList } from './maintenances-list';
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import type { MaintenanceListItem } from '../../types/maintenance.types';

/**
 * Cobre a coluna de ações padronizada (menu de 3 pontos) da listagem de manutenções:
 *  - Editar / Excluir presentes no menu, iguais em mobile e desktop;
 *  - "Excluir" só chama o service depois da confirmação no diálogo;
 *  - erro do servidor mantém a manutenção na lista e mostra a mensagem inline.
 */
describe('MaintenancesList — menu de ações', () => {
  const maintenance: MaintenanceListItem = {
    id: 'm-1',
    vehicleId: 'v-1',
    type: 'PREVENTIVE',
    description: 'Troca de óleo',
    serviceDate: '2026-01-05',
    hodometerReading: 45000,
    costCents: 25000,
    nextServiceDate: '2026-07-05',
    status: 'DONE',
    createdDate: '2026-01-06T10:00:00Z',
  };

  let items: ReturnType<typeof signal<MaintenanceListItem[]>>;
  let removeSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    items = signal<MaintenanceListItem[]>([maintenance]);
    removeSpy = vi.fn().mockReturnValue(of(void 0));
    errorSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [MaintenancesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: MaintenancesService,
          useValue: {
            items,
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(1),
            list: vi.fn().mockReturnValue(of({ content: [maintenance], totalElements: 1 })),
            remove: removeSpy,
            conclude: vi.fn(),
            cancel: vi.fn(),
          },
        },
        {
          provide: VehiclesService,
          useValue: {
            list: vi.fn().mockReturnValue(of({ content: [], totalElements: 0 })),
            getOne: vi.fn().mockReturnValue(of({ id: 'v-1', hodometer: 51000 })),
          },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: errorSpy } },
      ],
    });
  }

  /** Abre o menu de ações do escopo informado e devolve seus itens já renderizados. */
  function openMenuItems(
    fixture: { nativeElement: unknown; detectChanges: () => void },
    scope: 'mobile' | 'desktop',
  ): HTMLElement[] {
    const host = fixture.nativeElement as HTMLElement;
    const containers = Array.from(host.querySelectorAll('app-actions-menu'));
    // Os cards mobile vêm antes da tabela desktop no template.
    const container = scope === 'mobile' ? containers[0] : containers[containers.length - 1];
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    configure();
  });

  it.each(['mobile', 'desktop'] as const)('expõe Editar e Excluir no menu (%s)', (scope) => {
    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const labels = openMenuItems(fixture, scope).map((el) => el.textContent?.trim());

    expect(labels).toContain('Editar');
    expect(labels).toContain('Excluir');
  });

  it('"Editar" aponta para a rota de edição da manutenção', () => {
    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const hrefs = openMenuItems(fixture, 'mobile')
      .filter((el): el is HTMLAnchorElement => el.tagName === 'A')
      .map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/manutencoes/m-1/editar');
  });

  it('"Excluir" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      deleting: () => MaintenanceListItem | null;
      confirmDelete: () => void;
    };

    openMenuItems(fixture, 'mobile')
      .find((el) => el.textContent?.trim() === 'Excluir')
      ?.click();
    fixture.detectChanges();

    expect(component.deleting()?.id).toBe('m-1');
    expect(removeSpy).not.toHaveBeenCalled();

    component.confirmDelete();
    expect(removeSpy).toHaveBeenCalledWith('m-1');
  });

  it('erro do servidor mantém a manutenção na lista e mostra a mensagem inline, sem toast', () => {
    removeSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({ status: 409, error: { message: 'Manutenção em andamento.' } }),
      ),
    );

    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      askDelete: (m: MaintenanceListItem) => void;
      confirmDelete: () => void;
    };

    component.askDelete(maintenance);
    component.confirmDelete();
    fixture.detectChanges();

    expect(items()).toHaveLength(1);

    const banners = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-alert-banner'),
    );
    expect(banners.some((b) => b.textContent?.includes('Manutenção em andamento.'))).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

/**
 * Fluxo de concluir/cancelar na listagem:
 *  - o par só aparece em SCHEDULED / IN_PROGRESS (a maioria das linhas nasce DONE);
 *  - concluir manda o hodômetro digitado e chama o service uma única vez;
 *  - cancelar exige confirmação antes de chamar o service;
 *  - 409 vira banner inline, sem toast.
 */
describe('MaintenancesList — concluir e cancelar', () => {
  const scheduled: MaintenanceListItem = {
    id: 'm-1',
    vehicleId: 'v-1',
    type: 'PREVENTIVE',
    description: 'Revisão agendada',
    serviceDate: '2026-08-05',
    hodometerReading: null,
    costCents: 0,
    nextServiceDate: null,
    status: 'SCHEDULED',
    createdDate: '2026-07-01T10:00:00Z',
  };

  let items: ReturnType<typeof signal<MaintenanceListItem[]>>;
  let concludeSpy: ReturnType<typeof vi.fn>;
  let cancelSpy: ReturnType<typeof vi.fn>;
  let listSpy: ReturnType<typeof vi.fn>;
  let vehicleGetOneSpy: ReturnType<typeof vi.fn>;
  let successSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  function configure(row: MaintenanceListItem): void {
    items = signal<MaintenanceListItem[]>([row]);
    concludeSpy = vi.fn().mockReturnValue(of({ ...row, status: 'DONE' }));
    cancelSpy = vi.fn().mockReturnValue(of({ ...row, status: 'CANCELED' }));
    listSpy = vi.fn().mockReturnValue(of({ content: [row], totalElements: 1 }));
    vehicleGetOneSpy = vi.fn().mockReturnValue(of({ id: 'v-1', hodometer: 51000 }));
    successSpy = vi.fn();
    errorSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [MaintenancesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: MaintenancesService,
          useValue: {
            items,
            loading: signal(false),
            error: signal<string | null>(null),
            page: signal(0),
            size: signal(20),
            total: signal(1),
            list: listSpy,
            remove: vi.fn(),
            conclude: concludeSpy,
            cancel: cancelSpy,
          },
        },
        {
          provide: VehiclesService,
          useValue: {
            list: vi.fn().mockReturnValue(of({ content: [], totalElements: 0 })),
            getOne: vehicleGetOneSpy,
          },
        },
        { provide: NotificationService, useValue: { success: successSpy, error: errorSpy } },
      ],
    });
  }

  function menuLabels(
    fixture: { nativeElement: unknown; detectChanges: () => void },
    scope: 'mobile' | 'desktop',
  ): string[] {
    const host = fixture.nativeElement as HTMLElement;
    const containers = Array.from(host.querySelectorAll('app-actions-menu'));
    const container = scope === 'mobile' ? containers[0] : containers[containers.length - 1];
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (el) => el.textContent?.trim() ?? '',
    );
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it.each(['mobile', 'desktop'] as const)(
    'expõe Concluir e Cancelar quando o status é SCHEDULED (%s)',
    (scope) => {
      configure(scheduled);
      const fixture = TestBed.createComponent(MaintenancesList);
      fixture.detectChanges();

      const labels = menuLabels(fixture, scope);

      expect(labels).toContain('Concluir');
      expect(labels).toContain('Cancelar manutenção');
    },
  );

  it('expõe Concluir e Cancelar quando o status é IN_PROGRESS', () => {
    configure({ ...scheduled, status: 'IN_PROGRESS' });
    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const labels = menuLabels(fixture, 'mobile');

    expect(labels).toContain('Concluir');
    expect(labels).toContain('Cancelar manutenção');
  });

  it.each(['DONE', 'CANCELED'] as const)('esconde as duas ações quando o status é %s', (status) => {
    configure({ ...scheduled, status });
    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const labels = menuLabels(fixture, 'mobile');

    expect(labels).not.toContain('Concluir');
    expect(labels).not.toContain('Cancelar manutenção');
    expect(labels).toContain('Editar');
  });

  it('"Concluir" abre o diálogo de hodômetro pré-preenchido e só chama o service ao confirmar', () => {
    configure(scheduled);
    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const menu = host.querySelector('app-actions-menu');
    menu?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
      .find((el) => el.textContent?.trim() === 'Concluir')
      ?.click();
    fixture.detectChanges();

    const input = host.querySelector<HTMLInputElement>('#conclude-maint-hodometer');
    expect(input).not.toBeNull();
    // Sugestão vem do hodômetro real do veículo, não da leitura (nula) da linha.
    expect(input?.value).toBe('51000');
    expect(concludeSpy).not.toHaveBeenCalled();

    input!.value = '52000';
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const confirm = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Concluir manutenção',
    );
    confirm?.click();
    fixture.detectChanges();

    expect(concludeSpy).toHaveBeenCalledTimes(1);
    expect(concludeSpy).toHaveBeenCalledWith('m-1', { hodometerReading: 52000 });
    expect(successSpy).toHaveBeenCalledWith('Manutenção concluída.');
  });

  it('"Cancelar manutenção" confirma antes de chamar o service', () => {
    configure(scheduled);
    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      cancelOpen: () => boolean;
      confirmCancel: () => void;
    };

    const host = fixture.nativeElement as HTMLElement;
    const menu = host.querySelector('app-actions-menu');
    menu?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
      .find((el) => el.textContent?.trim() === 'Cancelar manutenção')
      ?.click();
    fixture.detectChanges();

    expect(component.cancelOpen()).toBe(true);
    expect(cancelSpy).not.toHaveBeenCalled();

    component.confirmCancel();
    fixture.detectChanges();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledWith('m-1');
    expect(successSpy).toHaveBeenCalledWith('Manutenção cancelada.');
  });

  it('409 do concluir vira banner inline, sem toast', () => {
    configure(scheduled);
    concludeSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              field: 'status',
              message: 'Só é possível concluir manutenções agendadas ou em andamento.',
            },
          }),
      ),
    );

    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      askConclude: (m: MaintenanceListItem) => void;
      confirmConclude: (reading: number) => void;
    };

    component.askConclude(scheduled);
    component.confirmConclude(51000);
    fixture.detectChanges();

    const banners = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-alert-banner'),
    );
    expect(
      banners.some((b) =>
        b.textContent?.includes('Só é possível concluir manutenções agendadas ou em andamento.'),
      ),
    ).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // O painel do kebab é `z-[60]` e o diálogo `z-50`: um menu que não fecha cobre
  // o diálogo e mantém seus itens tabuláveis por cima de um `aria-modal`.
  it.each(['Concluir', 'Cancelar manutenção'])(
    'fecha o menu de ações ao abrir o diálogo de "%s"',
    (label) => {
      configure(scheduled);
      const fixture = TestBed.createComponent(MaintenancesList);
      fixture.detectChanges();

      const menu = (fixture.nativeElement as HTMLElement).querySelector(
        'app-actions-menu',
      ) as HTMLElement;
      menu.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
      fixture.detectChanges();
      expect(menu.querySelector('[role="menu"]')).not.toBeNull();

      Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((el) => el.textContent?.trim() === label)
        ?.click();
      fixture.detectChanges();

      expect(menu.querySelector('[role="menu"]')).toBeNull();
    },
  );

  it('recarrega a página atual depois de concluir com sucesso', () => {
    configure(scheduled);
    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    // 1 chamada é o carregamento inicial do ngOnInit.
    expect(listSpy).toHaveBeenCalledTimes(1);

    const component = fixture.componentInstance as unknown as {
      askConclude: (m: MaintenanceListItem) => void;
      confirmConclude: (reading: number) => void;
    };
    component.askConclude(scheduled);
    component.confirmConclude(51000);
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 0 }));
  });

  it('recarrega a página atual depois de cancelar com sucesso', () => {
    configure(scheduled);
    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      askCancel: (m: MaintenanceListItem) => void;
      confirmCancel: () => void;
    };
    component.askCancel(scheduled);
    component.confirmCancel();
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  // No mobile o kebab pode estar muitas linhas acima: fechar o diálogo e mandar
  // a mensagem para o banner perde o valor digitado numa falha CORRIGÍVEL.
  it('400 no concluir mantém o diálogo aberto, com o valor digitado e a mensagem dentro dele', () => {
    configure(scheduled);
    concludeSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              field: 'hodometerReading',
              message: 'Hodômetro (40000 km) menor que o atual do veículo (51000 km).',
            },
          }),
      ),
    );

    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const component = fixture.componentInstance as unknown as {
      askConclude: (m: MaintenanceListItem) => void;
      concludeOpen: () => boolean;
    };
    component.askConclude(scheduled);
    fixture.detectChanges();

    const input = host.querySelector<HTMLInputElement>('#conclude-maint-hodometer');
    input!.value = '40000';
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent?.trim() === 'Concluir manutenção')
      ?.click();
    fixture.detectChanges();

    expect(component.concludeOpen()).toBe(true);
    expect(host.querySelector<HTMLInputElement>('#conclude-maint-hodometer')?.value).toBe('40000');
    expect(host.querySelector('#conclude-maint-server-error')?.textContent).toContain(
      'Hodômetro (40000 km) menor que o atual do veículo (51000 km).',
    );
    // A mensagem corrigível NÃO vai para o banner fora do diálogo.
    expect(
      Array.from(host.querySelectorAll('app-alert-banner')).some((b) =>
        b.textContent?.includes('menor que o atual'),
      ),
    ).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('falha ao buscar o hodômetro do veículo troca a dica por um pedido explícito', () => {
    configure(scheduled);
    vehicleGetOneSpy.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: {} })),
    );

    const fixture = TestBed.createComponent(MaintenancesList);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      askConclude: (m: MaintenanceListItem) => void;
    };
    component.askConclude(scheduled);
    fixture.detectChanges();

    const hint = (fixture.nativeElement as HTMLElement).querySelector('#conclude-maint-hint');
    expect(hint?.textContent).toContain('Digite a leitura atual');
  });
});
