import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PageCard } from '../../../components/core/page-card/page-card';
import { RentalStatus } from '../../../types/rental.types';
import { RentalService } from '../rental.service';
import { RentalContractCard } from './rental-contract-card';
import { RentalInspectionCard } from './rental-inspection-card';

type StepKey = 'RESERVED' | 'CONTRACT' | 'CHECKIN' | 'ACTIVATE' | 'CHECKOUT';
type StepState = 'pending' | 'progress' | 'done' | 'blocked';
type BadgeTone = 'neutral' | 'amber' | 'emerald' | 'red';
type StepPanel = 'contract' | 'checkin' | 'checkout' | null;

interface StepBadge {
  label: string;
  tone: BadgeTone;
}

interface Step {
  key: StepKey;
  title: string;
  description: string;
  state: StepState;
  visible: boolean;
  panel: StepPanel;
  badge: StepBadge | null;
  showActionButton: boolean;
  actionLabel: string;
  actionKind: 'activate';
}

const STEP_TO_QUERY: Record<StepKey, string> = {
  RESERVED: 'reserved',
  CONTRACT: 'contract',
  CHECKIN: 'checkin',
  ACTIVATE: 'activate',
  CHECKOUT: 'checkout',
};

/**
 * Checklist "onboarding-style" com 5 etapas do rental — agora em accordion.
 * Cada linha expande inline pra revelar o card correspondente (contrato,
 * check-in, check-out). Deep-link via {@code ?step=} controla qual linha
 * está expandida (não faz scroll).
 *
 * Fonte dos dados: {@link RentalService.rentalState} — snapshot cacheado
 * por rentalId, compartilhado com os cards internos.
 */
@Component({
  selector: 'app-rental-progress-checklist',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard, RentalContractCard, RentalInspectionCard],
  host: { class: 'block' },
  template: `
    <app-page-card title="Progresso do aluguel">
      <ol class="p-4 sm:p-6 space-y-3">
        @for (step of steps(); track step.key) {
          @if (step.visible) {
            <li
              class="rounded-xl border transition-colors overflow-hidden"
              [class.border-emerald-200]="step.state === 'done'"
              [class.bg-emerald-50]="step.state === 'done'"
              [class.border-neutral-200]="step.state !== 'done'"
              [class.bg-white]="step.state !== 'done'"
            >
              <div class="flex flex-col sm:flex-row sm:items-center gap-3 p-3">
                <button
                  type="button"
                  (click)="toggle(step)"
                  [disabled]="step.panel === null || step.state === 'blocked'"
                  [attr.aria-expanded]="step.panel !== null ? (isExpanded(step) ? 'true' : 'false') : null"
                  [attr.aria-controls]="step.panel !== null ? 'panel-' + step.key : null"
                  [attr.id]="'header-' + step.key"
                  class="flex items-center gap-3 flex-1 min-w-0 text-left min-h-[44px] rounded-lg disabled:cursor-default"
                >
                  <span
                    class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
                    [class.bg-emerald-500]="step.state === 'done'"
                    [class.bg-amber-500]="step.state === 'progress'"
                    [class.!bg-neutral-200]="step.state === 'pending' || step.state === 'blocked'"
                    [class.!text-neutral-500]="step.state === 'pending' || step.state === 'blocked'"
                  >
                    @if (step.state === 'done') {
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    } @else {
                      <span class="text-xs font-semibold" aria-hidden="true">{{ stepNumber(step.key) }}</span>
                    }
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <p
                        class="text-sm font-semibold"
                        [class.text-emerald-900]="step.state === 'done'"
                        [class.text-neutral-900]="step.state !== 'done'"
                      >
                        {{ step.title }}
                      </p>
                      @if (step.badge; as badge) {
                        <span
                          class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                          [class.bg-neutral-100]="badge.tone === 'neutral'"
                          [class.text-neutral-700]="badge.tone === 'neutral'"
                          [class.bg-amber-100]="badge.tone === 'amber'"
                          [class.text-amber-800]="badge.tone === 'amber'"
                          [class.bg-emerald-100]="badge.tone === 'emerald'"
                          [class.text-emerald-800]="badge.tone === 'emerald'"
                          [class.bg-rose-100]="badge.tone === 'red'"
                          [class.text-rose-800]="badge.tone === 'red'"
                        >
                          {{ badge.label }}
                        </span>
                      }
                    </div>
                    <p
                      class="text-xs mt-0.5"
                      [class.text-emerald-700]="step.state === 'done'"
                      [class.text-amber-700]="step.state === 'progress'"
                      [class.text-neutral-500]="step.state === 'pending' || step.state === 'blocked'"
                    >
                      {{ step.description }}
                    </p>
                  </div>
                  @if (step.panel !== null) {
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                      class="shrink-0 text-neutral-400 transition-transform duration-200"
                      [style.transform]="isExpanded(step) ? 'rotate(180deg)' : 'rotate(0deg)'"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  }
                </button>
                @if (step.showActionButton && step.state !== 'done' && step.actionKind === 'activate') {
                  <button
                    type="button"
                    (click)="handleAction(step)"
                    class="w-full sm:w-auto shrink-0 inline-flex items-center justify-center px-3 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-semibold transition-colors min-h-[44px]"
                  >
                    {{ step.actionLabel }}
                  </button>
                }
              </div>
              @if (isExpanded(step) && step.panel !== null) {
                <div
                  [attr.id]="'panel-' + step.key"
                  [attr.aria-labelledby]="'header-' + step.key"
                  role="region"
                  class="border-t border-neutral-200 bg-white p-3 sm:p-4"
                >
                  @switch (step.panel) {
                    @case ('contract') {
                      <app-rental-contract-card [rentalId]="rentalId()" />
                    }
                    @case ('checkin') {
                      <app-rental-inspection-card [rentalId]="rentalId()" kind="CHECKIN" />
                    }
                    @case ('checkout') {
                      <app-rental-inspection-card [rentalId]="rentalId()" kind="CHECKOUT" />
                    }
                  }
                </div>
              }
            </li>
          }
        }
      </ol>
    </app-page-card>
  `,
})
export class RentalProgressChecklist implements OnInit {
  private readonly rentalService = inject(RentalService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly rentalId = input.required<string>();
  readonly status = input.required<RentalStatus>();
  readonly automaticCharge = input<boolean | undefined>(false);

  readonly activateRequested = output<void>();

  /** Accordion: apenas uma linha expandida por vez. */
  protected readonly expandedStep = signal<StepKey | null>(null);

  /** Snapshot compartilhado (docs + fotos + assinatura) mantido pelo service. */
  private readonly snapshot = computed(() => this.rentalService.rentalState(this.rentalId())());

  constructor() {
    // Garante que o snapshot seja carregado sempre que o rentalId mudar.
    effect(() => {
      const id = this.rentalId();
      if (id) this.rentalService.loadRentalState(id);
    });
  }

  protected readonly steps = computed<Step[]>(() => {
    const snap = this.snapshot();
    const docs = snap?.documents ?? [];
    const checkinPhotos = snap?.checkinPhotos ?? [];
    const checkoutPhotos = snap?.checkoutPhotos ?? [];
    const status = this.status();
    const contractDoc = docs.find((d) => d.kind === 'CONTRACT');
    const signature = snap?.contractSignature ?? null;
    const contractSigned = !!contractDoc && signature?.status === 'SIGNED';
    const contractAwaitingSignature =
      !!contractDoc &&
      (signature?.status === 'PENDING' ||
        signature?.status === 'REFUSED' ||
        signature?.status === 'EXPIRED');
    const checkinPdfDone = docs.some((d) => d.kind === 'CHECKIN');
    const checkinPhotoCount = checkinPhotos.length;
    const checkoutPdfDone = docs.some((d) => d.kind === 'CHECKOUT');
    const checkoutPhotoCount = checkoutPhotos.length;
    const isActive = status === 'ACTIVE' || status === 'COMPLETED';
    const isCompleted = status === 'COMPLETED';
    const canActivateManually = status === 'RESERVED' && this.automaticCharge() === false;

    const contractState: StepState = contractSigned
      ? 'done'
      : contractDoc
        ? 'progress'
        : 'pending';
    const contractDescription = contractSigned
      ? 'Contrato assinado por todos os signatários.'
      : contractAwaitingSignature
        ? signature?.status === 'REFUSED'
          ? 'Assinatura recusada — reenvie para os signatários.'
          : signature?.status === 'EXPIRED'
            ? 'Link de assinatura expirou — reenvie para os signatários.'
            : 'Aguardando assinatura dos signatários…'
        : contractDoc
          ? 'PDF enviado. Solicite a assinatura eletrônica.'
          : 'Anexe o PDF assinado do contrato de locação.';

    const contractBadge: StepBadge | null = !contractDoc
      ? null
      : contractSigned
        ? { label: 'assinado', tone: 'emerald' }
        : { label: 'aguardando assinatura', tone: 'amber' };

    const checkinState: StepState = checkinPdfDone
      ? 'done'
      : checkinPhotoCount > 0
        ? 'progress'
        : 'pending';
    const checkinBadge: StepBadge | null =
      checkinPhotoCount === 0
        ? { label: 'aguardando fotos', tone: 'amber' }
        : checkinPdfDone
          ? { label: 'PDF gerado', tone: 'emerald' }
          : checkinPhotoCount >= 14
            ? { label: '14/14 fotos', tone: 'emerald' }
            : { label: `${checkinPhotoCount}/14 fotos`, tone: 'amber' };

    const checkoutState: StepState = checkoutPdfDone
      ? 'done'
      : checkoutPhotoCount > 0
        ? 'progress'
        : 'pending';
    const checkoutBadge: StepBadge | null =
      checkoutPhotoCount === 0
        ? { label: 'aguardando fotos', tone: 'amber' }
        : checkoutPdfDone
          ? { label: 'PDF gerado', tone: 'emerald' }
          : checkoutPhotoCount >= 14
            ? { label: '14/14 fotos', tone: 'emerald' }
            : { label: `${checkoutPhotoCount}/14 fotos`, tone: 'amber' };

    const activateState: StepState = isActive ? 'done' : canActivateManually ? 'pending' : 'blocked';
    const activateBadge: StepBadge | null = isActive
      ? { label: 'ativo', tone: 'emerald' }
      : canActivateManually
        ? { label: 'pronto', tone: 'amber' }
        : { label: 'bloqueado', tone: 'red' };

    return [
      {
        key: 'RESERVED',
        title: 'Reserva criada',
        description: 'Aluguel registrado como RESERVADO.',
        state: 'done',
        visible: true,
        panel: null,
        badge: null,
        showActionButton: false,
        actionLabel: '',
        actionKind: 'activate',
      },
      {
        key: 'CONTRACT',
        title: 'Contrato',
        description: contractDescription,
        state: contractState,
        visible: true,
        panel: 'contract',
        badge: contractBadge,
        showActionButton: false,
        actionLabel: '',
        actionKind: 'activate',
      },
      {
        key: 'CHECKIN',
        title: 'Check-in (vistoria de entrada)',
        description: checkinPdfDone
          ? 'Laudo em PDF gerado.'
          : checkinPhotoCount > 0
            ? `${checkinPhotoCount} de 14 fotos enviadas. Gere o PDF quando terminar.`
            : 'Fotografe os 14 ângulos do veículo e gere o laudo.',
        state: checkinState,
        visible: true,
        panel: 'checkin',
        badge: checkinBadge,
        showActionButton: false,
        actionLabel: '',
        actionKind: 'activate',
      },
      {
        key: 'ACTIVATE',
        title: 'Iniciar locação',
        description: isActive
          ? 'Aluguel ativado — cobranças em andamento.'
          : canActivateManually
            ? 'Cobrança da caução (se houver) é disparada aqui.'
            : 'Aluguel será ativado automaticamente após confirmação do pagamento.',
        state: activateState,
        visible: true,
        panel: null,
        badge: activateBadge,
        showActionButton: canActivateManually,
        actionLabel: 'Ativar aluguel',
        actionKind: 'activate',
      },
      {
        key: 'CHECKOUT',
        title: 'Check-out (vistoria de saída)',
        description: checkoutPdfDone
          ? 'Laudo em PDF gerado.'
          : checkoutPhotoCount > 0
            ? `${checkoutPhotoCount} de 14 fotos enviadas.`
            : 'Após a devolução do veículo, fotografe e gere o laudo de saída.',
        state: checkoutState,
        visible: isActive,
        panel: 'checkout',
        badge: isCompleted && !checkoutPdfDone ? null : checkoutBadge,
        showActionButton: false,
        actionLabel: '',
        actionKind: 'activate',
      },
    ];
  });

  ngOnInit(): void {
    this.applyDeepLink();
  }

  protected stepNumber(key: StepKey): number {
    return { RESERVED: 1, CONTRACT: 2, CHECKIN: 3, ACTIVATE: 4, CHECKOUT: 5 }[key];
  }

  protected isExpanded(step: Step): boolean {
    return this.expandedStep() === step.key;
  }

  protected toggle(step: Step): void {
    if (step.panel === null) return;
    const next = this.expandedStep() === step.key ? null : step.key;
    this.expandedStep.set(next);
    this.writeDeepLink(next);
  }

  protected handleAction(step: Step): void {
    if (step.actionKind === 'activate') {
      this.activateRequested.emit();
    }
  }

  private applyDeepLink(): void {
    const raw = this.route.snapshot.queryParamMap.get('step');
    if (!raw) return;
    const target = (Object.keys(STEP_TO_QUERY) as StepKey[]).find((k) => STEP_TO_QUERY[k] === raw);
    if (!target) return;
    this.expandedStep.set(target);
  }

  private writeDeepLink(key: StepKey | null): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { step: key === null ? null : STEP_TO_QUERY[key] },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
