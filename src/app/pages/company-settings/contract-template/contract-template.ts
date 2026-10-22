import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { DocumentPreviewService } from '../../../components/document-preview/document-preview.service';
import { ContractTemplateDto, ContractTemplateService } from './contract-template-service';
import { ContractEsteira } from './contract-esteira';
import { saveBlob } from './steps/word-step';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Configurações → Contrato. O contrato atual (baixar, abrir, remover) e a esteira para
 * montar ou ajustar o contrato, com o contrato ao vivo sempre visível. Mobile-first.
 * Protótipo do dono: `design_handoff_contratos` (README + Contratos.dc.html).
 */
@Component({
  selector: 'app-contract-template',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [DefaultPageLayout, PageCard, ConfirmDialog, AlertBanner, ContractEsteira],
  template: `
    <app-default-page-layout
      title="Contrato"
      description="Configure uma vez e o contrato é gerado automaticamente em cada novo aluguel."
    >
      <div class="flex flex-col gap-4 sm:gap-7">
        @switch (state()) {
          @case ('loading') {
            <div aria-hidden="true" class="flex flex-col gap-6">
              <div class="h-[200px] rounded-2xl bg-neutral-100 animate-pulse"></div>
              <div class="h-[420px] rounded-2xl bg-neutral-100 animate-pulse"></div>
            </div>
          }
          @case ('error') {
            <app-alert-banner variant="error">
              <span class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <span class="flex-1 text-base">Não foi possível carregar o seu contrato.</span>
                <button type="button" (click)="reload()"
                  class="min-h-[48px] w-full rounded-xl border border-neutral-200 bg-white px-5 text-base font-semibold text-neutral-700 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 sm:w-auto">
                  Tentar novamente
                </button>
              </span>
            </app-alert-banner>
          }
          @case ('ready') {
            <app-page-card title="Contrato atual">
              <div class="flex flex-col gap-4 px-4 pb-5 sm:px-6 sm:pb-6">
                @if (savedNow()) {
                  <app-alert-banner variant="success"
                    message="Contrato salvo. Os próximos aluguéis já usam este contrato." />
                }
                @if (error(); as message) {
                  <app-alert-banner variant="error" [message]="message" />
                }
                @if (template(); as t) {
                  <div class="flex flex-col gap-4 rounded-2xl border border-neutral-200 p-4 sm:flex-row sm:items-center">
                    <div class="flex min-w-0 flex-1 items-center gap-4">
                      <span aria-hidden="true" class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                      </span>
                      <div class="flex min-w-0 flex-col gap-0.5">
                        <span class="text-base font-semibold text-neutral-900 break-all">{{ t.filename }}</span>
                        <span class="text-sm text-neutral-600 tabular-nums">
                          {{ formatSize(t.sizeBytes) }} · Atualizado {{ formatDate(t.uploadedAt) }}
                        </span>
                      </div>
                    </div>
                    <div class="grid shrink-0 grid-cols-2 gap-2.5 sm:flex">
                      <button type="button" (click)="downloadTemplate()" [disabled]="downloading()"
                        class="min-h-[48px] rounded-xl bg-emerald-700 px-3 leading-tight sm:whitespace-nowrap sm:px-5 text-base font-semibold text-white hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 disabled:opacity-60">
                        {{ downloading() ? 'Baixando…' : 'Baixar Contrato' }}
                      </button>
                      <button type="button" (click)="openTemplate()"
                        class="min-h-[48px] rounded-xl bg-primary-500 px-3 leading-tight sm:whitespace-nowrap sm:px-5 text-base font-semibold text-white hover:bg-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2">
                        Abrir contrato
                      </button>
                      <button type="button" (click)="deleteOpen.set(true)"
                        class="col-span-2 min-h-[48px] sm:whitespace-nowrap rounded-xl border border-neutral-200 bg-white px-5 text-base font-medium text-neutral-800 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 sm:col-span-1">
                        Remover
                      </button>
                    </div>
                  </div>
                } @else {
                  <p class="m-0 text-base text-neutral-600">Nenhum contrato cadastrado. Monte o seu abaixo.</p>
                }
              </div>
            </app-page-card>

            <app-contract-esteira [template]="template()" (saved)="onSaved($event)" />
          }
        }
      </div>
    </app-default-page-layout>

    <app-confirm-dialog
      [open]="deleteOpen()"
      title="Remover contrato?"
      [message]="removeMessage()"
      [confirmLabel]="deleting() ? 'Removendo…' : 'Remover'"
      cancelLabel="Cancelar"
      variant="danger"
      size="large"
      [busy]="deleting()"
      (confirmed)="confirmDelete()"
      (cancelled)="deleteOpen.set(false)"
    />
  `,
})
export class ContractTemplate implements OnInit {
  private readonly service = inject(ContractTemplateService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly preview = inject(DocumentPreviewService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly template = signal<ContractTemplateDto | null>(null);
  /** Falhas de ação no cartão do contrato atual (toasts ficam para sucesso). */
  protected readonly error = signal<string | null>(null);
  protected readonly savedNow = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);
  protected readonly downloading = signal(false);

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.state.set('loading');
    this.service.get().subscribe({
      next: (tpl) => {
        this.template.set(tpl);
        this.state.set('ready');
      },
      error: (err: HttpErrorResponse) => {
        this.apiErrors.claim(err);
        // 404 = nenhum contrato ainda: estado normal, não erro.
        if (err.status === 404) {
          this.template.set(null);
          this.state.set('ready');
        } else {
          this.state.set('error');
        }
      },
    });
  }

  protected removeMessage(): string {
    const name = this.template()?.filename ?? '';
    return `Tem certeza que deseja remover o contrato «${name}»? Os novos aluguéis vão exigir o envio manual do contrato.`;
  }

  protected onSaved(tpl: ContractTemplateDto): void {
    this.template.set(tpl);
    this.error.set(null);
    this.savedNow.set(true);
    this.notifications.success('Contrato salvo.');
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  protected confirmDelete(): void {
    if (this.deleting()) return;
    const name = this.template()?.filename ?? '';
    this.error.set(null);
    this.deleting.set(true);
    this.service.delete().subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.template.set(null);
        this.savedNow.set(false);
        this.notifications.success(`Contrato «${name}» removido.`);
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível remover o contrato.'));
      },
    });
  }

  /** Abre no visualizador do app (DOCX autenticado, saneado, sem aba nova). */
  protected openTemplate(): void {
    this.error.set(null);
    this.preview.open({
      source: () => this.service.downloadTemplate(),
      fileName: this.template()?.filename ?? 'contrato.docx',
      title: 'Contrato',
      errorMessage: 'Não foi possível abrir o contrato.',
    });
  }

  protected downloadTemplate(): void {
    if (this.downloading()) return;
    this.error.set(null);
    this.downloading.set(true);
    this.service.downloadTemplate().subscribe({
      next: (blob) => {
        this.downloading.set(false);
        saveBlob(blob, this.template()?.filename ?? 'contrato.docx');
      },
      error: (err: HttpErrorResponse) => {
        this.downloading.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível baixar o contrato.'));
      },
    });
  }

  protected formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR');
  }
}
