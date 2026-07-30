import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Subscription, forkJoin, of, switchMap } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../../services/api-error.service';
import { ExternalNavigationService } from '../../../services/external-navigation.service';
import { NotificationService } from '../../../services/notification.service';
import { DriverService } from '../../../services/driver.service';
import { VehiclesService } from '../../../services/vehicles.service';
import {
  RENTAL_PHOTO_ANGLES,
  RentalDocumentDto,
  RentalPhotoAngle,
  RentalPhotoDto,
  RentalPhotoKind,
} from '../../../types/rental.types';
import { ImageCompressionService } from '../../../services/image-compression.service';
import { InspectionPdfService } from '../inspection-pdf.service';
import { RentalService } from '../rental.service';

/** Espelha `RentalInspectionService.MAX_PHOTO_BYTES` no backend. */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * Janela de agrupamento das confirmacoes de foto. Enviar os 14 angulos disparava
 * 14 toasts empilhados; agora cada sucesso reinicia a janela e o lote inteiro sai
 * como UMA mensagem ("N fotos enviadas."). Curta o bastante pra nao parecer travada.
 */
const PHOTO_BATCH_WINDOW_MS = 1200;

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
  imports: [PageCard, ConfirmDialog, AlertBanner],
  template: `
    <!-- Enquanto a folha está aberta ela é a única região alcançável: 'inert'
         tira o card inteiro do tab order e do cursor virtual do leitor de tela. -->
    <app-page-card [title]="title()" [attr.inert]="sourceSheetOpen() ? '' : null">
      <div class="p-4 sm:p-6 space-y-4">
        @if (error(); as cardError) {
          <app-alert-banner variant="error" [message]="cardError" />
        }
        @if (generatedDoc(); as doc) {
          <div
            class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3"
          >
            <div class="min-w-0 flex items-center gap-3">
              <span
                class="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-600 shrink-0"
                aria-hidden="true"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </span>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-neutral-900 truncate">{{ pdfFileName() }}</p>
                <p class="text-xs text-neutral-500 tabular-nums">
                  {{ formatSize(doc.sizeBytes) }} · Enviado {{ formatDate(doc.createdDate) }}
                </p>
              </div>
            </div>
            <div class="flex flex-col sm:flex-row flex-wrap gap-2 shrink-0">
              <button type="button" (click)="downloadPdf()" [disabled]="downloading()"
                class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold shadow-sm transition-colors min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                @if (downloading()) { Baixando… } @else { {{ downloadLabel() }} }
              </button>
              <button type="button" (click)="openPdf(doc.id)" [disabled]="openingPdf()"
                class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold shadow-sm transition-colors min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                @if (openingPdf()) { Abrindo… } @else { Abrir PDF }
              </button>
              <button type="button" (click)="askDelete()"
                class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-sm font-medium transition-colors min-h-[44px]"
              >
                Remover
              </button>
            </div>
          </div>
        }

        <p class="text-sm text-neutral-600">
          Tire uma foto de cada ângulo do veículo. O laudo em PDF é gerado a partir dessas fotos.
        </p>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          @for (slot of slots(); track slot.angle) {
            <button
              type="button"
              (click)="openPicker(slot.angle, $event)"
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
                    class="text-neutral-400 group-hover:text-primary-700 transition-colors"
                    aria-hidden="true"
                  >
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span class="text-[11px] font-medium text-neutral-500 group-hover:text-primary-700 transition-colors">
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

        <div class="pt-2">
          @if (generatedDoc()) {
            <button
              type="button"
              (click)="generate()"
              [disabled]="generating() || completedCount() === 0"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5
                     rounded-xl border-2 border-dashed border-neutral-300 hover:border-primary-400
                     text-sm font-medium text-neutral-600 hover:text-primary-700 transition-colors
                     min-h-[48px] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              @if (generating()) {
                {{ pdfProgress().message || 'Gerando PDF…' }}
              } @else {
                Gerar novamente ({{ completedCount() }}/14)
              }
            </button>
          } @else {
            <button
              type="button"
              (click)="generate()"
              [disabled]="generating() || completedCount() === 0"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5
                     rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold
                     shadow-sm transition-colors min-h-[48px] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              @if (generating()) {
                {{ pdfProgress().message || 'Gerando PDF…' }}
              } @else {
                Gerar PDF do laudo ({{ completedCount() }}/14)
              }
            </button>
          }
        </div>

      </div>
    </app-page-card>

    <!-- Dois inputs: 'capture' força a câmera traseira; sem 'capture' o
         browser abre a galeria/arquivos. Um só input não cobre os dois.
         Ficam FORA do card porque ele vira 'inert' com a folha aberta, e
         pickFromCamera/Gallery precisam clicá-los nesse exato instante. -->
    <input
      #cameraPicker
      type="file"
      accept="image/*,image/heic,image/heif"
      capture="environment"
      hidden
      (change)="onFileSelected($event)"
    />
    <input
      #galleryPicker
      type="file"
      accept="image/*,image/heic,image/heif"
      hidden
      (change)="onFileSelected($event)"
    />

    @if (sourceSheetOpen()) {
      <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="absolute inset-0 bg-black/50" (click)="closeSourceSheet()" aria-hidden="true"></div>
        <div
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="sourceSheetLabel()"
          tabindex="-1"
          (keydown.escape)="closeSourceSheet()"
          class="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white p-4 shadow-xl space-y-2"
        >
          <p class="text-sm font-semibold text-neutral-900 pb-1">{{ sourceSheetLabel() }}</p>
          <button
            #sourceSheetFirst
            type="button"
            (click)="pickFromCamera()"
            (keydown.shift.tab)="focusSheetLast($event)"
            class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-colors min-h-[48px]"
          >
            Tirar foto
          </button>
          <button
            type="button"
            (click)="pickFromGallery()"
            class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-neutral-200 hover:bg-neutral-50 text-neutral-800 text-sm font-semibold transition-colors min-h-[48px]"
          >
            Escolher da galeria
          </button>
          <button
            #sourceSheetLast
            type="button"
            (click)="closeSourceSheet()"
            (keydown.tab)="focusSheetFirst($event)"
            class="w-full inline-flex items-center justify-center px-4 py-3 rounded-xl text-neutral-500 hover:text-neutral-700 text-sm font-medium transition-colors min-h-[48px]"
          >
            Cancelar
          </button>
        </div>
      </div>
    }

    <app-confirm-dialog
      [open]="deleteOpen()"
      [title]="deleteDialogTitle()"
      message="O PDF do laudo será apagado do storage e não poderá ser recuperado. Tem certeza?"
      confirmLabel="Remover"
      variant="danger"
      (confirmed)="confirmDelete()"
      (cancelled)="closeDelete()"
    />
  `,
})
export class RentalInspectionCard implements OnInit, OnDestroy {
  private readonly rentalService = inject(RentalService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly inspectionPdfService = inject(InspectionPdfService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly externalNav = inject(ExternalNavigationService);
  private readonly imageCompression = inject(ImageCompressionService);
  private readonly platformId = inject(PLATFORM_ID);
  /** Live progress from the client-side PDF pipeline — bound to the UX label. */
  protected readonly pdfProgress = this.inspectionPdfService.progress;

  readonly rentalId = input.required<string>();
  readonly kind = input.required<RentalPhotoKind>();
  readonly changed = output<void>();

  protected pending: RentalPhotoAngle | null = null;

  private readonly cameraPicker = viewChild<ElementRef<HTMLInputElement>>('cameraPicker');
  private readonly galleryPicker = viewChild<ElementRef<HTMLInputElement>>('galleryPicker');
  private readonly sourceSheetFirst = viewChild<ElementRef<HTMLButtonElement>>('sourceSheetFirst');
  private readonly sourceSheetLast = viewChild<ElementRef<HTMLButtonElement>>('sourceSheetLast');
  /** Slot que abriu a folha — recebe o foco de volta ao fechar (WCAG 2.4.3). */
  private sheetTrigger: HTMLElement | null = null;

  protected readonly sourceSheetOpen = signal(false);
  protected readonly sourceSheetLabel = signal('Enviar foto');

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
  /** Fotos confirmadas aguardando o fechamento do lote (ver `PHOTO_BATCH_WINDOW_MS`). */
  private photoBatchCount = 0;
  private photoBatchTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Token de tentativa por ângulo. Incrementa a cada seleção de arquivo e a
   * cada `finishSlot()`, então uma promise de compressão que resolve tarde
   * (usuário cancelou e re-selecionou o mesmo slot) enxerga um token diferente
   * do seu e aborta — sem isso ela dispararia um segundo `startUpload()` cuja
   * subscription sobrescreveria a viva em `uploadSubs`.
   */
  private readonly slotAttempt = new Map<RentalPhotoAngle, number>();
  /**
   * Falha da operacao (upload, geracao do PDF, abrir, baixar, remover). Banner
   * inline no card, nunca toast: o interceptor nao toasta 4xx e `messageFor()`
   * reivindica o erro, desarmando o safety net.
   */
  protected readonly error = signal<string | null>(null);
  protected readonly generating = signal(false);
  protected readonly openingPdf = signal(false);
  protected readonly downloading = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);

  protected readonly title = computed(() =>
    this.kind() === 'CHECKIN' ? 'Check-in (vistoria de entrada)' : 'Check-out (vistoria de saída)',
  );

  protected readonly downloadLabel = computed(() =>
    this.kind() === 'CHECKIN' ? 'Baixar Check-in' : 'Baixar Check-out',
  );

  protected readonly pdfFileName = computed(() =>
    this.kind() === 'CHECKIN' ? 'checkin.pdf' : 'checkout.pdf',
  );

  protected readonly deleteDialogTitle = computed(() =>
    this.kind() === 'CHECKIN' ? 'Remover PDF do check-in?' : 'Remover PDF do check-out?',
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

  constructor() {
    // Move o foco pro primeiro botão assim que a folha renderiza.
    effect(() => {
      const first = this.sourceSheetFirst();
      if (this.sourceSheetOpen() && first) first.nativeElement.focus();
    });
  }

  ngOnInit(): void {
    this.rentalService.loadRentalState(this.rentalId());
  }

  /**
   * Em telas de toque abre a folha "Tirar foto / Escolher da galeria"; no
   * desktop não existe câmera útil, então vai direto pro seletor de arquivos.
   */
  protected openPicker(angle: RentalPhotoAngle, event: Event): void {
    this.pending = angle;
    if (!this.isTouchDevice()) {
      this.galleryPicker()?.nativeElement.click();
      return;
    }
    this.sheetTrigger = (event.currentTarget as HTMLElement | null) ?? null;
    const slot = this.slots().find((s) => s.angle === angle);
    this.sourceSheetLabel.set(slot ? `Enviar foto: ${slot.label}` : 'Enviar foto');
    this.sourceSheetOpen.set(true);
  }

  /**
   * Fechar a folha destrói o botão focado (`@if`), então o foco volta pro slot
   * ANTES de abrir o diálogo nativo — se o usuário dispensá-lo sem escolher
   * arquivo, o foco continua no slot em vez de cair no `<body>` (WCAG 2.4.3).
   */
  protected pickFromCamera(): void {
    this.sourceSheetOpen.set(false);
    this.sheetTrigger?.focus();
    this.cameraPicker()?.nativeElement.click();
  }

  protected pickFromGallery(): void {
    this.sourceSheetOpen.set(false);
    this.sheetTrigger?.focus();
    this.galleryPicker()?.nativeElement.click();
  }

  /** Fecha o ciclo do Tab dentro da folha (último → primeiro). */
  protected focusSheetFirst(event: Event): void {
    event.preventDefault();
    this.sourceSheetFirst()?.nativeElement.focus();
  }

  /** Fecha o ciclo do Shift+Tab dentro da folha (primeiro → último). */
  protected focusSheetLast(event: Event): void {
    event.preventDefault();
    this.sourceSheetLast()?.nativeElement.focus();
  }

  protected closeSourceSheet(): void {
    this.sourceSheetOpen.set(false);
    this.pending = null;
    this.sheetTrigger?.focus();
    this.sheetTrigger = null;
  }

  private isTouchDevice(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    if (typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const angle = this.pending;
    this.pending = null;
    this.sheetTrigger = null;
    if (!file || !angle) return;
    this.error.set(null);

    // iOS Safari envia HEIC/HEIF em fotos default; Android e desktop mandam JPG/PNG/WebP.
    // Alguns navegadores enviam file.type vazio pra HEIC — deixamos passar e o backend valida.
    const type = file.type.toLowerCase();
    const isAllowed =
      type === '' ||
      /^image\/(jpeg|jpg|png|webp|heic|heif|heic-sequence|heif-sequence)$/i.test(type);
    if (!isAllowed) {
      this.notifications.push('error', 'Formato inválido. Use JPG, PNG, WebP ou HEIC.');
      return;
    }

    // Preview + spinner sobem antes da compressão (pode levar ~1s numa foto de
    // 12MP); o upload só começa depois que o arquivo final está pronto.
    this.setSlotUploading(angle, true);
    this.setSlotProgress(angle, 0);
    this.setSlotPreview(angle, URL.createObjectURL(file));
    const attempt = this.bumpAttempt(angle);
    void this.imageCompression
      .compress(file)
      .then((compressed) => {
        // Tentativa obsoleta (cancelada e/ou substituída por uma nova seleção
        // no mesmo slot) — abortar antes de criar uma subscription órfã.
        if (this.slotAttempt.get(angle) !== attempt) return;
        // Quando a compressão falha ela devolve o original (HEIC não
        // decodificável, canvas indisponível). Aí o cap de 8MB do cliente pode
        // barrar: o backend aplica o mesmo limite, então bloqueamos aqui pra
        // não gastar o upload inteiro antes do 413.
        if (compressed.size > MAX_PHOTO_BYTES) {
          this.finishSlot(angle);
          this.notifications.push('error', 'Imagem excede 8MB.');
          return;
        }
        this.startUpload(angle, compressed);
      })
      .catch(() => {
        if (this.slotAttempt.get(angle) !== attempt) return;
        this.finishSlot(angle);
        this.notifications.push('error', 'Não foi possível preparar a foto. Tente novamente.');
      });
  }

  /** Invalida a tentativa anterior do slot e devolve o token da nova. */
  private bumpAttempt(angle: RentalPhotoAngle): number {
    const next = (this.slotAttempt.get(angle) ?? 0) + 1;
    this.slotAttempt.set(angle, next);
    return next;
  }

  private startUpload(angle: RentalPhotoAngle, file: File): void {
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
            this.queuePhotoConfirmation();
            this.rentalService.refreshRentalState(this.rentalId());
            this.changed.emit();
          }
        },
        error: (err: HttpErrorResponse) => {
          this.finishSlot(angle);
          this.error.set(this.apiErrors.messageFor(err, 'Não foi possível enviar a foto.'));
        },
      });
    this.uploadSubs.set(angle, sub);
  }

  /**
   * Conta mais uma foto no lote corrente e adia a confirmacao. Enquanto chegarem
   * uploads dentro da janela, a mensagem nao sai — o usuario recebe UMA
   * confirmacao no fim do lote em vez de uma por foto.
   */
  private queuePhotoConfirmation(): void {
    this.photoBatchCount += 1;
    if (this.photoBatchTimer !== null) clearTimeout(this.photoBatchTimer);
    this.photoBatchTimer = setTimeout(() => this.flushPhotoConfirmation(), PHOTO_BATCH_WINDOW_MS);
  }

  /** Fecha o lote: uma unica mensagem, pluralizada. */
  private flushPhotoConfirmation(): void {
    this.photoBatchTimer = null;
    const count = this.photoBatchCount;
    this.photoBatchCount = 0;
    if (count === 0) return;
    this.notifications.push(
      'success',
      count === 1 ? 'Foto enviada.' : `${count} fotos enviadas.`,
    );
  }

  protected cancelUpload(angle: RentalPhotoAngle): void {
    // Sem subscription ainda = cancelado durante a compressão; o slot precisa
    // ser limpo do mesmo jeito.
    if (!this.slotStatus()[angle]) return;
    this.uploadSubs.get(angle)?.unsubscribe();
    this.finishSlot(angle);
    this.notifications.push('info', 'Envio cancelado.');
  }

  private finishSlot(angle: RentalPhotoAngle): void {
    // Encerra a tentativa corrente: qualquer compressão ainda em voo pro mesmo
    // ângulo passa a ser obsoleta e não dispara upload.
    this.bumpAttempt(angle);
    this.setSlotUploading(angle, false);
    this.setSlotProgress(angle, null);
    // Libera o objectURL do preview local — evita memory leak.
    const preview = this.slotPreview()[angle];
    if (preview) URL.revokeObjectURL(preview);
    this.setSlotPreview(angle, null);
    this.uploadSubs.delete(angle);
  }

  /**
   * Client-side PDF generation: fetch rental+vehicle+driver metadata, render
   * the PDF locally via `pdf-lib`, then multipart-upload to the backend's
   * new `/upload-pdf` endpoint. Replaces the legacy server-side render that
   * was OOM-crashing the Render heap. Photos come from the shared snapshot
   * (already have inline signedUrl), so no extra list request is needed.
   */
  protected generate(): void {
    if (this.generating() || this.completedCount() === 0) return;
    this.error.set(null);
    this.generating.set(true);
    const rentalId = this.rentalId();
    const kind = this.kind();
    const photos = this.photos();

    forkJoin({
      rental: this.rentalService.getById(rentalId),
    })
      .pipe(
        switchMap(({ rental }) =>
          forkJoin({
            rental: of(rental),
            vehicle: this.vehiclesService
              .getOne(rental.vehicleId)
              .pipe(catchError(() => of(null))),
            driver: this.driverService
              .getOne(rental.driverId)
              .pipe(catchError(() => of(null))),
          }),
        ),
        switchMap(({ rental, vehicle, driver }) =>
          this.inspectionPdfService.generateAndUpload(rentalId, kind, { rental, vehicle, driver }, photos),
        ),
      )
      .subscribe({
        next: (res) => {
          this.generating.set(false);
          this.inspectionPdfService.reset();
          // Fotos que o pdf-lib recusou saem do documento, mas o operador
          // precisa saber ANTES de baixar um laudo incompleto.
          const skipped = res.skippedPhotoLabels;
          if (skipped.length > 0) {
            this.notifications.push(
              'warning',
              `PDF gerado, mas ${skipped.length} foto(s) não puderam ser incluídas: ${skipped.join(', ')}.`,
            );
          } else {
            this.notifications.push('success', 'PDF do laudo gerado.');
          }
          this.rentalService.refreshRentalState(this.rentalId());
          this.changed.emit();
        },
        error: (err: HttpErrorResponse | Error) => {
          this.generating.set(false);
          this.inspectionPdfService.reset();
          const fallback =
            'Não foi possível gerar o PDF. Tente novamente ou fale com suporte.';
          this.error.set(
            err instanceof HttpErrorResponse
              ? this.apiErrors.messageFor(err, fallback)
              : err?.message || fallback,
          );
        },
      });
  }

  protected openPdf(docId: string): void {
    if (this.openingPdf()) return;
    this.error.set(null);
    this.openingPdf.set(true);
    this.rentalService.documentSignedUrl(this.rentalId(), docId).subscribe({
      next: (res) => {
        this.openingPdf.set(false);
        this.externalNav.openExternal(res.url);
      },
      error: (err: HttpErrorResponse) => {
        this.openingPdf.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível abrir o PDF.'));
      },
    });
  }

  /**
   * Baixa o PDF do laudo como arquivo local. Segue o mesmo padrão do contrato:
   * fetch da signed URL → blob → anchor download com filename amigável, evitando
   * expor a URL temporária do Supabase na barra de endereços.
   */
  protected downloadPdf(): void {
    const doc = this.generatedDoc();
    if (!doc || this.downloading()) return;
    this.error.set(null);
    this.downloading.set(true);
    this.rentalService.documentSignedUrl(this.rentalId(), doc.id).subscribe({
      next: async (res) => {
        try {
          const resp = await fetch(res.url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          const prefix = this.kind() === 'CHECKIN' ? 'Checkin' : 'Checkout';
          const filename = `${prefix}-${this.rentalId()}.pdf`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
          this.error.set('Falha ao baixar o PDF do laudo.');
          console.error('inspection download failed', err);
        } finally {
          this.downloading.set(false);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.downloading.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível baixar o PDF.'));
      },
    });
  }

  protected askDelete(): void {
    this.deleteOpen.set(true);
  }
  protected closeDelete(): void {
    if (!this.deleting()) this.deleteOpen.set(false);
  }
  protected confirmDelete(): void {
    const doc = this.generatedDoc();
    if (!doc) return;
    this.error.set(null);
    this.deleting.set(true);
    this.rentalService.deleteDocument(this.rentalId(), doc.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.notifications.push('success', 'PDF do laudo removido.');
        this.rentalService.refreshRentalState(this.rentalId());
        this.changed.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível remover o PDF.'));
      },
    });
  }

  protected formatSize(bytes: number | null): string {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR');
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
    if (this.photoBatchTimer !== null) clearTimeout(this.photoBatchTimer);
    this.uploadSubs.forEach((sub) => sub.unsubscribe());
    this.uploadSubs.clear();
    Object.values(this.slotPreview()).forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
}
