import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ExternalNavigationService } from '../../../services/external-navigation.service';
import { NotificationService } from '../../../services/notification.service';
import {
  RENTAL_PHOTO_ANGLES,
  RentalDocumentDto,
  RentalPhotoAngle,
  RentalPhotoDto,
  RentalPhotoKind,
} from '../../../types/rental.types';
import { RentalService } from '../rental.service';

interface Slot {
  angle: RentalPhotoAngle;
  label: string;
  photo: RentalPhotoDto | null;
  uploading: boolean;
  /** 0-100 durante o upload; nulo quando browser não expõe total. */
  progress: number | null;
  /** object URL local do arquivo selecionado — visível durante o upload. */
  previewUrl: string | null;
}

/**
 * Card de vistoria (check-in ou check-out). Grid 2 col mobile, 3 col em sm, 4
 * col em lg — cobre os 14 ângulos definidos no {@link RentalPhotoAngle}. Clicar
 * em qualquer slot abre o picker; upload substitui a foto anterior do mesmo
 * ângulo. Botão "Gerar PDF" fica destacado assim que existe pelo menos 1 foto
 * — o backend valida se o kind é permitido pro status atual.
 *
 * Rentals criados antes da expansão para 14 ângulos mantêm apenas as 6 fotos
 * originais preenchidas; os 8 slots novos aparecem vazios e continuam
 * uploadáveis, sem migração retroativa.
 */
@Component({
  selector: 'app-rental-inspection-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard],
  template: `
    <app-page-card [title]="title()">
      <div class="p-4 sm:p-6 space-y-4">
        <p class="text-sm text-neutral-600">
          Tire uma foto de cada ângulo do veículo. O laudo em PDF é gerado a partir dessas fotos.
        </p>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          @for (slot of slots(); track slot.angle) {
            <button
              type="button"
              (click)="picker.click(); pending = slot.angle"
              [disabled]="slot.uploading"
              class="group relative aspect-square rounded-xl border-2 border-dashed border-neutral-300
                     hover:border-primary-400 bg-neutral-50 overflow-hidden text-left
                     transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              [attr.aria-label]="'Enviar foto: ' + slot.label"
            >
              @if (slot.previewUrl || slot.photo?.signedUrl; as url) {
                <img
                  [src]="url"
                  [alt]="slot.label"
                  class="absolute inset-0 w-full h-full object-cover"
                />
                <span
                  class="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[11px] font-medium px-2 py-1 truncate"
                >
                  {{ slot.label }}
                </span>
              } @else {
                <div class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-2 text-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="text-neutral-400 group-hover:text-primary-500 transition-colors"
                    aria-hidden="true"
                  >
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span class="text-[11px] font-medium text-neutral-500 group-hover:text-primary-600 transition-colors">
                    {{ slot.label }}
                  </span>
                </div>
              }
              @if (slot.uploading) {
                <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/85 p-2">
                  <p class="text-xs font-medium text-neutral-800">
                    {{ slot.progress ?? 0 }}%
                  </p>
                  <div class="w-3/4 h-1 rounded-full bg-neutral-200 overflow-hidden">
                    <div class="h-full bg-primary-500 transition-all"
                         [style.width.%]="slot.progress ?? 0"></div>
                  </div>
                  <button type="button" (click)="cancelUpload(slot.angle); $event.stopPropagation()"
                    class="text-[10px] text-rose-600 hover:text-rose-700 font-semibold">
                    Cancelar
                  </button>
                </div>
              }
            </button>
          }
        </div>

        <div class="flex flex-col sm:flex-row gap-2 pt-2">
          <button
            type="button"
            (click)="generate()"
            [disabled]="generating() || completedCount() === 0"
            class="w-full sm:w-auto sm:flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5
                   rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold
                   shadow-sm transition-colors min-h-[48px] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            @if (generating()) {
              Gerando PDF…
            } @else {
              Gerar PDF do laudo ({{ completedCount() }}/14)
            }
          </button>
          @if (generatedDoc(); as doc) {
            <button
              type="button"
              (click)="openPdf(doc.id)"
              [disabled]="openingPdf()"
              class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5
                     rounded-xl border border-primary-200 hover:bg-primary-50 text-primary-700 text-sm font-semibold
                     transition-colors min-h-[48px] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              @if (openingPdf()) { Abrindo… } @else { Abrir PDF gerado }
            </button>
          }
        </div>

        <input
          #picker
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          hidden
          (change)="onFileSelected($event)"
        />
      </div>
    </app-page-card>
  `,
})
export class RentalInspectionCard implements OnInit, OnDestroy {
  private readonly rentalService = inject(RentalService);
  private readonly notifications = inject(NotificationService);
  private readonly externalNav = inject(ExternalNavigationService);

  readonly rentalId = input.required<string>();
  readonly kind = input.required<RentalPhotoKind>();
  readonly changed = output<void>();

  protected pending: RentalPhotoAngle | null = null;

  /** Snapshot compartilhado — fotos e PDF do laudo vêm daqui, sem fetch próprio. */
  private readonly snapshot = computed(() => this.rentalService.rentalState(this.rentalId())());
  protected readonly photos = computed<RentalPhotoDto[]>(() => {
    const snap = this.snapshot();
    if (!snap) return [];
    return this.kind() === 'CHECKIN' ? snap.checkinPhotos : snap.checkoutPhotos;
  });
  protected readonly generatedDoc = computed<RentalDocumentDto | null>(
    () => this.snapshot()?.documents.find((d) => d.kind === this.kind()) ?? null,
  );

  protected readonly slotStatus = signal<Record<RentalPhotoAngle, boolean>>({
    FRONT: false,
    BACK: false,
    LEFT: false,
    RIGHT: false,
    FRONT_LEFT_PANEL: false,
    FRONT_RIGHT_PANEL: false,
    REAR_LEFT_PANEL: false,
    REAR_RIGHT_PANEL: false,
    ENGINE: false,
    TRUNK: false,
    DASHBOARD: false,
    ODOMETER: false,
    FRONT_SEAT: false,
    REAR_SEAT: false,
  });
  protected readonly slotProgress = signal<Record<RentalPhotoAngle, number | null>>({
    FRONT: null,
    BACK: null,
    LEFT: null,
    RIGHT: null,
    FRONT_LEFT_PANEL: null,
    FRONT_RIGHT_PANEL: null,
    REAR_LEFT_PANEL: null,
    REAR_RIGHT_PANEL: null,
    ENGINE: null,
    TRUNK: null,
    DASHBOARD: null,
    ODOMETER: null,
    FRONT_SEAT: null,
    REAR_SEAT: null,
  });
  protected readonly slotPreview = signal<Record<RentalPhotoAngle, string | null>>({
    FRONT: null,
    BACK: null,
    LEFT: null,
    RIGHT: null,
    FRONT_LEFT_PANEL: null,
    FRONT_RIGHT_PANEL: null,
    REAR_LEFT_PANEL: null,
    REAR_RIGHT_PANEL: null,
    ENGINE: null,
    TRUNK: null,
    DASHBOARD: null,
    ODOMETER: null,
    FRONT_SEAT: null,
    REAR_SEAT: null,
  });
  private readonly uploadSubs = new Map<RentalPhotoAngle, Subscription>();
  protected readonly generating = signal(false);
  protected readonly openingPdf = signal(false);

  protected readonly title = computed(() =>
    this.kind() === 'CHECKIN' ? 'Check-in (vistoria de entrada)' : 'Check-out (vistoria de saída)',
  );

  protected readonly slots = computed<Slot[]>(() => {
    const map = new Map(this.photos().map((p) => [p.angle, p]));
    const status = this.slotStatus();
    const progress = this.slotProgress();
    const preview = this.slotPreview();
    return RENTAL_PHOTO_ANGLES.map((a) => ({
      angle: a.value,
      label: a.label,
      photo: map.get(a.value) ?? null,
      uploading: status[a.value] ?? false,
      progress: progress[a.value] ?? null,
      previewUrl: preview[a.value] ?? null,
    }));
  });

  protected readonly completedCount = computed(() => this.slots().filter((s) => s.photo).length);

  ngOnInit(): void {
    this.rentalService.loadRentalState(this.rentalId());
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const angle = this.pending;
    this.pending = null;
    if (!file || !angle) return;

    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
      this.notifications.push('error', 'Formato inválido. Use JPG, PNG ou WebP.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.notifications.push('error', 'Imagem excede 8MB.');
      return;
    }

    this.setSlotUploading(angle, true);
    this.setSlotProgress(angle, 0);
    // Preview local imediato — usuário confirma que escolheu o arquivo certo
    // enquanto o upload roda. objectURL é liberado em finishSlot().
    this.setSlotPreview(angle, URL.createObjectURL(file));
    const sub = this.rentalService
      .uploadPhotoWithProgress(this.rentalId(), this.kind(), angle, file)
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const pct = event.total
              ? Math.round((event.loaded / event.total) * 100)
              : null;
            this.setSlotProgress(angle, pct);
          } else if (event.type === HttpEventType.Response && event.body) {
            this.finishSlot(angle);
            this.notifications.push('success', 'Foto enviada.');
            this.rentalService.refreshRentalState(this.rentalId());
            this.changed.emit();
          }
        },
        error: (err: HttpErrorResponse) => {
          this.finishSlot(angle);
          this.notifications.push(
            'error',
            this.extractError(err, 'Não foi possível enviar a foto.'),
          );
        },
      });
    this.uploadSubs.set(angle, sub);
  }

  protected cancelUpload(angle: RentalPhotoAngle): void {
    const sub = this.uploadSubs.get(angle);
    if (sub) {
      sub.unsubscribe();
      this.finishSlot(angle);
      this.notifications.push('info', 'Envio cancelado.');
    }
  }

  private finishSlot(angle: RentalPhotoAngle): void {
    this.setSlotUploading(angle, false);
    this.setSlotProgress(angle, null);
    // Libera o objectURL do preview local — evita memory leak.
    const preview = this.slotPreview()[angle];
    if (preview) URL.revokeObjectURL(preview);
    this.setSlotPreview(angle, null);
    this.uploadSubs.delete(angle);
  }

  protected generate(): void {
    if (this.generating() || this.completedCount() === 0) return;
    this.generating.set(true);
    this.rentalService.generateInspectionPdf(this.rentalId(), this.kind()).subscribe({
      next: () => {
        this.generating.set(false);
        this.notifications.push('success', 'PDF do laudo gerado.');
        this.rentalService.refreshRentalState(this.rentalId());
        this.changed.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.generating.set(false);
        this.notifications.push(
          'error',
          this.extractError(err, 'Não foi possível gerar o PDF.'),
        );
      },
    });
  }

  protected openPdf(docId: string): void {
    if (this.openingPdf()) return;
    this.openingPdf.set(true);
    this.rentalService.documentSignedUrl(this.rentalId(), docId).subscribe({
      next: (res) => {
        this.openingPdf.set(false);
        this.externalNav.openExternal(res.url);
      },
      error: (err: HttpErrorResponse) => {
        this.openingPdf.set(false);
        this.notifications.push(
          'error',
          this.extractError(err, 'Não foi possível abrir o PDF.'),
        );
      },
    });
  }

  private setSlotUploading(angle: RentalPhotoAngle, value: boolean): void {
    this.slotStatus.update((s) => ({ ...s, [angle]: value }));
  }

  private setSlotProgress(angle: RentalPhotoAngle, value: number | null): void {
    this.slotProgress.update((s) => ({ ...s, [angle]: value }));
  }

  private setSlotPreview(angle: RentalPhotoAngle, value: string | null): void {
    this.slotPreview.update((s) => ({ ...s, [angle]: value }));
  }

  ngOnDestroy(): void {
    this.uploadSubs.forEach((sub) => sub.unsubscribe());
    this.uploadSubs.clear();
    Object.values(this.slotPreview()).forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
