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
import { ContractIcon } from './contract-icon';
import { saveBlob } from './steps/word-step';
import { safeText } from './ai/contract-ai.messages';

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
  imports: [DefaultPageLayout, PageCard, ConfirmDialog, AlertBanner, ContractEsteira, ContractIcon],
  // O momento «contrato salvo!»: o aviso entra e o selo dá um pulo. Sem movimento se o
  // sistema pede menos movimento.
  styles: `
    @keyframes saved-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: none; }
    }
    @keyframes seal-pop {
      0% { transform: scale(0.4); }
      60% { transform: scale(1.12); }
      100% { transform: scale(1); }
    }
    .saved-glow { box-shadow: 0 0 0 4px rgb(16 185 129 / 0.25); }
    @media (prefers-reduced-motion: no-preference) {
      .saved-in { animation: saved-in 320ms var(--ease-out) both; }
      .saved-seal { animation: seal-pop 520ms var(--ease-out) 120ms both; }
    }
  `,
  template: `
    <app-default-page-layout
      title="Contrato"
      description="Configure uma vez e o contrato é gerado automaticamente em cada novo aluguel."
    >
      <div class="flex flex-col gap-4 sm:gap-7">
        @switch (state()) {
          @case ('loading') {
            <div aria-hidden="true" class="flex flex-col gap-6">
              <div class="h-[200px] rounded-2xl bg-surface-sunken animate-pulse"></div>
              <div class="h-[420px] rounded-2xl bg-surface-sunken animate-pulse"></div>
            </div>
          }
          @case ('error') {
            <app-alert-banner variant="error">
              <span class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <span class="flex-1 text-base">Não foi possível carregar o seu contrato.</span>
                <button type="button" (click)="reload()"
                  class="min-h-[48px] w-full rounded-xl border border-edge bg-surface px-5 text-base font-semibold text-fg-soft hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 sm:w-auto">
                  Tentar novamente
                </button>
              </span>
            </app-alert-banner>
          }
          @case ('ready') {
            <div class="rounded-[20px] transition-shadow duration-700"
              [class]="savedNow() ? 'saved-glow' : ''">
            <app-page-card title="Contrato atual">
              <span cardIcon aria-hidden="true" class="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <app-contract-icon name="fileText" [size]="18" />
              </span>
              @if (template()) {
                <span cardActions class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 text-[13px] font-semibold text-emerald-800 dark:text-emerald-200 ring-1 ring-emerald-200 dark:ring-emerald-500/30">
                  <span aria-hidden="true" class="h-2 w-2 rounded-full bg-emerald-500"></span>
                  Em uso
                </span>
              }
              <!-- @container: a linha do arquivo decide pela largura do CARTÃO, não da tela
                   (com a sidebar, 1024 px de tela deixam ~640 px aqui). -->
              <div class="@container flex flex-col gap-4 px-4 pb-5 sm:px-6 sm:pb-6">
                @if (savedNow()) {
                  <div role="status" class="saved-in flex items-start gap-3.5 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-4">
                    <span aria-hidden="true" class="saved-seal flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white shadow-md">
                      <app-contract-icon name="check" [size]="26" [stroke]="3" />
                    </span>
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
                      <p class="m-0 text-lg font-bold text-emerald-900 dark:text-emerald-200">Contrato salvo!</p>
                      <p class="m-0 text-[15px] leading-snug text-emerald-900 dark:text-emerald-200">
                        Os próximos aluguéis já usam este contrato. Cada um sai preenchido sozinho.
                      </p>
                    </div>
                    <button type="button" (click)="savedNow.set(false)" aria-label="Fechar aviso"
                      class="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-500/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                      <app-contract-icon name="x" [size]="18" />
                    </button>
                  </div>
                }
                @if (error(); as message) {
                  <app-alert-banner variant="error" [message]="message" />
                }
                @if (template(); as t) {
                  <div class="flex flex-col gap-4 @md:rounded-2xl @md:border @md:border-edge @md:p-4 @3xl:flex-row @3xl:items-center">
                    <div class="flex min-w-0 flex-1 items-center gap-4">
                      <!-- Miniatura de folha: o contrato em uso, não um ícone genérico. -->
                      <span aria-hidden="true" class="relative flex h-14 w-11 shrink-0 flex-col gap-1 rounded-[3px] bg-surface px-2 py-2.5 shadow-md ring-1 ring-black/5">
                        <span class="mx-auto h-1 w-4/5 rounded bg-neutral-400 dark:bg-neutral-500"></span>
                        <span class="h-0.5 rounded bg-surface-strong"></span>
                        <span class="flex gap-0.5"><span class="h-0.5 w-2 rounded bg-emerald-400"></span><span class="h-0.5 flex-1 rounded bg-surface-strong"></span></span>
                        <span class="h-0.5 rounded bg-surface-strong"></span>
                        <span class="flex gap-0.5"><span class="h-0.5 flex-1 rounded bg-surface-strong"></span><span class="h-0.5 w-3 rounded bg-emerald-400"></span></span>
                        <span class="h-0.5 w-3/4 rounded bg-surface-strong"></span>
                      </span>
                      <div class="flex min-w-0 flex-col gap-0.5">
                        <span class="text-base font-semibold text-fg break-words [overflow-wrap:anywhere]">{{ t.filename }}</span>
                        <span class="text-sm text-fg-muted tabular-nums">
                          {{ formatSize(t.sizeBytes) }} · Atualizado {{ formatDate(t.uploadedAt) }}
                        </span>
                      </div>
                    </div>
                    <div class="grid shrink-0 grid-cols-1 gap-2.5 @md:grid-cols-2 @3xl:flex">
                      <button type="button" (click)="downloadTemplate()" [disabled]="downloading()"
                        class="inline-flex min-h-[48px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-emerald-700 px-4 text-base font-semibold text-white shadow-sm hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 disabled:opacity-60 @3xl:px-5">
                        <app-contract-icon name="download" [size]="18" />
                        {{ downloading() ? 'Baixando…' : 'Baixar contrato' }}
                      </button>
                      <button type="button" (click)="openTemplate()"
                        class="inline-flex min-h-[48px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary-500 px-4 text-base font-semibold text-white shadow-sm hover:bg-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 @3xl:px-5">
                        <app-contract-icon name="eye" [size]="18" />
                        Abrir contrato
                      </button>
                      <button type="button" (click)="deleteOpen.set(true)"
                        class="inline-flex min-h-[48px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-edge-strong bg-surface px-5 text-base font-medium text-fg-body hover:border-rose-300 dark:hover:border-rose-500/40 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-800 dark:hover:text-rose-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 @md:col-span-2 @3xl:col-span-1">
                        <app-contract-icon name="trash" [size]="18" />
                        Remover
                      </button>
                    </div>
                  </div>
                } @else {
                  <div class="flex items-center gap-3.5 rounded-2xl border-2 border-dashed border-edge-strong bg-surface-muted px-4 py-4">
                    <span aria-hidden="true" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface text-fg-subtle ring-1 ring-edge">
                      <app-contract-icon name="file" [size]="20" />
                    </span>
                    <p class="m-0 flex-1 text-base text-fg-soft">Nenhum contrato cadastrado. Monte o seu abaixo.</p>
                    <app-contract-icon name="arrowRight" [size]="20" class="rotate-90 text-fg-subtle" />
                  </div>
                }
              </div>
            </app-page-card>
            </div>

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
        this.template.set(cleanName(tpl));
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
    this.template.set(cleanName(tpl));
    this.error.set(null);
    // O cartão «Contrato salvo!» (role=status) é o aviso; um toast junto repetiria a frase.
    this.savedNow.set(true);
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

/**
 * O nome vem do upload original, gravado como veio: sem caracteres de controle e bidi (um
 * RLO faria «cod.exe» parecer «exe.docx») na tela, nos avisos e no nome do download.
 */
function cleanName(tpl: ContractTemplateDto): ContractTemplateDto {
  return { ...tpl, filename: safeText(tpl.filename) || 'contrato.docx' };
}
