import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_LABEL,
  PHOTO_ACCEPT,
  formatDocumentSize,
  isAllowedPhotoFile,
} from '../../documents/document-file-rules';
import { ImageCompressionService } from '../../../services/image-compression.service';

/**
 * Campo «Foto do veículo» do formulário (cadastro e edição) — OPCIONAL.
 *
 * É o GESTO, a pré-visualização e o PREPARO do arquivo: escolher, comprimir,
 * trocar, remover. Quem sobe o arquivo é o formulário, pelo mesmo
 * `VehiclesService.uploadDocument(…, 'PHOTO')` do card de documentos do detalhe,
 * e as regras de arquivo vêm de `document-file-rules` (`MAX_PHOTO_BYTES`;
 * formatos estreitados ao que o servidor aceita para PHOTO). O formulário
 * continua dono do ESTADO.
 *
 * COMPRIME AO ESCOLHER, não ao salvar: a recusa por tamanho precisa acontecer
 * aqui, antes de o formulário apagar qualquer coisa, e os bytes reduzidos ficam
 * em memória — não dependem do arquivo original continuar acessível no celular
 * até o toque em Salvar. Enquanto comprime, `preparingChange` avisa o formulário
 * para segurar o Salvar: sem isso a foto sairia depois do veículo já enviado.
 *
 * A miniatura é QUADRADA e tem o tamanho da miniatura da lista de veículos
 * (104px; 148px em container largo) — o dono vê aqui o recorte que vai ver lá.
 */
@Component({
  selector: 'app-vehicle-photo-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './vehicle-photo-field.html',
})
export class VehiclePhotoField {
  private readonly compression = inject(ImageCompressionService);

  /** Arquivo escolhido agora e ainda não enviado (cadastro, ou troca na edição). */
  readonly file = input<File | null>(null);
  /** URL assinada da foto JÁ gravada (edição). Ignorada enquanto há `file`. */
  readonly currentUrl = input<string | null>(null);
  /** Há foto gravada, mesmo que a URL não tenha vindo (então a miniatura é o placeholder). */
  readonly hasCurrent = input(false);
  readonly disabled = input(false);

  readonly filePicked = output<File>();
  readonly removed = output<void>();
  /** `true` enquanto a foto escolhida está sendo comprimida. */
  readonly preparingChange = output<boolean>();

  protected readonly accept = PHOTO_ACCEPT;
  protected readonly maxLabel = MAX_PHOTO_LABEL;
  protected readonly rejection = signal<string | null>(null);
  protected readonly brokenImage = signal(false);
  protected readonly preparing = signal(false);
  /** Trava os gestos: trocar ou remover no meio da compressão disputaria com o resultado. */
  protected readonly locked = computed(() => this.disabled() || this.preparing());

  /** Pré-visualização local do arquivo escolhido; revogada ao trocar e ao destruir. */
  private readonly objectUrl = signal<string | null>(null);

  protected readonly previewUrl = computed(() => {
    if (this.file()) return this.objectUrl();
    return this.currentUrl();
  });

  protected readonly hasPhoto = computed(() => this.file() !== null || this.hasCurrent());

  protected readonly pickLabel = computed(() => (this.hasPhoto() ? 'Trocar foto' : 'Escolher foto'));

  private readonly picker = viewChild<ElementRef<HTMLInputElement>>('picker');

  /** A compressão é assíncrona: emitir depois de sair da tela lançaria NG0953. */
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    effect((onCleanup) => {
      const file = this.file();
      this.brokenImage.set(false);
      if (!file || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        this.objectUrl.set(null);
        return;
      }
      const url = URL.createObjectURL(file);
      this.objectUrl.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
    });
  }

  protected openPicker(): void {
    if (this.locked()) return;
    this.picker()?.nativeElement.click();
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    // Zera o input ANTES de qualquer retorno: sem isso, escolher o MESMO arquivo
    // de novo depois de uma recusa não dispara `change`.
    target.value = '';
    if (!file) return;
    if (!isAllowedPhotoFile(file)) {
      this.rejection.set(
        'A foto precisa ser JPG, PNG ou WebP. Foto HEIC do iPhone: ' +
          'tire de novo em "Mais compatível" ou exporte como JPG.',
      );
      return;
    }

    this.rejection.set(null);
    this.setPreparing(true);
    // Nunca lança: sem conseguir decodificar, devolve o original, e é o teto
    // abaixo que decide. Por isso o tamanho só é lido DEPOIS de comprimir.
    const prepared = await this.compression.compress(file);
    if (this.destroyed) return;
    this.setPreparing(false);

    if (prepared.size > MAX_PHOTO_BYTES) {
      this.rejection.set(
        `A foto tem ${formatDocumentSize(prepared.size)} e o limite é ${MAX_PHOTO_LABEL}. ` +
          'Escolha uma foto com menos resolução.',
      );
      return;
    }
    this.filePicked.emit(prepared);
  }

  protected remove(): void {
    if (this.locked()) return;
    this.rejection.set(null);
    this.removed.emit();
  }

  private setPreparing(value: boolean): void {
    this.preparing.set(value);
    this.preparingChange.emit(value);
  }
}
