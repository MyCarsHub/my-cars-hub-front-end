import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  MAX_DOCUMENT_BYTES,
  PHOTO_ACCEPT,
  formatDocumentSize,
  isAllowedPhotoFile,
} from '../../documents/document-file-rules';

/**
 * Campo «Foto do veículo» do formulário (cadastro e edição) — OPCIONAL.
 *
 * É só o GESTO e a pré-visualização: escolher, trocar, remover. Quem sobe o
 * arquivo é o formulário, pelo mesmo `VehiclesService.uploadDocument(…, 'PHOTO')`
 * do card de documentos do detalhe, e as regras de arquivo vêm de
 * `document-file-rules` (mesmo teto de 20MB; formatos estreitados ao que o
 * servidor aceita para PHOTO). O formulário continua dono do ESTADO.
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
  /** Arquivo escolhido agora e ainda não enviado (cadastro, ou troca na edição). */
  readonly file = input<File | null>(null);
  /** URL assinada da foto JÁ gravada (edição). Ignorada enquanto há `file`. */
  readonly currentUrl = input<string | null>(null);
  /** Há foto gravada, mesmo que a URL não tenha vindo (então a miniatura é o placeholder). */
  readonly hasCurrent = input(false);
  readonly disabled = input(false);

  readonly filePicked = output<File>();
  readonly removed = output<void>();

  protected readonly accept = PHOTO_ACCEPT;
  protected readonly rejection = signal<string | null>(null);
  protected readonly brokenImage = signal(false);

  /** Pré-visualização local do arquivo escolhido; revogada ao trocar e ao destruir. */
  private readonly objectUrl = signal<string | null>(null);

  protected readonly previewUrl = computed(() => {
    if (this.file()) return this.objectUrl();
    return this.currentUrl();
  });

  protected readonly hasPhoto = computed(() => this.file() !== null || this.hasCurrent());

  protected readonly pickLabel = computed(() => (this.hasPhoto() ? 'Trocar foto' : 'Escolher foto'));

  private readonly picker = viewChild<ElementRef<HTMLInputElement>>('picker');

  constructor() {
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
    if (this.disabled()) return;
    this.picker()?.nativeElement.click();
  }

  protected onFileSelected(event: Event): void {
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
    if (file.size > MAX_DOCUMENT_BYTES) {
      this.rejection.set(
        `A foto tem ${formatDocumentSize(file.size)} e o limite é 20MB. ` +
          'Escolha uma foto com menos resolução.',
      );
      return;
    }
    this.rejection.set(null);
    this.filePicked.emit(file);
  }

  protected remove(): void {
    if (this.disabled()) return;
    this.rejection.set(null);
    this.removed.emit();
  }
}
