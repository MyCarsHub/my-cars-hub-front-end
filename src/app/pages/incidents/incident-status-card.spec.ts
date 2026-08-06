import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IncidentStatusCard, OPTIMISTIC_LOCK_MESSAGE } from './incident-status-card';
import { VehicleIncidentsService } from '../../services/vehicle-incidents.service';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import type {
  ChangeInsuranceStatusRequest,
  ChangeResolutionStatusRequest,
  IncidentInsuranceStatus,
  IncidentResolutionStatus,
  VehicleIncident,
} from '../../types/vehicle-incident.types';

/**
 * As DUAS máquinas de estado do sinistro — o coração da tela.
 *
 * O que está travado aqui:
 *  - só transições ALCANÇÁVEIS viram botão (nada que levaria a 409);
 *  - cada alvo pede o campo que ele exige NO MESMO passo, e o confirmar fica
 *    bloqueado enquanto o campo não vier;
 *  - as duas dimensões são distinguíveis SEM depender de cor;
 *  - o 409 da trava otimista tem mensagem própria e recarrega o estado.
 */
describe('IncidentStatusCard — as duas máquinas de estado', () => {
  const INCIDENT_ID = 'inc-1';

  function incidentWith(
    resolutionStatus: IncidentResolutionStatus,
    insuranceStatus: IncidentInsuranceStatus,
    overrides: Partial<VehicleIncident> = {},
  ): VehicleIncident {
    return {
      id: INCIDENT_ID,
      createdDate: '2026-03-01T10:00:00',
      modifyDate: null,
      companyId: 'co-1',
      vehicleId: 'v-1',
      rentalId: null,
      driverId: null,
      insuranceId: null,
      incidentType: 'COLLISION',
      incidentTypeLabel: 'Colisão',
      occurredAt: '2026-03-01T09:00:00',
      location: 'Av. Paulista',
      description: 'Colisão traseira',
      atFaultParty: 'UNKNOWN',
      estimatedCostCents: 250000,
      actualCostCents: null,
      deductibleCents: null,
      indemnifiedAmountCents: null,
      netCostCents: 0,
      insuranceClaimNumber: null,
      insuranceStatus,
      insuranceStatusLabel: insuranceStatus,
      resolutionStatus,
      resolutionStatusLabel: resolutionStatus,
      resolvedAt: null,
      thirdPartyName: null,
      thirdPartyDocument: null,
      thirdPartyPhone: null,
      thirdPartyPlate: null,
      notes: null,
      vehicleTakenOutOfService: null,
      ...overrides,
    };
  }

  interface CardInternals {
    resolutionOptions(): ReadonlyArray<{ target: string; targetLabel: string }>;
    insuranceOptions(): ReadonlyArray<{ target: string; targetLabel: string }>;
    openTransition(option: { target: string }): void;
    confirm(): void;
    canConfirm(): boolean;
    missingRequired(): string | null;
    cardError(): string | null;
    sheetError(): string | null;
    actualCostReais: { set(v: number | null): void };
    claimNumber: { set(v: string): void };
    indemnifiedReais: { set(v: number | null): void };
  }

  let changeResolutionStatus: ReturnType<typeof vi.fn>;
  let changeInsuranceStatus: ReturnType<typeof vi.fn>;
  let getOne: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<IncidentStatusCard>;

  function api(): CardInternals {
    return fixture.componentInstance as unknown as CardInternals;
  }

  async function setup(incident: VehicleIncident): Promise<void> {
    fixture = TestBed.createComponent(IncidentStatusCard);
    fixture.componentRef.setInput('incident', incident);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Abre a transição cujo alvo é `target` na dimensão correspondente. */
  function open(target: string): void {
    const option =
      api().resolutionOptions().find((o) => o.target === target) ??
      api().insuranceOptions().find((o) => o.target === target);
    expect(option, `transição para ${target} deveria estar disponível`).toBeDefined();
    api().openTransition(option!);
    fixture.detectChanges();
  }

  beforeEach(() => {
    changeResolutionStatus = vi.fn(() => of(incidentWith('RESOLVED', 'NOT_FILED')));
    changeInsuranceStatus = vi.fn(() => of(incidentWith('OPEN', 'FILED')));
    getOne = vi.fn(() => of(incidentWith('WRITTEN_OFF', 'DENIED')));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        {
          provide: VehicleIncidentsService,
          useValue: { changeResolutionStatus, changeInsuranceStatus, getOne },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
        },
        {
          provide: ApiErrorService,
          useValue: {
            claim: vi.fn(),
            messageFor: vi.fn((_e: unknown, fallback?: string) => fallback ?? 'Erro'),
          },
        },
      ],
    });
  });

  // ------------------------------------- só transições válidas são oferecidas

  it('OPEN oferece apenas em reparo, resolvido e perda total — nunca voltar atrás', async () => {
    await setup(incidentWith('OPEN', 'NOT_FILED'));

    expect(api().resolutionOptions().map((o) => o.target)).toEqual([
      'IN_REPAIR',
      'RESOLVED',
      'WRITTEN_OFF',
    ]);
  });

  it('IN_REPAIR não oferece voltar para OPEN — a máquina não tem marcha à ré', async () => {
    await setup(incidentWith('IN_REPAIR', 'NOT_FILED'));

    const targets = api().resolutionOptions().map((o) => o.target);
    expect(targets).toEqual(['RESOLVED', 'WRITTEN_OFF']);
    expect(targets).not.toContain('OPEN');
  });

  it.each(['RESOLVED', 'WRITTEN_OFF'] as const)(
    'estado terminal %s não oferece nenhuma transição de veículo',
    async (status) => {
      await setup(incidentWith(status, 'NOT_FILED'));

      expect(api().resolutionOptions()).toHaveLength(0);
      expect(fixture.nativeElement.textContent).toContain('Estado final');
    },
  );

  it('NOT_FILED só oferece acionar o seguro — não dá para pular direto para pago', async () => {
    await setup(incidentWith('OPEN', 'NOT_FILED'));

    const targets = api().insuranceOptions().map((o) => o.target);
    expect(targets).toEqual(['FILED']);
    expect(targets).not.toContain('PAID');
    expect(targets).not.toContain('APPROVED');
  });

  it('APROVADO só avança para pago; negado não é mais alcançável', async () => {
    await setup(incidentWith('OPEN', 'APPROVED'));

    const targets = api().insuranceOptions().map((o) => o.target);
    expect(targets).toEqual(['PAID']);
    expect(targets).not.toContain('DENIED');
  });

  it.each(['DENIED', 'PAID'] as const)(
    'estado terminal de seguro %s não oferece transição',
    async (status) => {
      await setup(incidentWith('OPEN', status));

      expect(api().insuranceOptions()).toHaveLength(0);
    },
  );

  /**
   * As duas dimensões avançam de forma INDEPENDENTE: um carro consertado com o
   * seguro ainda em análise precisa continuar oferecendo o avanço do processo.
   */
  it('veículo em estado terminal não congela o processo de seguro', async () => {
    await setup(incidentWith('RESOLVED', 'FILED'));

    expect(api().resolutionOptions()).toHaveLength(0);
    expect(api().insuranceOptions().map((o) => o.target)).toEqual(['APPROVED', 'DENIED']);
  });

  // -------------------------------- cada transição pede seu campo obrigatório

  it.each(['RESOLVED', 'WRITTEN_OFF'] as const)(
    'encerrar como %s exige o custo real no mesmo passo',
    async (target) => {
      await setup(incidentWith('OPEN', 'NOT_FILED'));
      open(target);

      expect(api().canConfirm()).toBe(false);
      expect(api().missingRequired()).toContain('custo real');

      api().confirm();
      expect(changeResolutionStatus).not.toHaveBeenCalled();

      api().actualCostReais.set(1500.5);
      fixture.detectChanges();
      expect(api().canConfirm()).toBe(true);

      api().confirm();
      expect(changeResolutionStatus).toHaveBeenCalledTimes(1);
      const [id, payload] = changeResolutionStatus.mock.calls[0] as [
        string,
        ChangeResolutionStatusRequest,
      ];
      expect(id).toBe(INCIDENT_ID);
      expect(payload.status).toBe(target);
      // Centavos, sempre — 1500,50 vira 150050.
      expect(payload.actualCostCents).toBe(150050);
    },
  );

  it('ir para em reparo NÃO exige custo real', async () => {
    await setup(incidentWith('OPEN', 'NOT_FILED'));
    open('IN_REPAIR');

    expect(api().canConfirm()).toBe(true);
    api().confirm();

    const [, payload] = changeResolutionStatus.mock.calls[0] as [
      string,
      ChangeResolutionStatusRequest,
    ];
    expect(payload.status).toBe('IN_REPAIR');
  });

  it('acionar o seguro exige o número do sinistro no mesmo passo', async () => {
    await setup(incidentWith('OPEN', 'NOT_FILED'));
    open('FILED');

    expect(api().canConfirm()).toBe(false);
    expect(api().missingRequired()).toContain('número do sinistro');

    api().confirm();
    expect(changeInsuranceStatus).not.toHaveBeenCalled();

    api().claimNumber.set('SIN-2026-0042');
    fixture.detectChanges();
    api().confirm();

    const [, payload] = changeInsuranceStatus.mock.calls[0] as [
      string,
      ChangeInsuranceStatusRequest,
    ];
    expect(payload.status).toBe('FILED');
    expect(payload.insuranceClaimNumber).toBe('SIN-2026-0042');
  });

  it('marcar como indenizado exige o valor indenizado no mesmo passo', async () => {
    await setup(incidentWith('OPEN', 'APPROVED', { insuranceClaimNumber: 'SIN-1' }));
    open('PAID');

    expect(api().canConfirm()).toBe(false);
    expect(api().missingRequired()).toContain('valor indenizado');

    api().confirm();
    expect(changeInsuranceStatus).not.toHaveBeenCalled();

    api().indemnifiedReais.set(3200);
    fixture.detectChanges();
    api().confirm();

    const [, payload] = changeInsuranceStatus.mock.calls[0] as [
      string,
      ChangeInsuranceStatusRequest,
    ];
    expect(payload.status).toBe('PAID');
    expect(payload.indemnifiedAmountCents).toBe(320000);
  });

  it('negar o sinistro não exige valor indenizado', async () => {
    await setup(incidentWith('OPEN', 'FILED', { insuranceClaimNumber: 'SIN-1' }));
    open('DENIED');

    expect(api().canConfirm()).toBe(true);
  });

  // -------------------------------------------------- trava otimista (409)

  /**
   * O 409 sem `fieldErrors.status` é a trava otimista do backend. Uma mensagem
   * genérica ("este registro já existe ou está em uso") não diria o que houve —
   * e o que houve é que outra pessoa mudou o desfecho no meio da edição.
   */
  it('conflito de trava otimista mostra mensagem própria e recarrega o estado', async () => {
    changeResolutionStatus.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'O sinistro mudou de status enquanto esta alteração era processada.' },
          }),
      ),
    );
    await setup(incidentWith('OPEN', 'NOT_FILED'));
    open('RESOLVED');
    api().actualCostReais.set(100);
    fixture.detectChanges();

    api().confirm();
    fixture.detectChanges();

    expect(api().cardError()).toBe(OPTIMISTIC_LOCK_MESSAGE);
    expect(api().cardError()).toContain('Alguém mudou o estado');
    // Recarregou do servidor em vez de manter a cópia velha na tela.
    expect(getOne).toHaveBeenCalledWith(INCIDENT_ID);
    // E o estado recarregado (terminal) já não oferece transição nenhuma.
    expect(api().resolutionOptions()).toHaveLength(0);
  });

  it('conflito republica o sinistro recarregado para o pai', async () => {
    changeInsuranceStatus.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'conflito' } })),
    );
    await setup(incidentWith('OPEN', 'NOT_FILED'));

    const emitted: VehicleIncident[] = [];
    fixture.componentInstance.changed.subscribe((i) => emitted.push(i));

    open('FILED');
    api().claimNumber.set('SIN-9');
    fixture.detectChanges();
    api().confirm();
    fixture.detectChanges();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].insuranceStatus).toBe('DENIED');
  });

  /**
   * 409 COM `fieldErrors.status` é transição inválida — a tela não deveria ter
   * oferecido o botão, então nossa cópia envelheceu. Mostra o motivo do backend
   * e recarrega igual.
   */
  it('409 de transição inválida mostra o motivo do backend e recarrega', async () => {
    changeResolutionStatus.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              message: 'Sinistro já está em "Resolvido", que é um estado final.',
              fieldErrors: { status: 'Sinistro já está em "Resolvido", que é um estado final.' },
            },
          }),
      ),
    );
    await setup(incidentWith('OPEN', 'NOT_FILED'));
    open('IN_REPAIR');
    api().confirm();
    fixture.detectChanges();

    expect(api().cardError()).toContain('estado final');
    expect(getOne).toHaveBeenCalledWith(INCIDENT_ID);
  });

  it('erro que NÃO é 409 fica dentro da folha, que segue aberta', async () => {
    changeResolutionStatus.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    await setup(incidentWith('OPEN', 'NOT_FILED'));
    open('IN_REPAIR');
    api().confirm();
    fixture.detectChanges();

    expect(api().sheetError()).toBeTruthy();
    expect(api().cardError()).toBeNull();
    expect(getOne).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------ acessibilidade

  /**
   * WCAG AA: as duas dimensões não podem ser distinguíveis só por cor, e o
   * usuário precisa saber a qual delas cada rótulo pertence. "Resolvido" (o
   * carro) e "Indenizado" (o seguro) são ambos verdes de propósito — o que os
   * separa é o prefixo e o glifo.
   */
  it('cada situação vem rotulada com a dimensão a que pertence', async () => {
    await setup(incidentWith('IN_REPAIR', 'FILED'));
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Situação do veículo');
    expect(text).toContain('Processo de seguro');
    // O prefixo é o que separa as duas dimensões. Sem ele, "Resolvido" (o
    // carro) e "Indenizado" (o seguro) seriam dois rótulos verdes iguais.
    expect(text).toContain('Veículo: Em reparo');
    expect(text).toContain('Seguro: Aberto na seguradora');
  });

  it('cada seção de status é uma região nomeada e os botões têm nome acessível', async () => {
    await setup(incidentWith('OPEN', 'NOT_FILED'));
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[aria-labelledby="incident-resolution-heading"]')).not.toBeNull();
    expect(host.querySelector('[aria-labelledby="incident-insurance-heading"]')).not.toBeNull();

    const labels = Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-label]')).map(
      (b) => b.getAttribute('aria-label'),
    );
    expect(labels).toContain('Mudar situação do veículo para Em reparo');
    expect(labels).toContain('Mudar processo de seguro para Aberto na seguradora');
  });

  it('a folha de transição é um diálogo modal com título associado', async () => {
    await setup(incidentWith('OPEN', 'NOT_FILED'));
    open('IN_REPAIR');

    const dialog = (fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('incident-transition-title');
    expect(dialog?.textContent).toContain('Veículo: mudar para "Em reparo"');
  });
});
