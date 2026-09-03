import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  DOCUMENT_ACCEPT,
  MAX_DOCUMENT_BYTES,
  formatDocumentSize,
  isAllowedDocumentFile,
} from './document-file-rules';

/** Um arquivo pendente como o bloco o exibe — o DONO do estado é o form. */
export interface PendingFileView {
  /** Identidade local do form (número no motorista, uid string na manutenção). */
  id: number | string;
  name: string;
  sizeText: string;
  /** Já subiu numa tentativa anterior (retry de falha parcial): slot tranca. */
  sent: boolean;
}

/** Um slot de tipo no CADASTRO, com os arquivos escolhidos dentro. */
export interface PendingSlotView {
  kind: string;
  label: string;
  hint: string;
  files: PendingFileView[];
  /** Algum arquivo do tipo já subiu — o slot não aceita nem substituição. */
  sent: boolean;
}

/**
 * Bloco de documentos do CADASTRO (modo pending-files) — extraído do
 * `driver-form` (FIX-0231); a forma canônica é a do FIX-0226/0227.
 *
 * O bloco é dono do GESTO: seletor de arquivos, pareamento toque→arquivo
 * (`pendingKind`) e validação pelas regras compartilhadas. O FORM continua
 * dono do ESTADO (lista de pendentes, substituição por tipo, `sent` do retry,
 * banner de erro): `filePicked` entrega um arquivo VÁLIDO com o tipo do slot
 * tocado; `fileRejected` entrega a mensagem inline; `fileRemoved` pede a
 * remoção de um pendente.
 *
 * UM arquivo por tipo (regra de produto): slot com pendente mostra
 * "Substituir" — a escolha SUBSTITUI, nunca acrescenta; slot com arquivo já
 * ENVIADO tranca (o anexo pertence ao pai e sai pelo card do detalhe).
 */
@Component({
  selector: 'app-pending-documents-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './pending-documents-block.html',
})
export class PendingDocumentsBlock {
  /** Descrição sob o título, com a entidade no genitivo ("do motorista"…). */
  readonly description = input.required<string>();
  readonly slots = input.required<PendingSlotView[]>();
  /** Trava tudo durante o submit do form. */
  readonly disabled = input(false);
  /** Complemento da label do slot trancado ("Gerencie pelo detalhe do motorista."). */
  readonly sentNote = input('Gerencie pelo detalhe.');

  readonly filePicked = output<{ kind: string; file: File }>();
  readonly fileRejected = output<string>();
  readonly fileRemoved = output<number | string>();

  protected readonly accept = DOCUMENT_ACCEPT;

  /**
   * ALVO do seletor — a intenção do toque, não estado de envio. O diálogo
   * nativo pode ser dispensado sem escolher nada, então nada de "Enviando"
   * nasce aqui (mesmo conserto do card de documentos).
   */
  private readonly pendingKind = signal<string | null>(null);

  private readonly picker = viewChild<ElementRef<HTMLInputElement>>('picker');

  /** O slot É a afordância: tocá-lo registra o tipo e abre o seletor. */
  protected openPicker(slot: PendingSlotView): void {
    if (this.disabled() || slot.sent) return;
    this.pendingKind.set(slot.kind);
    this.picker()?.nativeElement.click();
  }

  protected onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    // Zera o input ANTES de qualquer retorno: sem isso, escolher o MESMO
    // arquivo de novo depois de um erro não dispara `change`.
    target.value = '';
    const kind = this.pendingKind();
    this.pendingKind.set(null);
    if (!file || !kind) return;

    if (!isAllowedDocumentFile(file)) {
      this.fileRejected.emit('Formato não suportado. Aceitos: PDF, JPG, PNG, WebP, HEIC/HEIF.');
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      this.fileRejected.emit(
        `O arquivo tem ${formatDocumentSize(file.size)} e o limite é 20MB. ` +
          'Fotografe o documento com menos resolução e escolha de novo.',
      );
      return;
    }

    this.filePicked.emit({ kind, file });
  }

  protected slotAriaLabel(slot: PendingSlotView): string {
    if (slot.sent) {
      return `${slot.label} — documento já enviado. ${this.sentNote()}`;
    }
    if (slot.files.length === 0) return `Anexar ${slot.label} — nenhum arquivo escolhido`;
    return `Substituir ${slot.label} — escolher outro arquivo substitui o atual`;
  }

  protected removeAriaLabel(file: PendingFileView): string {
    return `Remover ${file.name}`;
  }
}
