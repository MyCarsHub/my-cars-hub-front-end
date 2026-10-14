import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { ContractAiService } from './contract-ai.service';
import { safeText } from './contract-ai.messages';

const MAX_BYTES = 5 * 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Tela 1 — enviar o contrato. O upload só cria o rascunho no servidor: nada vai para a IA
 * antes da tela de consentimento, que mostra o texto mascarado real.
 */
@Component({
  selector: 'app-contract-ai-intro',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="space-y-4">
      <p class="text-sm text-neutral-600">
        Envie o seu contrato em Word e a IA marca onde ficam o nome do motorista, a placa, os
        valores e as datas. Você confere tudo antes de salvar.
      </p>
      <ol class="text-sm text-neutral-700 space-y-1 list-decimal list-inside">
        <li>Envie o arquivo .docx.</li>
        <li>Veja o texto exato que iria para a IA e autorize.</li>
        <li>Responda só as dúvidas, veja como fica e salve.</li>
      </ol>

      @if (fileError(); as msg) {
        <p role="alert" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {{ msg }}
        </p>
      }

      @if (file(); as f) {
        <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-3 min-w-0">
          <p class="text-xs text-neutral-500">Arquivo escolhido</p>
          <p class="text-sm font-semibold text-neutral-900 break-words">{{ fileName() }}</p>
        </div>
        <div class="flex flex-col gap-2">
          <button
            type="button"
            (click)="send()"
            [disabled]="svc.busy()"
            class="w-full min-h-[48px] rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-[1.2rem] font-bold shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            @if (svc.busy()) { Enviando… } @else { Enviar arquivo }
          </button>
          <button
            type="button"
            (click)="cancel()"
            [disabled]="svc.busy()"
            class="w-full min-h-[44px] rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      } @else {
        <button
          type="button"
          (click)="picker.click()"
          class="w-full min-h-[48px] rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-[1.2rem] font-bold shadow-sm transition-colors"
        >
          Escolher arquivo
        </button>
        <p class="text-xs text-neutral-500">Word (.docx), até 5 MB.</p>
      }

      <input
        #picker
        type="file"
        class="hidden"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        (change)="onFile($event)"
        tabindex="-1"
      />

      <div class="flex flex-col sm:flex-row gap-2 pt-1">
        <button
          type="button"
          (click)="manual.emit()"
          class="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Ainda não tenho contrato
        </button>
        <button
          type="button"
          (click)="manual.emit()"
          class="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Prefiro montar sozinho
        </button>
      </div>
    </div>
  `,
})
export class ContractAiIntro {
  protected readonly svc = inject(ContractAiService);

  /** O usuário quer seguir pelo caminho manual (upload atual / contrato exemplo). */
  readonly manual = output<void>();

  protected readonly file = signal<File | null>(null);
  protected readonly fileError = signal<string | null>(null);

  protected fileName(): string {
    return safeText(this.file()?.name);
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0] ?? null;
    input.value = '';
    this.fileError.set(null);
    this.file.set(null);
    if (!picked) return;
    const reject = (msg: string): void => this.fileError.set(msg);
    if (!picked.name.toLowerCase().endsWith('.docx') || picked.type !== DOCX_MIME) {
      return reject('Envie o contrato em Word (.docx).');
    }
    if (picked.size > MAX_BYTES) {
      return reject('O arquivo é maior que 5 MB. Envie um arquivo menor.');
    }
    if (!(await hasZipSignature(picked))) {
      return reject('Este arquivo não parece ser um documento Word válido (.docx).');
    }
    this.file.set(picked);
  }

  protected send(): void {
    const f = this.file();
    if (!f || this.svc.busy()) return;
    this.svc.submit(f);
  }

  protected cancel(): void {
    this.file.set(null);
    this.fileError.set(null);
  }
}

/** DOCX é um ZIP: os 4 primeiros bytes são PK 03 04. */
function hasZipSignature(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result;
      if (!(buf instanceof ArrayBuffer) || buf.byteLength < 4) return resolve(false);
      const b = new Uint8Array(buf);
      resolve(b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04);
    };
    reader.onerror = () => resolve(false);
    reader.readAsArrayBuffer(file.slice(0, 4));
  });
}
