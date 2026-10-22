import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

/**
 * «Ajustar o meu contrato», etapa 1: escolher o arquivo do Word (ou usar o contrato atual).
 * Só escolhe e valida o tamanho/tipo aqui; o envio acontece no «Continuar» da esteira.
 */
@Component({
  selector: 'app-contract-upload-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  template: `
    <h3 class="m-0 text-lg font-semibold text-neutral-900">Envie o contrato que você usa hoje</h3>

    @if (fileName(); as name) {
      <div class="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
        <svg class="shrink-0 text-emerald-700" xmlns="http://www.w3.org/2000/svg" width="20" height="20"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-[15px] font-semibold text-emerald-900 break-all">{{ name }}</span>
          <span class="text-[13px] text-emerald-800">Confira o texto {{ where() }}.</span>
        </div>
        <button type="button" (click)="cleared.emit()" [disabled]="busy()"
          class="min-h-[44px] shrink-0 rounded-xl px-3 text-base font-semibold text-emerald-900 hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-60">
          Trocar
        </button>
      </div>
    } @else {
      <label
        (dragover)="onDragOver($event)"
        (dragleave)="drag.set(false)"
        (drop)="onDrop($event)"
        class="relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-6 text-center hover:border-primary-500 focus-within:ring-2 focus-within:ring-primary-400"
        [class]="drag() ? 'border-primary-500 bg-primary-50' : 'border-neutral-300 bg-white'"
      >
        <input
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          class="sr-only"
          (change)="onInput($event)"
        />
        <span class="text-base font-semibold text-neutral-800">
          {{ narrow() ? 'Toque para escolher o arquivo do Word' : 'Arraste o arquivo do Word aqui ou clique para escolher' }}
        </span>
        <span class="text-sm text-neutral-600">Arquivo do Word, até 5 MB.</span>
      </label>

      @if (currentName(); as current) {
        <button type="button" (click)="useCurrent.emit()" [disabled]="busy()"
          class="flex min-h-[56px] w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-left hover:border-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-60">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-[15px] font-semibold text-neutral-900">
              {{ busy() ? 'Buscando o contrato atual…' : 'Usar o contrato atual' }}
            </span>
            <span class="text-[13px] text-neutral-600 break-all">{{ current }}</span>
          </span>
        </button>
      }
    }

    @if (error(); as message) {
      <p role="alert" class="m-0 text-sm text-rose-700">{{ message }}</p>
    }

    @if (!fileName()) {
      <div class="border-t border-neutral-100">
        <button type="button" (click)="help.set(!help())" [attr.aria-expanded]="help()"
          aria-controls="contract-upload-help"
          class="flex min-h-[52px] w-full items-center gap-2 text-left text-[15px] font-semibold text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
          <span class="flex-1">Não sei onde está o arquivo</span>
          <svg class="transition-transform" [class.rotate-180]="help()" xmlns="http://www.w3.org/2000/svg"
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        @if (help()) {
          <div id="contract-upload-help" class="flex flex-col gap-3 pb-2">
            <ul class="m-0 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-neutral-700">
              <li>Procure nas pastas <strong>Documentos</strong> ou <strong>Downloads</strong> um arquivo com o nome do contrato.</li>
              <li>O arquivo certo é do Word. O nome termina em <strong>.docx</strong>.</li>
              <li>Se o seu contrato está só em PDF, impresso ou no WhatsApp, é mais fácil montar um do zero.</li>
            </ul>
            @if (zeroAvailable()) {
              <button type="button" (click)="goZero.emit()"
                class="min-h-[48px] w-full rounded-xl border border-neutral-200 bg-white px-5 text-base font-semibold text-neutral-700 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 sm:w-auto sm:self-start">
                Montar do zero
              </button>
            }
          </div>
        }
      </div>
    }
  `,
})
export class ContractUploadStep {
  readonly fileName = input<string | null>(null);
  /** Nome do contrato atual; `null` esconde «Usar o contrato atual». */
  readonly currentName = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly busy = input(false);
  readonly narrow = input(false);
  readonly where = input('ao lado');
  readonly zeroAvailable = input(true);

  readonly picked = output<File>();
  readonly useCurrent = output<void>();
  readonly cleared = output<void>();
  readonly goZero = output<void>();

  protected readonly drag = signal(false);
  protected readonly help = signal(false);

  protected onInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (file) this.picked.emit(file);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.drag.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.drag.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.picked.emit(file);
  }
}
