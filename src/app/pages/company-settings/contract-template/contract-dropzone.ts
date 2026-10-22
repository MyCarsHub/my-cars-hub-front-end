import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { ContractIcon } from './contract-icon';

export const DOCX_ACCEPT =
  '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Área de enviar o arquivo do Word (etapa «Enviar» e caminho do Word). Vazia: ícone num
 * círculo laranja, título e a linha de ajuda; ao passar o mouse ou arrastar, borda e fundo
 * laranja. Com arquivo: documento, nome, tamanho e «Trocar arquivo». Validar o arquivo é
 * de quem usa (`picked`).
 */
@Component({
  selector: 'app-contract-dropzone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: '@container block' },
  imports: [ContractIcon],
  template: `
    @if (fileName(); as name) {
      <!-- Estreito (celular, painel lado a lado): «Trocar arquivo» desce e ocupa a linha toda. -->
      <div class="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700">
          <app-contract-icon name="file" [size]="22" />
        </span>
        <div class="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
          <span class="text-[15px] font-semibold text-emerald-900 break-all">{{ name }}</span>
          <span class="text-[13px] text-emerald-800">
            @if (fileSize()) { {{ fileSize() }} · }{{ hint() }}
          </span>
        </div>
        <button type="button" (click)="cleared.emit()" [disabled]="busy()"
          class="min-h-[44px] w-full shrink-0 rounded-xl border border-emerald-200 bg-white px-3 text-base font-semibold text-emerald-900 hover:bg-emerald-100 @md:w-auto @md:border-transparent @md:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-60">
          Trocar arquivo
        </button>
      </div>
    } @else {
      <label
        data-dropzone
        (dragover)="onDragOver($event)"
        (dragleave)="drag.set(false)"
        (drop)="onDrop($event)"
        class="group relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-center transition-colors hover:border-primary-500 hover:bg-primary-50/60 focus-within:ring-2 focus-within:ring-primary-400"
        [class]="(drag() ? 'border-primary-500 bg-primary-50/60 ' : 'border-neutral-300 bg-white ') +
          (compact() ? 'min-h-[56px] flex-row gap-3 px-4 py-3 sm:flex-col sm:min-h-[150px] sm:py-5' : 'min-h-[180px] px-4 py-6 sm:min-h-[200px]')"
        [class.opacity-60]="busy()"
      >
        <input type="file" class="sr-only" [accept]="accept" [disabled]="busy()" (change)="onInput($event)" />
        <span
          class="flex shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700 transition-transform group-hover:scale-105"
          [class]="compact() ? 'h-10 w-10 sm:h-14 sm:w-14' : 'h-14 w-14 sm:h-16 sm:w-16'"
          [class.scale-110]="drag()"
        >
          <app-contract-icon name="fileUp" [size]="compact() ? 22 : 28" />
        </span>
        <span class="flex flex-col gap-1" [class.text-left]="compact()" [class.sm:text-center]="compact()">
          <span class="text-base font-semibold text-neutral-800">{{ busy() ? busyTitle() : title() }}</span>
          <span class="text-sm text-neutral-600">Arquivo do Word, até 5 MB.</span>
        </span>
      </label>
    }
  `,
})
export class ContractDropzone {
  readonly title = input.required<string>();
  readonly busyTitle = input('Enviando…');
  readonly fileName = input<string | null>(null);
  readonly fileSize = input<string | null>(null);
  /** Linha sob o nome do arquivo escolhido. */
  readonly hint = input('');
  readonly busy = input(false);
  /** Bloco mais baixo, em linha no celular (o caminho do Word, que tem outros botões). */
  readonly compact = input(false);

  readonly picked = output<File>();
  readonly cleared = output<void>();

  protected readonly accept = DOCX_ACCEPT;
  protected readonly drag = signal(false);

  protected onInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (file) this.picked.emit(file);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.busy()) this.drag.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.drag.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file && !this.busy()) this.picked.emit(file);
  }
}

/** «40,5 KB» / «1,2 MB». */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
