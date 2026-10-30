import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DocumentPreviewService } from '../../../../components/document-preview/document-preview.service';
import { DocumentLike } from '../../../../components/documents/documents-card';
import { ApiErrorService } from '../../../../services/api-error.service';
import { VehiclesService } from '../../../../services/vehicles.service';

/**
 * A foto do veículo no detalhe: quadro 16:10, largura total no celular e fixa a
 * partir de `sm`. Tocar abre o visualizador do app, o mesmo do «Abrir» do card
 * de documentos.
 *
 * Mostra o anexo PHOTO, e só ele. O recuo da lista para a frente da última
 * vistoria é decidido e assinado pelo backend só em `GET /vehicles`; o detalhe
 * não recebe esse dado.
 *
 * A URL é assinada com TTL curto. O quadro usa a que pediu ao entrar; o
 * visualizador pede outra a cada toque, porque a página pode ter ficado aberta
 * além da validade.
 *
 * Qualquer falha (assinar, baixar) sobe em `failed` e quem usa volta ao ícone:
 * a foto é opcional, o detalhe nunca fica com um quadro vazio por causa dela.
 */
@Component({
  selector: 'app-vehicle-detail-photo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'enter-up block w-full shrink-0 sm:w-[200px] lg:w-[240px]' },
  template: `
    <button
      type="button"
      data-vehicle-detail-photo
      (click)="open()"
      [attr.aria-label]="'Ampliar a foto do veículo ' + plate()"
      class="press relative block w-full aspect-[16/10] rounded-2xl overflow-hidden
             bg-surface-sunken border border-edge cursor-zoom-in
             focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
             focus-visible:outline-primary-600"
    >
      @if (!loaded()) {
        <span
          data-vehicle-detail-photo-skeleton
          class="absolute inset-0 bg-surface-sunken animate-pulse"
          aria-hidden="true"
        ></span>
      }
      @if (url(); as src) {
        <img
          data-vehicle-detail-photo-img
          [src]="src"
          alt=""
          (load)="loaded.set(true)"
          (error)="failed.emit()"
          class="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ease-out
                 motion-reduce:transition-none"
          [class.opacity-0]="!loaded()"
        />
      }
      <span
        class="absolute right-2 bottom-2 inline-flex items-center justify-center size-7 rounded-full
               bg-neutral-900/60 text-white"
        aria-hidden="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="15 3 21 3 21 9" />
          <line x1="14" y1="10" x2="21" y2="3" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="10" y1="14" x2="3" y2="21" />
        </svg>
      </span>
    </button>
  `,
})
export class VehicleDetailPhoto {
  private readonly vehicles = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly preview = inject(DocumentPreviewService);

  readonly vehicleId = input.required<string>();
  /** O anexo PHOTO do veículo. */
  readonly photo = input.required<DocumentLike>();
  /** Placa formatada, para o nome acessível do botão. */
  readonly plate = input.required<string>();

  /** A foto não pôde ser exibida. */
  readonly failed = output<void>();

  protected readonly url = signal<string | null>(null);
  protected readonly loaded = signal(false);

  private readonly photoId = computed(() => this.photo().id);

  constructor() {
    effect((onCleanup) => {
      const vehicleId = this.vehicleId();
      const photoId = this.photoId();
      this.url.set(null);
      this.loaded.set(false);
      const sub = untracked(() => this.vehicles.documentSignedUrl(vehicleId, photoId)).subscribe({
        next: (res) => this.url.set(res.url),
        error: (err: HttpErrorResponse) => {
          // O card de documentos, logo abaixo, é quem fala de falha de anexo.
          this.apiErrors.claim(err);
          this.failed.emit();
        },
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  protected open(): void {
    const photo = this.photo();
    this.preview.open({
      source: () => this.vehicles.documentSignedUrl(this.vehicleId(), photo.id),
      fileName: photo.fileName,
      title: 'Foto do veículo',
      caption: this.plate(),
      errorMessage: 'Não foi possível abrir a foto.',
    });
  }
}
