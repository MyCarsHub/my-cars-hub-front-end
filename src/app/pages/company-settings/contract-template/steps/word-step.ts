import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { AlertBanner } from '../../../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../../../components/core/confirm-dialog/confirm-dialog';
import { ApiErrorService } from '../../../../services/api-error.service';
import { NotificationService } from '../../../../services/notification.service';
import { ContractTemplateDto, ContractTemplateService } from '../contract-template-service';
import { ContractDropzone, hasZipSignature, isDocxFile } from '../contract-dropzone';
import { fieldLabel, safeText } from '../ai/contract-ai.messages';
import { ContractIcon } from '../contract-icon';
import { fieldCode } from '../contract-fields';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * «Já sei colocar os campos no Word»: o passo a passo de hoje, o contrato exemplo, as
 * instruções para IA e o envio do arquivo pronto (o upload direto que já existia).
 */
@Component({
  selector: 'app-contract-word-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  imports: [AlertBanner, ConfirmDialog, ContractDropzone, ContractIcon],
  template: `
    <h3 data-step-heading tabindex="-1" class="m-0 text-xl font-bold leading-snug text-neutral-900 focus:outline-none">
      Coloque os campos no seu arquivo
    </h3>
    <ol class="m-0 flex list-none flex-col gap-3 p-0 text-[15px] leading-relaxed text-neutral-800">
      <li class="flex gap-3">
        <span aria-hidden="true" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sm font-bold text-sky-800 ring-1 ring-sky-100">1</span>
        <span>
          Abra seu contrato no Word e faça <strong>Localizar e substituir</strong>: troque os dados fixos pelos campos. Por exemplo, para
          <strong data-field-label class="font-semibold text-neutral-900">{{ driverLabel }}</strong> digite
          <code class="select-all rounded bg-neutral-100 px-1.5 py-px font-mono text-[13px] text-neutral-700">{{ driverCode }}</code>.
          No contrato exemplo, cada campo mostra o nome e, ao lado, o que digitar.
        </span>
      </li>
      <li class="flex gap-3">
        <span aria-hidden="true" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sm font-bold text-sky-800 ring-1 ring-sky-100">2</span>
        <span class="pt-0.5">Salve como .docx e envie aqui.</span>
      </li>
      <li class="flex gap-3">
        <span aria-hidden="true" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"><app-contract-icon name="check" [size]="14" [stroke]="3" /></span>
        <span class="pt-0.5">Ao criar um aluguel, o contrato sai preenchido.</span>
      </li>
    </ol>
    <p role="note" class="m-0 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-normal text-amber-900">
      <app-contract-icon name="alert" [size]="18" class="mt-px text-amber-700" />
      <span><strong>Importante:</strong> digite cada campo de uma vez, sem trocar formatação no meio das chaves. Senão o
      Word quebra o texto e a substituição falha.</span>
    </p>

    @if (error(); as message) {
      <app-alert-banner variant="error" [message]="message" />
    }

    <div class="flex flex-col gap-2.5">
      <button type="button" (click)="downloadExample()" [disabled]="exampleBusy()"
        class="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-base font-semibold text-white shadow-sm hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 disabled:opacity-60">
        <app-contract-icon name="download" [size]="18" />
        {{ exampleBusy() ? 'Baixando…' : 'Baixar contrato exemplo (.md)' }}
      </button>
      <button type="button" (click)="copyInstructions()" [disabled]="aiBusy()"
        class="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-5 text-base font-semibold text-neutral-800 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 disabled:opacity-60">
        <app-contract-icon name="copy" [size]="18" />
        {{ aiBusy() ? 'Copiando…' : 'Copiar instruções para IA' }}
      </button>
      <app-contract-dropzone
        title="Enviar .docx pronto"
        [busy]="uploading()"
        [compact]="true"
        (picked)="onFile($event)"
      />
    </div>

    <app-confirm-dialog
      [open]="!!pending()"
      title="Substituir o contrato atual?"
      [message]="replaceMessage()"
      confirmLabel="Substituir"
      cancelLabel="Não substituir"
      variant="warning"
      size="large"
      [busy]="uploading()"
      (confirmed)="confirmReplace()"
      (cancelled)="pending.set(null)"
    />
  `,
})
export class ContractWordStep {
  private readonly service = inject(ContractTemplateService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);

  /** Nome do contrato em uso (já saneado); com ele, enviar pede confirmação antes. */
  readonly currentName = input<string | null>(null);
  readonly uploaded = output<ContractTemplateDto>();
  /** Envio em voo: a esteira segura o «Cancelar» (o servidor pode já ter trocado). */
  readonly busyChange = output<boolean>();
  /** Arquivo escolhido aguardando o «Substituir». */
  protected readonly pending = signal<File | null>(null);

  protected readonly driverLabel = fieldLabel('driverName');
  protected readonly driverCode = fieldCode('driverName');
  protected readonly error = signal<string | null>(null);
  protected readonly exampleBusy = signal(false);
  protected readonly aiBusy = signal(false);
  protected readonly uploading = signal(false);

  protected replaceMessage(): string {
    const file = this.pending();
    const name = file ? safeText(file.name) : '';
    return `«${name}» vai substituir «${this.currentName() ?? ''}» nos próximos aluguéis. Os contratos já gerados não mudam.`;
  }

  /** Mesmas checagens do «Ajustar o meu contrato»: Word, até 5 MB, assinatura ZIP. */
  protected async onFile(file: File): Promise<void> {
    this.error.set(null);
    if (!isDocxFile(file)) {
      this.error.set('Este arquivo não é do Word. Escolha o arquivo do contrato que termina em .docx.');
      return;
    }
    if (file.size > MAX_BYTES) {
      this.error.set('O arquivo é maior que 5 MB.');
      return;
    }
    if (!(await hasZipSignature(file))) {
      this.error.set('Este arquivo não parece ser um documento do Word. Escolha outro arquivo.');
      return;
    }
    if (this.currentName()) this.pending.set(file);
    else this.send(file);
  }

  protected confirmReplace(): void {
    const file = this.pending();
    if (file) this.send(file);
  }

  private send(file: File): void {
    if (this.uploading()) return;
    this.uploading.set(true);
    this.busyChange.emit(true);
    this.service.upload(file).subscribe({
      next: (tpl) => {
        this.uploading.set(false);
        this.pending.set(null);
        this.busyChange.emit(false);
        this.uploaded.emit(tpl);
      },
      error: (err: HttpErrorResponse) => {
        this.uploading.set(false);
        this.pending.set(null);
        this.busyChange.emit(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível enviar o arquivo.'));
      },
    });
  }

  protected downloadExample(): void {
    if (this.exampleBusy()) return;
    this.error.set(null);
    this.exampleBusy.set(true);
    this.service.example().subscribe({
      next: (md) => {
        this.exampleBusy.set(false);
        saveMarkdown(md, 'contrato-exemplo.md');
        this.notifications.success('Contrato exemplo baixado. Abra no Word e salve como .docx.');
      },
      error: (err: HttpErrorResponse) => {
        this.exampleBusy.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível baixar o exemplo.'));
      },
    });
  }

  protected copyInstructions(): void {
    if (this.aiBusy()) return;
    this.error.set(null);
    this.aiBusy.set(true);
    this.service.aiInstructions().subscribe({
      next: (md) => {
        this.aiBusy.set(false);
        const fallback = (): void => {
          saveMarkdown(md, 'mycarshub-contrato-instrucoes.md');
          this.notifications.success('Não deu para copiar; as instruções foram baixadas.');
        };
        // Sem contexto seguro não existe `navigator.clipboard`: baixa o arquivo direto.
        if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
          fallback();
          return;
        }
        navigator.clipboard.writeText(md).then(
          () => this.notifications.success('Instruções copiadas. Cole no ChatGPT, Claude ou Gemini.'),
          fallback,
        );
      },
      error: (err: HttpErrorResponse) => {
        this.aiBusy.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar as instruções.'));
      },
    });
  }
}

export function saveMarkdown(md: string, filename: string): void {
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  saveBlob(blob, filename);
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
