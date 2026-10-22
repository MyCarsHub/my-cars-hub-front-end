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
    <div class="flex flex-col gap-1.5">
      <h3 data-step-heading tabindex="-1" class="m-0 text-xl font-bold leading-snug text-neutral-900 focus:outline-none">
        Envie o contrato que você usa hoje
      </h3>
      <p class="m-0 text-[15px] leading-relaxed text-neutral-600">
        O mesmo arquivo do Word que você imprime para o cliente assinar.
      </p>
    </div>

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
        <div class="flex items-center gap-3 text-[13px] font-semibold uppercase tracking-wide text-neutral-500" aria-hidden="true">
          <span class="h-px flex-1 bg-neutral-200"></span>ou<span class="h-px flex-1 bg-neutral-200"></span>
        </div>
        <button type="button" (click)="useCurrent.emit()" [disabled]="busy()"
          class="group flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-neutral-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-60">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
            <app-contract-icon name="fileText" [size]="20" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-base font-semibold text-neutral-900">
              {{ busy() ? 'Buscando o contrato atual…' : 'Usar o contrato atual' }}
            </span>
            <span class="text-[13px] text-neutral-600 break-words [overflow-wrap:anywhere]">{{ current }}</span>
          </span>
          <app-contract-icon name="arrowRight" [size]="18" class="text-neutral-500 transition-transform " />
        </button>
      }
    }

    @if (error(); as message) {
      <p role="alert" class="m-0 flex items-start gap-2 rounded-xl bg-rose-50 px-3.5 py-3 text-[15px] leading-snug text-rose-800">
        <app-contract-icon name="alert" [size]="18" class="mt-px text-rose-700" />
        <span>{{ message }}</span>
      </p>
    }

    @if (!fileName()) {
      <div class="rounded-2xl bg-neutral-50 px-1">
        <button type="button" (click)="help.set(!help())" [attr.aria-expanded]="help()"
          aria-controls="contract-upload-help"
          class="flex min-h-[52px] w-full items-center gap-2.5 rounded-2xl px-3 text-left text-[15px] font-semibold text-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
          <app-contract-icon name="info" [size]="18" class="text-sky-700" />
          <span class="flex-1">Não sei onde está o arquivo</span>
          <app-contract-icon name="chevronDown" [size]="18" class="text-neutral-600 transition-transform" [class.rotate-180]="help()" />
        </button>
        @if (help()) {
          <div id="contract-upload-help" class="flex flex-col gap-3 px-3 pb-4">
            <ul class="m-0 flex list-none flex-col gap-2.5 p-0 text-[15px] leading-relaxed text-neutral-700">
              <li class="flex gap-2.5"><span class="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400"></span><span>Procure nas pastas <strong>Documentos</strong> ou <strong>Downloads</strong> um arquivo com o nome do contrato.</span></li>
              <li class="flex gap-2.5"><span class="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400"></span><span>O arquivo certo é do Word. O nome termina em <strong>.docx</strong>.</span></li>
              <li class="flex gap-2.5"><span class="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400"></span><span>Se o seu contrato está só em PDF, impresso ou no WhatsApp, é mais fácil montar um do zero.</span></li>
            </ul>
            @if (zeroAvailable()) {
              <button type="button" (click)="goZero.emit()"
                class="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-5 text-base font-semibold text-neutral-800 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 sm:w-auto sm:self-start">
                <app-contract-icon name="layers" [size]="18" />
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
