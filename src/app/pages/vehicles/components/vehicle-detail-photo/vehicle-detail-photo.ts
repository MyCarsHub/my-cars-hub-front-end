import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { map } from 'rxjs';
import { DocumentPreviewService } from '../../../../components/document-preview/document-preview.service';
import { VehiclesService } from '../../../../services/vehicles.service';
import { VehiclePhotoSource } from '../../../../types/vehicle.types';

/**
 * A foto do veículo no detalhe: quadro 16:10, largura total no celular e fixa a
 * partir de `sm`. Tocar abre o visualizador do app, o mesmo do «Abrir» do card
 * de documentos.
 *
 * Mostra a foto que o backend resolveu, com a mesma regra da lista. Este quadro
 * não sabe qual é a regra. Tocar é a única ação, e ela vale para as duas origens:
 * trocar ou remover é só do anexo PHOTO e fica no card de documentos, onde a
 * frente da vistoria nem aparece, porque não é um anexo do veículo.
 *
 * A URL é assinada com TTL curto. O quadro usa a que recebeu; o visualizador pede
 * outra a cada toque, porque a página pode ter ficado aberta além da validade.
 *
 * Imagem que não baixa sobe em `failed` e quem usa volta ao ícone: a foto é
 * opcional, o detalhe nunca fica com um quadro vazio por causa dela.
 */
@Component({
  selector: 'app-vehicle-detail-photo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'enter-up block w-full shrink-0 sm:w-[200px] lg:w-[240px]' },
  template: `
    <button
      type="button"
      data-vehicle-detail-photo
      [attr.data-photo-source]="source()"
      (click)="open()"
      [attr.aria-label]="label()"
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
      <img
        data-vehicle-detail-photo-img
        [src]="url()"
        alt=""
        (load)="loaded.set(true)"
        (error)="failed.emit()"
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ease-out
               motion-reduce:transition-none"
        [class.opacity-0]="!loaded()"
      />
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
  private readonly preview = inject(DocumentPreviewService);

  readonly vehicleId = input.required<string>();
  /** A URL assinada que o backend resolveu. */
  readonly url = input.required<string>();
  readonly source = input.required<VehiclePhotoSource>();
  /** Placa formatada, para o nome acessível do botão. */
  readonly plate = input.required<string>();
  /** Nome do anexo PHOTO, quando há um. A frente da vistoria não tem. */
  readonly fileName = input<string | null>(null);

  /** A foto não pôde ser exibida. */
  readonly failed = output<void>();

  /** Foto nova volta ao esqueleto até baixar. */
  protected readonly loaded = linkedSignal({ source: this.url, computation: () => false });

  private readonly fromInspection = computed(() => this.source() === 'INSPECTION');

  protected readonly label = computed(() =>
    this.fromInspection()
      ? `Ampliar a foto da vistoria do veículo ${this.plate()}`
      : `Ampliar a foto do veículo ${this.plate()}`,
  );

  protected open(): void {
    const vehicleId = this.vehicleId();
    const fromInspection = this.fromInspection();
    this.preview.open({
      source: () =>
        this.vehicles.getOne(vehicleId, { includePhoto: true }).pipe(
          map((vehicle) => {
            if (!vehicle.photoUrl) throw new Error('O veículo não tem mais foto.');
            return { url: vehicle.photoUrl };
          }),
        ),
      fileName: this.fileName() ?? `foto-${this.plate()}`,
      title: fromInspection ? 'Frente da última vistoria aprovada' : 'Foto do veículo',
      caption: this.plate(),
      errorMessage: 'Não foi possível abrir a foto.',
    });
  }
}
