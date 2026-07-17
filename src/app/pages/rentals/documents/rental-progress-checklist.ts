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
import { RentalDocumentDto, RentalPhotoDto, RentalStatus } from '../../../types/rental.types';
import { RentalService } from '../rental.service';

type StepKey = 'RESERVED' | 'CONTRACT' | 'CHECKIN' | 'ACTIVATE' | 'CHECKOUT';
type StepState = 'pending' | 'progress' | 'done' | 'blocked';

interface Step {
  key: StepKey;
  title: string;
  description: string;
  state: StepState;
  visible: boolean;
  anchorId: string | null;
  showActionButton: boolean;
  actionLabel: string;
  actionKind: 'scroll' | 'activate';
}

const STEP_TO_QUERY: Record<StepKey, string> = {
  RESERVED: 'reserved',
  CONTRACT: 'contract',
  CHECKIN: 'checkin',
  ACTIVATE: 'activate',
  CHECKOUT: 'checkout',
};

/**
 * Checklist "onboarding-style" mostrando as 5 etapas do rental. Mobile-first:
 * lista vertical com badge de estado (pendente / em progresso / concluído) e
 * CTA por linha que rola até o card correspondente. Deep-link via {@code ?step=}
 * permite voltar direto ao mesmo passo após signed URL expirar ou navegação.
 */
@Component({
  selector: 'app-rental-progress-checklist',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard],
  host: { class: 'block' },
  template: `
    <app-page-card title="Progresso do aluguel">
      <ol class="p-4 sm:p-6 space-y-3">
        @for (step of steps(); track step.key) {
          @if (step.visible) {
            <li
              class="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border p-3 transition-colors"
              [class.border-emerald-200]="step.state === 'done'"
              [class.bg-emerald-50]="step.state === 'done'"
              [class.border-neutral-200]="step.state !== 'done'"
              [class.bg-white]="step.state !== 'done'"
            >
              <div class="flex items-center gap-3 flex-1 min-w-0">
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
                  <p
                    class="text-sm font-semibold"
                    [class.text-emerald-900]="step.state === 'done'"
                    [class.text-neutral-900]="step.state !== 'done'"
                  >
                    {{ step.title }}
                  </p>
                  <p
                    class="text-xs mt-0.5"
                    [class.text-emerald-700]="step.state === 'done'"
                    [class.text-amber-700]="step.state === 'progress'"
                    [class.text-neutral-500]="step.state === 'pending' || step.state === 'blocked'"
                  >
                    {{ step.description }}
                  </p>
                </div>
              </div>
              @if (step.showActionButton && step.state !== 'done') {
                <button
                  type="button"
                  (click)="handleAction(step)"
                  class="w-full sm:w-auto shrink-0 inline-flex items-center justify-center px-3 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-semibold transition-colors min-h-[44px]"
                >
                  {{ step.actionLabel }}
                </button>
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
  readonly refreshToken = input<number>(0);

  readonly activateRequested = output<void>();

  private readonly documents = signal<RentalDocumentDto[]>([]);
  private readonly checkinPhotos = signal<RentalPhotoDto[]>([]);
  private readonly checkoutPhotos = signal<RentalPhotoDto[]>([]);

  constructor() {
    effect(() => {
      this.refreshToken();
      const id = this.rentalId();
      if (id) this.reload();
    });
  }

  protected readonly steps = computed<Step[]>(() => {
    const docs = this.documents();
    const status = this.status();
    const contractDone = docs.some((d) => d.kind === 'CONTRACT');
    const checkinPdfDone = docs.some((d) => d.kind === 'CHECKIN');
    const checkinPhotoCount = this.checkinPhotos().length;
    const checkoutPdfDone = docs.some((d) => d.kind === 'CHECKOUT');
    const checkoutPhotoCount = this.checkoutPhotos().length;
    const isActive = status === 'ACTIVE' || status === 'COMPLETED';
    const isCompleted = status === 'COMPLETED';
    const canActivateManually = status === 'RESERVED' && this.automaticCharge() === false;

    const checkinState: StepState = checkinPdfDone
      ? 'done'
      : checkinPhotoCount > 0
        ? 'progress'
        : 'pending';
    const checkoutState: StepState = checkoutPdfDone
      ? 'done'
      : checkoutPhotoCount > 0
        ? 'progress'
        : 'pending';
    const activateState: StepState = isActive ? 'done' : canActivateManually ? 'pending' : 'blocked';

    return [
      {
        key: 'RESERVED',
        title: 'Reserva criada',
        description: 'Aluguel registrado como RESERVADO.',
        state: 'done',
        visible: true,
        anchorId: null,
        showActionButton: false,
        actionLabel: '',
        actionKind: 'scroll',
      },
      {
        key: 'CONTRACT',
        title: 'Contrato',
        description: contractDone
          ? 'PDF do contrato anexado.'
          : 'Anexe o PDF assinado do contrato de locação.',
        state: contractDone ? 'done' : 'pending',
        visible: true,
        anchorId: 'contract-card',
        showActionButton: true,
        actionLabel: 'Anexar agora',
        actionKind: 'scroll',
      },
      {
        key: 'CHECKIN',
        title: 'Check-in (vistoria de entrada)',
        description: checkinPdfDone
          ? 'Laudo em PDF gerado.'
          : checkinPhotoCount > 0
            ? `${checkinPhotoCount} de 6 fotos enviadas. Gere o PDF quando terminar.`
            : 'Fotografe os 6 ângulos do veículo e gere o laudo.',
        state: checkinState,
        visible: true,
        anchorId: 'checkin-card',
        showActionButton: true,
        actionLabel: checkinPhotoCount > 0 && !checkinPdfDone ? 'Continuar' : 'Fazer agora',
        actionKind: 'scroll',
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
        anchorId: null,
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
            ? `${checkoutPhotoCount} de 6 fotos enviadas.`
            : 'Após a devolução do veículo, fotografe e gere o laudo de saída.',
        state: checkoutState,
        visible: isActive,
        anchorId: 'checkout-card',
        showActionButton: !isCompleted,
        actionLabel: checkoutPhotoCount > 0 && !checkoutPdfDone ? 'Continuar' : 'Fazer agora',
        actionKind: 'scroll',
      },
    ];
  });

  ngOnInit(): void {
    this.reload();
    this.applyDeepLink();
  }

  protected stepNumber(key: StepKey): number {
    return { RESERVED: 1, CONTRACT: 2, CHECKIN: 3, ACTIVATE: 4, CHECKOUT: 5 }[key];
  }

  protected handleAction(step: Step): void {
    if (step.actionKind === 'activate') {
      this.activateRequested.emit();
      return;
    }
    this.writeDeepLink(step.key);
    if (step.anchorId) this.scrollToAnchor(step.anchorId);
  }

  private applyDeepLink(): void {
    const raw = this.route.snapshot.queryParamMap.get('step');
    if (!raw) return;
    const target = (Object.keys(STEP_TO_QUERY) as StepKey[]).find((k) => STEP_TO_QUERY[k] === raw);
    if (!target) return;
    const step = this.steps().find((s) => s.key === target);
    if (!step?.anchorId) return;
    // Aguarda o próximo tick pra garantir que os cards ancorados já renderizaram.
    if (typeof window !== 'undefined') {
      window.setTimeout(() => this.scrollToAnchor(step.anchorId!), 150);
    }
  }

  private writeDeepLink(key: StepKey): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { step: STEP_TO_QUERY[key] },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private scrollToAnchor(anchorId: string): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(anchorId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private reload(): void {
    const id = this.rentalId();
    this.rentalService.listDocuments(id).subscribe({
      next: (docs) => this.documents.set(docs),
    });
    this.rentalService.listPhotos(id, 'CHECKIN').subscribe({
      next: (list) => this.checkinPhotos.set(list),
    });
    this.rentalService.listPhotos(id, 'CHECKOUT').subscribe({
      next: (list) => this.checkoutPhotos.set(list),
      error: () => this.checkoutPhotos.set([]),
    });
  }
}
