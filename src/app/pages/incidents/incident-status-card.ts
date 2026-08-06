import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { animate, style, transition, trigger } from '@angular/animations';
import { PageCard } from '../../components/core/page-card/page-card';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { parseApiError } from '../../services/api-error';
import { VehicleIncidentsService } from '../../services/vehicle-incidents.service';
import { toCents, toReais } from '../../components/vehicles/insurance-form-fields/insurance-utils';
import {
  INCIDENT_INSURANCE_META,
  INCIDENT_INSURANCE_TRANSITIONS,
  INCIDENT_RESOLUTION_META,
  INCIDENT_RESOLUTION_TRANSITIONS,
  INSURANCE_DIMENSION_LABEL,
  IncidentInsuranceStatus,
  IncidentResolutionStatus,
  IncidentStatusMeta,
  RESOLUTION_DIMENSION_LABEL,
  VehicleIncident,
  insuranceRequiresClaimNumber,
  insuranceRequiresIndemnified,
  resolutionRequiresActualCost,
} from '../../types/vehicle-incident.types';

/** Qual das duas máquinas de estado uma ação move. */
export type IncidentDimension = 'RESOLUTION' | 'INSURANCE';

/** Uma transição oferecida, já resolvida com o que ela exige. */
export interface OfferedTransition {
  dimension: IncidentDimension;
  target: string;
  targetLabel: string;
  targetIcon: string;
  needsActualCost: boolean;
  needsClaimNumber: boolean;
  needsIndemnified: boolean;
}

/**
 * Mensagem própria da trava otimista. Um 409 genérico ("este registro já existe
 * ou está em uso") não diria ao usuário o que houve nem o que fazer — e o que
 * houve é que OUTRA pessoa mudou o desfecho enquanto esta tela estava aberta.
 */
export const OPTIMISTIC_LOCK_MESSAGE =
  'Alguém mudou o estado deste sinistro enquanto você editava. ' +
  'Recarregamos os dados — confira a situação atual e refaça a alteração se ainda fizer sentido.';

/**
 * As DUAS máquinas de estado do sinistro, lado a lado — e essa vizinhança é o
 * ponto da tela.
 *
 * Elas são INDEPENDENTES: o carro pode voltar a rodar antes de a seguradora
 * pagar, e a seguradora pode pagar muito depois de o carro estar consertado.
 * Por isso cada uma vive na sua própria seção, com título próprio, e cada chip
 * carrega o prefixo da dimensão ("Veículo:" / "Seguro:") junto com um glifo
 * próprio: confundir "Resolvido" (o carro) com "Indenizado" (o seguro) é o erro
 * que esta interface existe para impedir, e ele não pode depender de o usuário
 * distinguir verde de verde.
 *
 * Só as transições ALCANÇÁVEIS a partir do estado atual viram botão — a tela
 * nunca oferece um caminho que o backend recusaria com 409. E quando o alvo
 * exige um campo (custo real, número do sinistro, valor indenizado), ele é
 * pedido NO MESMO passo, não numa edição posterior.
 */
@Component({
  selector: 'app-incident-status-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [FormsModule, PageCard, AlertBanner],
  templateUrl: './incident-status-card.html',
  animations: [
    trigger('sheetBackdrop', [
      transition(':enter', [style({ opacity: 0 }), animate('150ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('sheet', [
      transition(':enter', [
        style({ transform: 'translateY(100%)' }),
        animate('200ms cubic-bezier(0.4, 0, 0.2, 1)', style({ transform: 'translateY(0)' })),
      ]),
      transition(':leave', [
        animate('150ms cubic-bezier(0.4, 0, 0.2, 1)', style({ transform: 'translateY(100%)' })),
      ]),
    ]),
  ],
})
export class IncidentStatusCard {
  private readonly incidentsService = inject(VehicleIncidentsService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  readonly incident = input.required<VehicleIncident>();
  /** Publica o sinistro atualizado (transição concluída OU recarga pós-conflito). */
  readonly changed = output<VehicleIncident>();

  /**
   * Estado local semeado pelo input: o PATCH já devolve o sinistro inteiro, a
   * UI reflete a mutação sem esperar o pai recarregar, e volta a acompanhar o
   * input quando ele muda de fato.
   */
  protected readonly current = linkedSignal<VehicleIncident>(() => this.incident());

  protected readonly resolutionDimensionLabel = RESOLUTION_DIMENSION_LABEL;
  protected readonly insuranceDimensionLabel = INSURANCE_DIMENSION_LABEL;

  protected readonly resolutionMeta = computed<IncidentStatusMeta>(
    () => INCIDENT_RESOLUTION_META[this.current().resolutionStatus],
  );
  protected readonly insuranceMeta = computed<IncidentStatusMeta>(
    () => INCIDENT_INSURANCE_META[this.current().insuranceStatus],
  );

  /** Transições operacionais alcançáveis AGORA. Vazio = estado terminal. */
  protected readonly resolutionOptions = computed<OfferedTransition[]>(() =>
    INCIDENT_RESOLUTION_TRANSITIONS[this.current().resolutionStatus].map((target) => ({
      dimension: 'RESOLUTION' as const,
      target,
      targetLabel: INCIDENT_RESOLUTION_META[target].label,
      targetIcon: INCIDENT_RESOLUTION_META[target].icon,
      needsActualCost: resolutionRequiresActualCost(target),
      needsClaimNumber: false,
      needsIndemnified: false,
    })),
  );

  /** Transições do processo alcançáveis AGORA. Vazio = estado terminal. */
  protected readonly insuranceOptions = computed<OfferedTransition[]>(() =>
    INCIDENT_INSURANCE_TRANSITIONS[this.current().insuranceStatus].map((target) => ({
      dimension: 'INSURANCE' as const,
      target,
      targetLabel: INCIDENT_INSURANCE_META[target].label,
      targetIcon: INCIDENT_INSURANCE_META[target].icon,
      needsActualCost: false,
      needsClaimNumber: insuranceRequiresClaimNumber(target),
      needsIndemnified: insuranceRequiresIndemnified(target),
    })),
  );

  // ------------------------------------------------------------ folha aberta

  protected readonly pending = signal<OfferedTransition | null>(null);
  protected readonly saving = signal(false);
  /** Erro do card (recarga pós-conflito). Fica fora da folha, que já fechou. */
  protected readonly cardError = signal<string | null>(null);
  /** Erro da folha — precisa viver DENTRO dela, senão some atrás do overlay. */
  protected readonly sheetError = signal<string | null>(null);

  protected readonly actualCostReais = signal<number | null>(null);
  protected readonly claimNumber = signal('');
  protected readonly indemnifiedReais = signal<number | null>(null);
  protected readonly deductibleReais = signal<number | null>(null);
  protected readonly notes = signal('');

  protected readonly sheetTitle = computed(() => {
    const p = this.pending();
    if (!p) return '';
    const dimension =
      p.dimension === 'RESOLUTION' ? RESOLUTION_DIMENSION_LABEL : INSURANCE_DIMENSION_LABEL;
    return `${dimension}: mudar para "${p.targetLabel}"`;
  });

  /**
   * Bloqueia o confirmar enquanto falta um campo que o alvo exige. O backend
   * recusaria com 400 — a diferença é que aqui o usuário vê a exigência antes
   * de gastar um round-trip, no mesmo passo em que escolheu a transição.
   */
  protected readonly missingRequired = computed<string | null>(() => {
    const p = this.pending();
    if (!p) return null;
    if (p.needsActualCost && this.actualCostReais() == null) {
      return 'Informe o custo real para encerrar o sinistro.';
    }
    if (p.needsClaimNumber && this.claimNumber().trim().length === 0) {
      return 'Informe o número do sinistro na seguradora para acioná-lo.';
    }
    if (p.needsIndemnified && this.indemnifiedReais() == null) {
      return 'Informe o valor indenizado para marcar como indenizado.';
    }
    return null;
  });

  protected readonly canConfirm = computed(() => this.missingRequired() === null);

  /**
   * Abre a folha já semeada com o que o sinistro tem: o backend aceita omitir
   * um campo obrigatório quando ele JÁ está gravado, mas mostrar o valor atual
   * deixa o usuário confirmar ou corrigir em vez de adivinhar o que existe.
   */
  protected openTransition(option: OfferedTransition): void {
    const incident = this.current();
    this.sheetError.set(null);
    this.cardError.set(null);
    this.actualCostReais.set(toReais(incident.actualCostCents));
    this.claimNumber.set(incident.insuranceClaimNumber ?? '');
    this.indemnifiedReais.set(toReais(incident.indemnifiedAmountCents));
    this.deductibleReais.set(toReais(incident.deductibleCents));
    this.notes.set('');
    this.pending.set(option);
  }

  protected closeSheet(): void {
    if (this.saving()) return;
    this.pending.set(null);
  }

  protected confirm(): void {
    const option = this.pending();
    if (!option || this.saving() || !this.canConfirm()) return;

    this.sheetError.set(null);
    this.saving.set(true);
    const id = this.current().id;

    const request$ =
      option.dimension === 'RESOLUTION'
        ? this.incidentsService.changeResolutionStatus(id, {
            status: option.target as IncidentResolutionStatus,
            actualCostCents: toCents(this.actualCostReais()),
            notes: this.notes().trim() || null,
          })
        : this.incidentsService.changeInsuranceStatus(id, {
            status: option.target as IncidentInsuranceStatus,
            insuranceClaimNumber: this.claimNumber().trim() || null,
            indemnifiedAmountCents: toCents(this.indemnifiedReais()),
            deductibleCents: toCents(this.deductibleReais()),
          });

    request$.subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.pending.set(null);
        this.current.set(updated);
        this.changed.emit(updated);
        this.notifications.success(`Situação atualizada para "${option.targetLabel}".`);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.handleTransitionError(err);
      },
    });
  }

  /**
   * O 409 deste módulo tem DOIS significados e tratá-los igual seria mentir
   * para o usuário:
   *
   * - com `fieldErrors.status` → transição inválida. Não deveria acontecer (a
   *   tela não oferece o botão), então se acontecer é porque a nossa cópia do
   *   estado envelheceu — mesma cura: recarregar.
   * - sem `fieldErrors.status` → a trava otimista do backend: alguém mudou o
   *   estado entre o nosso GET e o nosso PATCH.
   *
   * Nos dois casos a folha fecha e o sinistro é recarregado do servidor, porque
   * qualquer transição que a tela ainda oferecesse partiria de um estado que já
   * não existe.
   */
  private handleTransitionError(err: HttpErrorResponse): void {
    const parsed = parseApiError(err);
    if (parsed.status !== 409) {
      this.sheetError.set(
        this.apiErrors.messageFor(err, 'Não foi possível atualizar a situação do sinistro.'),
      );
      return;
    }

    this.apiErrors.claim(err);
    const message = parsed.fieldErrors['status'] ?? OPTIMISTIC_LOCK_MESSAGE;
    this.pending.set(null);
    this.cardError.set(message);
    this.reload();
  }

  /** Recarrega o sinistro do servidor e republica para o pai. */
  private reload(): void {
    this.incidentsService.getOne(this.current().id).subscribe({
      next: (fresh) => {
        this.current.set(fresh);
        this.changed.emit(fresh);
      },
      error: (err: HttpErrorResponse) => this.apiErrors.claim(err),
    });
  }
}
