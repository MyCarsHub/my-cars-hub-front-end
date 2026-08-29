import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { MaintenanceDetail } from './maintenance-detail';
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import type { Maintenance } from '../../types/maintenance.types';

const SCHEDULED: Maintenance = {
  id: 'mnt-1',
  createdDate: '2026-01-01T00:00:00Z',
  modifyDate: null,
  companyId: 'co-1',
  vehicleId: 'veh-1',
  type: 'PREVENTIVE',
  description: 'Revisão agendada',
  serviceDate: '2026-09-01',
  hodometerReading: null,
  costCents: 0,
  items: [],
  labourCostCents: 0,
  discountCents: 0,
  surchargeCents: 0,
  surchargeNote: null,
  provider: null,
  invoiceNumber: null,
  nextServiceDate: null,
  nextServiceHodometer: null,
  status: 'SCHEDULED',
  notes: null,
};

function render(item: Maintenance) {
  TestBed.configureTestingModule({
    imports: [MaintenanceDetail],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => item.id } } } },
      {
        provide: MaintenancesService,
        useValue: {
          getOne: vi.fn().mockReturnValue(of(item)),
          remove: vi.fn(),
          // O card de anexos (FEAT-0051) monta junto com o detalhe e carrega a
          // lista no `ngOnInit`. Sem estes quatro o stub derruba a tela inteira
          // num `TypeError`, e o que falharia seria o detalhe, não o card.
          listDocuments: vi.fn().mockReturnValue(of([])),
          uploadDocument: vi.fn(),
          deleteDocument: vi.fn(),
          documentSignedUrl: vi.fn(),
        },
      },
      { provide: VehiclesService, useValue: { getOne: vi.fn().mockReturnValue(EMPTY) } },
    ],
  });

  const fixture = TestBed.createComponent(MaintenanceDetail);
  fixture.detectChanges();
  return fixture;
}

/**
 * Fluxo de concluir/cancelar no detalhe:
 *  - os botões só existem em SCHEDULED / IN_PROGRESS;
 *  - concluir manda o hodômetro digitado e atualiza o registro na própria tela;
 *  - 409 vira banner inline, sem toast;
 *  - cancelar confirma antes de chamar o service.
 */
describe('MaintenanceDetail — concluir e cancelar', () => {
  function setup(item: Maintenance) {
    const concludeSpy = vi.fn().mockReturnValue(of({ ...item, status: 'DONE' as const }));
    const cancelSpy = vi.fn().mockReturnValue(of({ ...item, status: 'CANCELED' as const }));
    const successSpy = vi.fn();
    const toastErrorSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [MaintenanceDetail],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => item.id } } } },
        {
          provide: MaintenancesService,
          useValue: {
            getOne: vi.fn().mockReturnValue(of(item)),
            remove: vi.fn(),
            conclude: concludeSpy,
            cancel: cancelSpy,
            // Ver a nota do outro stub: o card de anexos monta junto com o
            // detalhe e chama `listDocuments` no `ngOnInit`.
            listDocuments: vi.fn().mockReturnValue(of([])),
            uploadDocument: vi.fn(),
            deleteDocument: vi.fn(),
            documentSignedUrl: vi.fn(),
          },
        },
        {
          provide: VehiclesService,
          useValue: {
            getOne: vi.fn().mockReturnValue(
              of({
                id: item.vehicleId,
                plate: 'ABC1D23',
                brand: 'Fiat',
                model: 'Argo',
                type: 'CAR',
                hodometer: 78000,
                licensingExpiration: null,
              }),
            ),
          },
        },
        { provide: NotificationService, useValue: { success: successSpy, error: toastErrorSpy } },
      ],
    });

    const fixture = TestBed.createComponent(MaintenanceDetail);
    fixture.detectChanges();
    return { fixture, concludeSpy, cancelSpy, successSpy, toastErrorSpy };
  }

  function buttonByText(fixture: { nativeElement: unknown }, text: string): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).filter((b) => b.textContent?.trim() === text);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it.each(['SCHEDULED', 'IN_PROGRESS'] as const)('mostra as duas ações em %s', (status) => {
    const { fixture } = setup({ ...SCHEDULED, status });

    // Uma instância por breakpoint (desktop + mobile), ambas renderizadas no DOM.
    expect(buttonByText(fixture, 'Concluir').length).toBe(2);
    expect(buttonByText(fixture, 'Cancelar manutenção').length).toBe(2);
  });

  it.each(['DONE', 'CANCELED'] as const)('esconde as duas ações em %s', (status) => {
    const { fixture } = setup({ ...SCHEDULED, status, hodometerReading: 45000 });

    expect(buttonByText(fixture, 'Concluir')).toHaveLength(0);
    expect(buttonByText(fixture, 'Cancelar manutenção')).toHaveLength(0);
  });

  it('concluir envia o hodômetro pré-preenchido pelo veículo e atualiza o status na tela', () => {
    const { fixture, concludeSpy, successSpy } = setup(SCHEDULED);

    buttonByText(fixture, 'Concluir')[0].click();
    fixture.detectChanges();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#conclude-maint-hodometer',
    );
    expect(input?.value).toBe('78000');
    expect(concludeSpy).not.toHaveBeenCalled();

    buttonByText(fixture, 'Concluir manutenção')[0].click();
    fixture.detectChanges();

    expect(concludeSpy).toHaveBeenCalledTimes(1);
    expect(concludeSpy).toHaveBeenCalledWith('mnt-1', { hodometerReading: 78000 });
    expect(successSpy).toHaveBeenCalledWith('Manutenção concluída.');
    // Permanece na tela, agora sem as ações de transição.
    expect(buttonByText(fixture, 'Concluir')).toHaveLength(0);
  });

  it('409 no concluir mostra banner inline e não dispara toast', () => {
    const { fixture, concludeSpy, toastErrorSpy } = setup(SCHEDULED);
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

    const component = fixture.componentInstance as unknown as {
      askConclude: () => void;
      confirmConclude: (reading: number) => void;
    };
    component.askConclude();
    component.confirmConclude(78000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Só é possível concluir manutenções agendadas ou em andamento.');
    expect(toastErrorSpy).not.toHaveBeenCalled();
  });

  // No mobile os botões ficam no FIM de uma página longa: fechar o diálogo e
  // mandar a mensagem para o banner some da tela e apaga o valor digitado.
  it('400 no concluir mantém o diálogo aberto, com o valor digitado e a mensagem dentro dele', () => {
    const { fixture, concludeSpy, toastErrorSpy } = setup(SCHEDULED);
    concludeSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              field: 'hodometerReading',
              message: 'Hodômetro (40000 km) menor que o atual do veículo (78000 km).',
            },
          }),
      ),
    );

    const host = fixture.nativeElement as HTMLElement;
    buttonByText(fixture, 'Concluir')[0].click();
    fixture.detectChanges();

    const input = host.querySelector<HTMLInputElement>('#conclude-maint-hodometer')!;
    input.value = '40000';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    buttonByText(fixture, 'Concluir manutenção')[0].click();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as { concludeOpen: () => boolean };
    expect(component.concludeOpen()).toBe(true);
    expect(host.querySelector<HTMLInputElement>('#conclude-maint-hodometer')?.value).toBe('40000');
    expect(host.querySelector('#conclude-maint-server-error')?.textContent).toContain(
      'menor que o atual do veículo',
    );
    expect(host.querySelector('app-alert-banner')).toBeNull();
    expect(toastErrorSpy).not.toHaveBeenCalled();
  });

  it('cancelar só chama o service depois da confirmação', () => {
    const { fixture, cancelSpy, successSpy } = setup(SCHEDULED);

    buttonByText(fixture, 'Cancelar manutenção')[0].click();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      cancelOpen: () => boolean;
      confirmCancel: () => void;
    };
    expect(component.cancelOpen()).toBe(true);
    expect(cancelSpy).not.toHaveBeenCalled();

    component.confirmCancel();
    fixture.detectChanges();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledWith('mnt-1');
    expect(successSpy).toHaveBeenCalledWith('Manutenção cancelada.');
  });
});

describe('MaintenanceDetail — hodômetro nulo', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('mostra "Não informado" quando hodometerReading é null', () => {
    const fixture = render(SCHEDULED);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Não informado');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('null');
  });

  it('formata o valor quando presente', () => {
    const fixture = render({ ...SCHEDULED, hodometerReading: 45000, status: 'DONE' });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('km');
    expect(text).not.toContain('Não informado');
  });
});
