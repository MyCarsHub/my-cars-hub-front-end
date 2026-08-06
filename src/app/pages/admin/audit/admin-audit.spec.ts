import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AdminAudit } from './admin-audit';
import { AdminAuditService } from '../admin-audit.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type { AdminAuditActor, AdminAuditLogItem } from '../../../types/admin-audit.types';

const ENTRY: AdminAuditLogItem = {
  id: 'aud-1',
  createdDate: '2026-08-04T13:45:12',
  actorUserId: 'usr-1',
  actorName: 'Lorran',
  actorEmail: 'lorran@mycarshub.app.br',
  action: 'COMPANY_STATUS_CHANGED',
  targetType: 'COMPANY',
  targetId: '11111111-2222-3333-4444-555566667777',
  payload: 'active: true -> false',
};

const ACTORS: AdminAuditActor[] = [
  { id: 'usr-1', name: 'Lorran', email: 'lorran@mycarshub.app.br' },
];

describe('AdminAudit', () => {
  let load: ReturnType<typeof vi.fn>;
  let loadActions: ReturnType<typeof vi.fn>;
  let loadActors: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;

  const items = signal<AdminAuditLogItem[]>([]);
  const total = signal(0);
  const actions = signal<string[]>([]);
  const actors = signal<AdminAuditActor[]>([]);

  function configure(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminAudit],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: AdminAuditService,
          useValue: {
            items,
            total,
            page: signal(0),
            size: signal(20),
            loading: signal(false),
            actions,
            actors,
            load,
            loadActions,
            loadActors,
          },
        },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            success: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    items.set([]);
    total.set(0);
    actions.set([]);
    actors.set([]);
    load = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));
    loadActions = vi.fn().mockReturnValue(of([]));
    loadActors = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 100, total: 0 }));
    notifyError = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lista a trilha com ator, ação traduzida e data formatada', () => {
    items.set([ENTRY]);
    total.set(1);
    configure();

    const fixture = TestBed.createComponent(AdminAudit);
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Lorran');
    expect(text).toContain('lorran@mycarshub.app.br');
    // Enum cru vira rótulo legível em pt-BR, mas o valor cru não vaza na UI.
    expect(text).toContain('Status de empresa alterado');
    expect(text).not.toContain('COMPANY_STATUS_CHANGED');
    expect(text).toContain('04/08/2026');
    expect(text).toContain('Empresa');
    expect(load).toHaveBeenCalled();
  });

  it('popula o dropdown de ações a partir do endpoint, sem hardcode', () => {
    actions.set(['BLOG_POST_PUBLISHED', 'USER_STATUS_CHANGED']);
    configure();

    const fixture = TestBed.createComponent(AdminAudit);
    fixture.detectChanges();

    expect(loadActions).toHaveBeenCalled();
    const options: HTMLOptionElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('select'),
    )
      .flatMap((s) => Array.from((s as HTMLSelectElement).options))
      .map((o) => o as HTMLOptionElement);

    const values = options.map((o) => o.value);
    expect(values).toContain('BLOG_POST_PUBLISHED');
    expect(values).toContain('USER_STATUS_CHANGED');
    const labels = options.map((o) => o.textContent?.trim());
    expect(labels).toContain('Post publicado');
  });

  it('refaz a busca com o filtro de ação cru e volta para a primeira página', () => {
    items.set([ENTRY]);
    total.set(1);
    actions.set(['BLOG_POST_PUBLISHED']);
    actors.set(ACTORS);
    configure();

    const fixture = TestBed.createComponent(AdminAudit);
    fixture.detectChanges();
    load.mockClear();

    const component = fixture.componentInstance as unknown as {
      setActionFilter: (v: string) => void;
      setActorFilter: (v: string) => void;
      setFromFilter: (v: string) => void;
      setToFilter: (v: string) => void;
    };
    component.setActionFilter('BLOG_POST_PUBLISHED');
    component.setActorFilter('usr-1');
    component.setFromFilter('2026-08-01');
    component.setToFilter('2026-08-04');
    fixture.detectChanges();

    expect(load).toHaveBeenCalled();
    const lastArgs = load.mock.calls[load.mock.calls.length - 1][0];
    // O filtro manda o nome do enum cru — traduzir aqui daria 400 no backend.
    expect(lastArgs).toMatchObject({
      action: 'BLOG_POST_PUBLISHED',
      actorUserId: 'usr-1',
      from: '2026-08-01',
      to: '2026-08-04',
      page: 0,
      size: 20,
    });
  });

  it('mostra o estado vazio quando não há registros', () => {
    configure();

    const fixture = TestBed.createComponent(AdminAudit);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Nenhuma ação administrativa registrada ainda.',
    );
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
  });

  it('muda o texto do vazio quando há filtros aplicados', () => {
    configure();

    const fixture = TestBed.createComponent(AdminAudit);
    fixture.detectChanges();
    (
      fixture.componentInstance as unknown as { setActionFilter: (v: string) => void }
    ).setActionFilter('BLOG_POST_PUBLISHED');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Nenhuma ação registrada com esses filtros.',
    );
  });

  it('mostra a falha de carregamento inline, sem toast', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { message: 'Ação desconhecida: FOO.' },
    });
    load.mockReturnValue(throwError(() => error));
    configure();

    const fixture = TestBed.createComponent(AdminAudit);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('app-alert-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Ação desconhecida: FOO.');
    expect(banner?.querySelector('[role="alert"]')).not.toBeNull();

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
