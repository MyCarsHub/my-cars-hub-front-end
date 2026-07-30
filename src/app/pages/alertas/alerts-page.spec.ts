import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AlertsPage } from './alerts-page';
import { AlertsService } from '../../services/alerts.service';
import type {
  AlertWindow,
  DocumentAlert,
  NotificationType,
} from '../../types/notification-feed.types';

/**
 * Cobre `/alertas`:
 *  - agrupamento por urgência na ordem Vencidos → 7 → 15 → 30, sem seções vazias;
 *  - filtro por tipo é local (não refaz a requisição) e o de janela refaz;
 *  - aviso discreto quando o backend devolve exatamente o teto de 200 linhas;
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

  let documentAlerts: ReturnType<typeof signal<DocumentAlert[]>>;
  let listSpy: ReturnType<typeof vi.fn>;

  interface PageInternals {
    groups: () => { key: string; label: string; alerts: DocumentAlert[] }[];
    onTypeChange: (value: NotificationType | 'ALL') => void;
    onWindowChange: (value: AlertWindow) => void;
  }

  function configure(): void {
    documentAlerts = signal<DocumentAlert[]>([]);
    listSpy = vi.fn().mockImplementation(() => of(documentAlerts()));

    TestBed.configureTestingModule({
      imports: [AlertsPage],
      providers: [
        provideRouter([]),
        {
          provide: AlertsService,
          useValue: {
            documentAlerts,
            loading: signal(false),
            error: signal<string | null>(null),
            listDocumentAlerts: listSpy,
          },
        },
      ],
    });
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    configure();
  });

  it('agrupa por urgência na ordem Vencidos → 7 → 15 → 30 e omite grupos vazios', () => {
    documentAlerts.set([
      alert({ entityId: 'a', daysRemaining: -5 }),
      alert({ entityId: 'b', daysRemaining: 3 }),
      alert({ entityId: 'c', daysRemaining: 22 }),
    ]);

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const groups = (fixture.componentInstance as unknown as PageInternals).groups();
    expect(groups.map((g) => g.label)).toEqual(['Vencidos', 'Próximos 7 dias', 'Próximos 30 dias']);
    expect(groups[0].alerts[0].entityId).toBe('a');
  });

  it('inclui itens já vencidos (daysRemaining negativo) com rótulo "vencido há"', () => {
    documentAlerts.set([alert({ entityId: 'a', daysRemaining: -2 })]);

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('vencido há 2 dia(s)');
  });

  it('filtra por tipo localmente, sem nova requisição', () => {
    documentAlerts.set([
      alert({ entityId: 'a', daysRemaining: 3, type: 'CNH_DUE_SOON' }),
      alert({ entityId: 'b', daysRemaining: 4, type: 'INSURANCE_DUE_SOON' }),
    ]);

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as PageInternals;
    const callsBefore = listSpy.mock.calls.length;

    component.onTypeChange('INSURANCE_DUE_SOON');
    fixture.detectChanges();

    expect(listSpy.mock.calls.length).toBe(callsBefore);
    const flattened = component.groups().flatMap((g) => g.alerts);
    expect(flattened).toHaveLength(1);
    expect(flattened[0].entityId).toBe('b');
  });

  it('trocar a janela refaz a requisição com o novo withinDays', () => {
    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    expect(listSpy).toHaveBeenLastCalledWith(30);

    (fixture.componentInstance as unknown as PageInternals).onWindowChange(7);

    expect(listSpy).toHaveBeenLastCalledWith(7);
  });

  it('oferece as janelas 1/7/15/30 com o rótulo de 1 dia no singular', () => {
    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const chips = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[aria-labelledby="alerts-window-label"] button'),
    );

    expect(chips.map((b) => b.textContent?.trim())).toEqual([
      '1 dia',
      '7 dias',
      '15 dias',
      '30 dias',
    ]);
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

    expect(listSpy).toHaveBeenLastCalledWith(1);
    expect(chips[0].getAttribute('aria-checked')).toBe('true');
    expect(chips[3].getAttribute('aria-checked')).toBe('false');
  });

  it('avisa que a lista está truncada quando vêm exatamente 200 linhas', () => {
    documentAlerts.set(
      Array.from({ length: 200 }, (_, i) => alert({ entityId: `a${i}`, daysRemaining: 1 })),
    );

    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Mostrando os 200 vencimentos mais próximos.',
    );
  });

  it('mostra o estado vazio quando não há vencimentos no período', () => {
    const fixture = TestBed.createComponent(AlertsPage);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Nenhum documento vencendo neste período.',
    );
  });
});
