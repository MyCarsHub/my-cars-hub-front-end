import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { AlertBanner } from '../../../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../../../services/api-error.service';
import { NotificationService } from '../../../../services/notification.service';
import { ContractTemplateDto, ContractTemplateService } from '../contract-template-service';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * «Já sei colocar os campos no Word»: o passo a passo de hoje, o contrato exemplo, as
 * instruções para IA e o envio do arquivo pronto (o upload direto que já existia).
 */
@Component({
  selector: 'app-contract-word-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  imports: [AlertBanner],
  template: `
    <ol class="m-0 flex flex-col gap-2 pl-5 text-[15px] leading-relaxed text-neutral-800">
      <li>
        Abra seu contrato no Word e faça <strong>Localizar e substituir</strong>: troque os dados fixos por campos como
        <code class="rounded bg-neutral-100 px-1.5 py-px font-mono text-[13px]">{{ driverCode }}</code>.
      </li>
      <li>Salve como .docx e envie aqui.</li>
      <li>Ao criar um aluguel, o contrato sai preenchido.</li>
    </ol>
    <p role="note" class="m-0 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-normal text-amber-800">
      <strong>Importante:</strong> digite cada campo de uma vez, sem trocar formatação no meio das chaves. Senão o
      Word quebra o texto e a substituição falha.
    </p>

    @if (error(); as message) {
      <app-alert-banner variant="error" [message]="message" />
    }

    <div class="flex flex-col gap-2.5">
      <button type="button" (click)="downloadExample()" [disabled]="exampleBusy()"
        class="min-h-[48px] rounded-xl bg-emerald-700 px-5 text-base font-semibold text-white hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 disabled:opacity-60">
        {{ exampleBusy() ? 'Baixando…' : 'Baixar contrato exemplo (.md)' }}
      </button>
      <button type="button" (click)="copyInstructions()" [disabled]="aiBusy()"
        class="min-h-[48px] rounded-xl border border-neutral-200 bg-white px-5 text-base font-semibold text-primary-700 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 disabled:opacity-60">
        {{ aiBusy() ? 'Copiando…' : 'Copiar instruções para IA' }}
      </button>
      <label
        class="relative flex min-h-[48px] cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-white px-4 text-base font-semibold text-neutral-800 hover:border-primary-500 focus-within:ring-2 focus-within:ring-primary-400"
        [class.opacity-60]="uploading()"
      >
        <input type="file" class="sr-only" [disabled]="uploading()"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          (change)="onFile($event)" />
        {{ uploading() ? 'Enviando…' : 'Enviar .docx pronto' }}
      </label>
    </div>
  `,
})
export class ContractWordStep {
  private readonly service = inject(ContractTemplateService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);

  readonly uploaded = output<ContractTemplateDto>();

  protected readonly driverCode = '{{driverName}}';
  protected readonly error = signal<string | null>(null);
  protected readonly exampleBusy = signal(false);
  protected readonly aiBusy = signal(false);
  protected readonly uploading = signal(false);

  protected onFile(event: Event): void {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    this.error.set(null);
    if (!file.name.toLowerCase().endsWith('.docx')) {
      this.error.set('Este arquivo não é do Word. Escolha o arquivo que termina em .docx.');
      return;
    }
    if (file.size > MAX_BYTES) {
      this.error.set('O arquivo é maior que 5 MB.');
      return;
    }
    this.uploading.set(true);
    this.service.upload(file).subscribe({
      next: (tpl) => {
        this.uploading.set(false);
        this.uploaded.emit(tpl);
      },
      error: (err: HttpErrorResponse) => {
        this.uploading.set(false);
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
        navigator.clipboard.writeText(md).then(
          () => this.notifications.success('Instruções copiadas. Cole no ChatGPT, Claude ou Gemini.'),
          () => {
            saveMarkdown(md, 'mycarshub-contrato-instrucoes.md');
            this.notifications.success('Não deu para copiar; as instruções foram baixadas.');
          },
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
