import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { ContractDropzone } from '../contract-dropzone';
import { ContractIcon } from '../contract-icon';

/**
 * «Ajustar o meu contrato», etapa 1: escolher o arquivo do Word (ou usar o contrato atual).
 * Só escolhe e valida o tamanho/tipo aqui; o envio acontece no «Continuar» da esteira.
 */
@Component({
  selector: 'app-contract-upload-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  imports: [ContractDropzone, ContractIcon],
  template: `
    <h3 class="m-0 text-lg font-semibold text-neutral-900">Envie o contrato que você usa hoje</h3>

    <app-contract-dropzone
      [title]="touch() ? 'Toque para escolher o arquivo do Word' : 'Arraste o arquivo do Word aqui ou clique para escolher'"
      [fileName]="fileName()"
      [fileSize]="fileSize()"
      [hint]="'Confira o texto ' + where() + '.'"
      [busy]="busy()"
      busyTitle="Buscando o contrato atual…"
      (picked)="picked.emit($event)"
      (cleared)="cleared.emit()"
    />

    @if (!fileName()) {

      @if (currentName(); as current) {
        <button type="button" (click)="useCurrent.emit()" [disabled]="busy()"
          class="flex min-h-[56px] w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-left hover:border-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-60">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <app-contract-icon name="file" [size]="18" />
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
  /** «40,5 KB». */
  readonly fileSize = input<string | null>(null);
  /** Nome do contrato atual; `null` esconde «Usar o contrato atual». */
  readonly currentName = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly busy = input(false);
  /** Tela de toque (sem «arrastar»): decide pelo tipo de ponteiro, não pela largura. */
  readonly touch = input(false);
  readonly where = input('ao lado');
  readonly zeroAvailable = input(true);

  readonly picked = output<File>();
  readonly useCurrent = output<void>();
  readonly cleared = output<void>();
  readonly goZero = output<void>();

  protected readonly help = signal(false);
}
