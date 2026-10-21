import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  viewChild,
  linkedSignal,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import type { InspectionStatus } from '../../../types/inspection.types';
import { formatPtBrNumber } from '../../../utils/ptbr-number';
import { angleGuide, kmProblem, maskKm, parseKm } from './driver-inspection-guide';

/** One angle of the script as the guided capture draws it. */
export interface WizardSlot {
  readonly angle: string;
  readonly label: string;
  /** The server has this photo. */
  readonly done: boolean;
  /** Local preview first, then the signed URL; `null` when there is nothing to show. */
  readonly thumbUrl: string | null;
  readonly uploading: boolean;
  readonly phase: 'compressing' | 'uploading' | null;
  readonly failure: string | null;
  readonly canRetry: boolean;
}

type View = 'cap' | 'odo' | 'review';

/**
 * The DRIVER's inspection capture, step by step (owner's prototype "Motorista Vistorias"):
 * one angle per screen, the odometer, a review grid and the send.
 *
 * PRESENTATION ONLY. Every photo still goes through `InspectionCapture`: the shutter asks the
 * page to open the live camera (`shoot`), the page compresses and uploads the photo the moment
 * it is taken, and the progress shown here is the server's `capturedAngles`. Nothing here
 * talks to the API, so the capture and submit rules stay where they were.
 */
@Component({
  selector: 'app-driver-inspection-wizard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, RouterLink],
  templateUrl: './driver-inspection-wizard.html',
  host: { class: 'block' },
})
export class DriverInspectionWizard {
  /** Changes when the page swaps inspections (redo): the steps start over. */
  readonly inspectionId = input.required<string>();
  readonly plate = input<string | null>(null);
  readonly status = input.required<InspectionStatus>();
  readonly slots = input.required<readonly WizardSlot[]>();
  /** Some photo is compressing or uploading: the camera waits (one upload at a time). */
  readonly busy = input(false);
  readonly previousKm = input<number | null>(null);
  readonly submitting = input(false);
  readonly submitError = input<string | null>(null);
  readonly pageError = input<string | null>(null);
  readonly rejectionReason = input<string | null>(null);
  readonly recapturing = input(false);
  readonly recaptureError = input<string | null>(null);
  readonly listLink = input('/vistorias');

  readonly shoot = output<string>();
  readonly retry = output<string>();
  readonly send = output<number>();
  readonly redo = output<void>();
  readonly leave = output<void>();

  protected readonly total = computed(() => this.slots().length);
  protected readonly doneCount = computed(() => this.slots().filter((s) => s.done).length);
  protected readonly allDone = computed(
    () => this.total() > 0 && this.doneCount() === this.total(),
  );

  /** The angle on screen. Starts at the first one without a photo. */
  protected readonly step = linkedSignal<string, number>({
    source: this.inspectionId,
    computation: () => {
      const first = untracked(this.slots).findIndex((s) => !s.done);
      return first === -1 ? 0 : first;
    },
  });

  protected readonly view = linkedSignal<string, View>({
    source: this.inspectionId,
    computation: () => {
      const slots = untracked(this.slots);
      return slots.length > 0 && slots.every((s) => s.done) ? 'odo' : 'cap';
    },
  });

  protected readonly km = linkedSignal<string, string>({
    source: this.inspectionId,
    computation: () => '',
  });
  protected readonly kmError = signal<string | null>(null);
  protected readonly exitOpen = signal(false);
  private readonly stayButton = viewChild<ElementRef<HTMLButtonElement>>('stayButton');

  constructor() {
    // The exit dialog takes focus on its safe choice, so Enter on the X never leaves by accident.
    effect(() => this.stayButton()?.nativeElement.focus());
  }

  protected readonly sent = computed(
    () => this.status() === 'SUBMITTED' || this.status() === 'APPROVED',
  );
  protected readonly rejected = computed(() => this.status() === 'REJECTED');

  protected readonly current = computed<WizardSlot | null>(
    () => this.slots()[this.step()] ?? null,
  );
  protected readonly guide = computed(() => {
    const slot = this.current();
    return slot ? angleGuide(slot.angle, slot.label) : null;
  });

  /** The page's banner, unless it repeats the failure already shown under this photo. */
  protected readonly topError = computed(() => {
    const message = this.pageError();
    return message && message !== this.current()?.failure ? message : null;
  });

  /** The angle on screen already has a photo (taken now, on the way, or on the server). */
  protected readonly shot = computed(() => {
    const slot = this.current();
    return !!slot && (slot.done || slot.uploading || !!slot.thumbUrl || !!slot.failure);
  });

  /** The next angle without a photo after the current one, wrapping; `-1` = none left. */
  private nextMissing(from: number): number {
    const slots = this.slots();
    for (let k = 1; k <= slots.length; k++) {
      const i = (from + k) % slots.length;
      if (!slots[i].done) return i;
    }
    return -1;
  }

  protected readonly useLabel = computed(() =>
    this.nextMissing(this.step()) === -1 ? 'Usar foto e continuar' : 'Usar foto',
  );

  /** One segment per angle: orange with photo, light orange on screen, grey otherwise. */
  protected readonly segments = computed(() =>
    this.slots().map((slot, i) => ({
      angle: slot.angle,
      tone: slot.done
        ? 'bg-primary-500'
        : i === this.step() && this.view() === 'cap'
          ? 'bg-primary-200'
          : 'bg-neutral-200',
    })),
  );

  protected readonly title = computed(() => {
    if (this.rejected()) return 'Vistoria recusada';
    if (this.sent()) return 'Enviado';
    if (this.view() === 'review') return 'Revisão';
    const plate = this.plate();
    return plate ? `Vistoria · ${plate}` : 'Vistoria';
  });

  protected readonly previousKmLabel = computed(() => {
    const previous = this.previousKm();
    return previous === null ? null : formatPtBrNumber(previous, 0);
  });

  protected readonly exitMessage = computed(() => {
    const done = this.doneCount();
    return done === 0
      ? 'Você continua de onde parou quando voltar.'
      : `${done === 1 ? 'Sua foto já foi enviada' : `Suas ${done} fotos já foram enviadas`} e você continua de onde parou.`;
  });

  // ------------------------------------------------------------- capture

  protected takePhoto(): void {
    const slot = this.current();
    if (!slot || this.busy()) return;
    this.shoot.emit(slot.angle);
  }

  protected retryUpload(): void {
    const slot = this.current();
    if (slot?.canRetry && !this.busy()) this.retry.emit(slot.angle);
  }

  protected usePhoto(): void {
    if (!this.current()?.done) return;
    const next = this.nextMissing(this.step());
    if (next === -1) {
      this.view.set(kmProblem(parseKm(this.km()), this.previousKm()) === null ? 'review' : 'odo');
      return;
    }
    this.step.set(next);
  }

  protected previous(): void {
    this.step.update((s) => Math.max(0, s - 1));
  }

  // ------------------------------------------------------------ odometer

  protected onKm(event: Event): void {
    const field = event.target as HTMLInputElement;
    const masked = maskKm(field.value);
    field.value = masked;
    this.km.set(masked);
    this.kmError.set(null);
  }

  protected goReview(): void {
    const problem = kmProblem(parseKm(this.km()), this.previousKm());
    this.kmError.set(problem);
    if (problem === null) this.view.set('review');
  }

  protected editKm(): void {
    this.view.set('odo');
  }

  // -------------------------------------------------------------- review

  protected redoAngle(index: number): void {
    this.step.set(index);
    this.view.set('cap');
  }

  protected submit(): void {
    const km = parseKm(this.km());
    if (this.submitting() || !this.allDone() || km === null) return;
    if (kmProblem(km, this.previousKm()) !== null) {
      this.view.set('odo');
      return;
    }
    this.send.emit(km);
  }

  // ---------------------------------------------------------------- exit

  protected askExit(): void {
    if (this.sent() || this.rejected()) {
      this.leave.emit();
      return;
    }
    this.exitOpen.set(true);
  }

  protected stay(): void {
    this.exitOpen.set(false);
  }

  protected exit(): void {
    this.exitOpen.set(false);
    this.leave.emit();
  }
}
