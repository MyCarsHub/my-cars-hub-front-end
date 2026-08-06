import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { POLICY_DOCUMENT_PLACEHOLDER_COPY } from '../../services/pending-tab-placeholder';
import { InsurancesService } from '../../services/insurances.service';
import { InsurancePolicyDocument } from '../../types/insurance.types';

/**
 * Teto de upload do cliente, alinhado ao do servidor
 * (`InsurancePolicyDocumentService.MAX_PDF_BYTES` = 20MB, e ao
 * `spring.servlet.multipart.max-file-size`). Um teto menor aqui barraria no
 * navegador um PDF que o servidor aceitaria, citando um limite que não existe.
 */
const MAX_POLICY_BYTES = 20 * 1024 * 1024;

/** Rótulo do teto usado nas mensagens — um só lugar para não divergir de novo. */
const MAX_POLICY_LABEL = '20MB';

/**
 * Apólice em PDF de um seguro: anexar, abrir (via signed URL) e remover.
 *
 * NÃO EXIBE PROGRESSO DE UPLOAD, e isso é deliberado: o app usa
 * `provideHttpClient(withFetch())`, e o `FetchBackend` do Angular nunca emite
 * `HttpEventType.UploadProgress`. Qualquer barra aqui seria uma animação
 * desconectada do envio real — exatamente o padrão que já está registrado como
 * defeito conhecido neste projeto. O estado é indeterminado e assumido como tal.
 */
@Component({
  selector: 'app-insurance-policy-document-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [PageCard, ConfirmDialog, AlertBanner],
  template: `
    <app-page-card title="Apólice em PDF">
      <div class="p-4 sm:p-6 space-y-4">
        @if (error(); as cardError) {
          <app-alert-banner variant="error" [message]="cardError" />
        }

        @if (uploading()) {
          <div
            class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl
                   border border-primary-200 bg-primary-50 p-3"
            role="status"
            aria-live="polite"
          >
            <p class="text-sm font-medium text-primary-800">
              Enviando o PDF da apólice… Mantenha esta tela aberta.
            </p>
            <button
              type="button"
              (click)="cancelUpload()"
              class="w-full sm:w-auto inline-flex items-center justify-center px-4 rounded-xl
                     border border-neutral-300 bg-white text-sm font-medium text-neutral-700
                     hover:bg-neutral-50 transition-colors min-h-[44px]
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              Cancelar envio
            </button>
          </div>
        } @else if (document(); as doc) {
          <div
            class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl
                   border border-neutral-200 bg-white p-3"
          >
            <div class="flex items-center gap-3 min-w-0">
              <span
                class="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50
                       text-rose-700 shrink-0"
                aria-hidden="true"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </span>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-neutral-900">Apólice (PDF)</p>
                <p class="text-xs text-neutral-500 tabular-nums">
                  {{ sizeText() }} · Enviada {{ uploadedAtText() }}
                </p>
              </div>
            </div>
            <div class="flex flex-col sm:flex-row gap-2 shrink-0">
              <button
                type="button"
                (click)="openDocument()"
                [disabled]="opening()"
                class="w-full sm:w-auto inline-flex items-center justify-center px-4 rounded-xl
                       bg-primary-700 hover:bg-primary-800 text-white text-sm font-semibold
                       shadow-sm transition-colors min-h-[44px]
                       disabled:opacity-60 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600
                       focus-visible:ring-offset-2"
              >
                @if (opening()) {
                  Abrindo…
                } @else {
                  Abrir apólice
                }
              </button>
              <button
                type="button"
                (click)="picker.click()"
                class="w-full sm:w-auto inline-flex items-center justify-center px-4 rounded-xl
                       border border-neutral-300 text-neutral-700 text-sm font-medium
                       hover:bg-neutral-50 transition-colors min-h-[44px]
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
              >
                Substituir
              </button>
              <button
                type="button"
                (click)="askDelete()"
                [disabled]="deleting()"
                class="w-full sm:w-auto inline-flex items-center justify-center px-4 rounded-xl
                       border border-rose-300 text-rose-700 text-sm font-medium
                       hover:bg-rose-50 transition-colors min-h-[44px]
                       disabled:opacity-60 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                Remover
              </button>
            </div>
          </div>
        } @else {
          <div
            class="rounded-xl border-2 border-dashed border-neutral-300 p-6 sm:p-8 text-center space-y-3"
          >
            <p class="text-sm text-neutral-600">
              Nenhuma apólice anexada. Envie o PDF recebido da seguradora para tê-lo à mão
              em qualquer dispositivo.
            </p>
            <button
              type="button"
              (click)="picker.click()"
              class="w-full sm:w-auto inline-flex items-center justify-center px-5 rounded-xl
                     bg-primary-700 hover:bg-primary-800 text-white text-sm font-semibold
                     shadow-sm transition-colors min-h-[48px]
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600
                     focus-visible:ring-offset-2"
            >
              Anexar apólice em PDF
            </button>
          </div>
        }

        <input
          #picker
          type="file"
          accept="application/pdf,.pdf"
          hidden
          aria-hidden="true"
          tabindex="-1"
          (change)="onFileSelected($event)"
        />
      </div>
    </app-page-card>

    <app-confirm-dialog
      [open]="deleteOpen()"
      title="Remover a apólice em PDF?"
      message="O arquivo será apagado do armazenamento e não poderá ser recuperado. Os dados da apólice (seguradora, prêmio, vigência) continuam cadastrados."
      confirmLabel="Remover"
      cancelLabel="Voltar"
      variant="danger"
      (confirmed)="confirmDelete()"
      (cancelled)="closeDelete()"
    />
  `,
})
export class InsurancePolicyDocumentCard implements OnDestroy {
  private readonly insurancesService = inject(InsurancesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly externalNavigation = inject(ExternalNavigationService);

  readonly insuranceId = input.required<string>();
  /** Documento vindo do `GET /v1/insurances/{id}`. `null` = nada anexado. */
  readonly policyDocument = input<InsurancePolicyDocument | null>(null);
  /** Emite o novo estado do documento (ou `null` após remoção) para o pai. */
  readonly changed = output<InsurancePolicyDocument | null>();

  /**
   * Estado local semeado pelo input. `linkedSignal` porque o POST/DELETE já
   * devolve o resultado final: a UI reflete a mutação sem esperar o pai
   * recarregar, e volta a acompanhar o input se ele mudar de fato.
   */
  protected readonly document = linkedSignal<InsurancePolicyDocument | null>(() =>
    this.policyDocument(),
  );

  /** Falha de negócio: banner inline dentro do card, nunca toast. */
  protected readonly error = signal<string | null>(null);
  protected readonly uploading = signal(false);
  protected readonly opening = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deleteOpen = signal(false);

  private uploadSub: Subscription | null = null;

  protected readonly sizeText = computed<string>(() => formatSize(this.document()?.sizeBytes));

  protected readonly uploadedAtText = computed<string>(() => {
    const uploadedAt = this.document()?.uploadedAt;
    if (!uploadedAt) return '—';
    return new Date(uploadedAt).toLocaleDateString('pt-BR');
  });

  ngOnDestroy(): void {
    this.uploadSub?.unsubscribe();
  }

  protected onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    // Zera o input antes de qualquer retorno: sem isso, escolher o MESMO
    // arquivo de novo depois de um erro não dispara `change`.
    target.value = '';
    if (!file) return;

    // Guardas client-side: falham antes de gastar dados móveis num upload que
    // o backend recusaria.
    //
    // As DUAS condições são exigidas, e não uma ou outra: o servidor valida o
    // media type declarado E os magic bytes, então um `.txt` renomeado para
    // `.pdf` (ou um PDF anunciado como octet-stream) seria recusado lá de
    // qualquer jeito. Checar aqui só antecipa o erro em vez de gastar o upload.
    if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
      this.error.set('Formato não suportado. A apólice precisa ser um arquivo PDF.');
      return;
    }
    if (file.size > MAX_POLICY_BYTES) {
      this.error.set(
        `O arquivo tem ${formatSize(file.size)} e o limite é ${MAX_POLICY_LABEL}. ` +
          'Comprima o PDF (ou reduza a qualidade do scan) e envie de novo.',
      );
      return;
    }

    this.error.set(null);
    this.uploading.set(true);
    this.uploadSub = this.insurancesService
      .uploadPolicyDocument(this.insuranceId(), file)
      .subscribe({
        next: (doc) => {
          this.finishUpload();
          this.document.set(doc);
          this.changed.emit(doc);
          this.notifications.success('Apólice anexada.');
        },
        error: (err: HttpErrorResponse) => {
          this.finishUpload();
          this.error.set(this.uploadErrorMessage(err));
        },
      });
  }

  /**
   * `status === 0` devolve `null` de propósito: quem avisa "sem conexão" é o
   * `errorInterceptor`, e um banner aqui daria duas mensagens para a mesma
   * falha. 413 usa o teto do cliente para não contradizer a guarda acima.
   */
  private uploadErrorMessage(err: HttpErrorResponse): string | null {
    this.apiErrors.claim(err);
    if (err.status === 0) return null;
    if (err.status === 413) {
      return `O arquivo passou do limite de ${MAX_POLICY_LABEL}. Comprima o PDF e envie de novo.`;
    }
    return this.apiErrors.messageFor(err, 'Não foi possível enviar a apólice.');
  }

  protected cancelUpload(): void {
    if (!this.uploadSub) return;
    // unsubscribe aborta o request no browser (FetchBackend usa AbortController).
    this.uploadSub.unsubscribe();
    this.finishUpload();
    this.notifications.info('Envio cancelado.');
  }

  private finishUpload(): void {
    this.uploading.set(false);
    this.uploadSub = null;
  }

  /**
   * Abre o PDF numa aba nova pela signed URL. A aba é reservada de forma
   * SÍNCRONA dentro do gesto (browsers móveis só permitem `window.open` com o
   * gesto ainda na pilha) e navegada quando a URL chega; se o request falhar a
   * aba é fechada em vez de virar uma aba branca órfã.
   */
  protected openDocument(): void {
    if (this.opening()) return;
    this.error.set(null);
    this.opening.set(true);
    // Sem a cópia própria a aba reservada anuncia o checkout — "Abrindo o
    // pagamento seguro" — para quem só pediu o PDF de uma apólice já emitida.
    const tab = this.externalNavigation.openPendingTab(POLICY_DOCUMENT_PLACEHOLDER_COPY);
    if (tab.blocked) {
      this.opening.set(false);
      this.error.set('Permita pop-ups neste site para abrir a apólice em uma nova aba.');
      return;
    }

    this.insurancesService.policyDocumentSignedUrl(this.insuranceId()).subscribe({
      next: (res) => {
        this.opening.set(false);
        tab.navigate(res.url);
      },
      error: (err: HttpErrorResponse) => {
        this.opening.set(false);
        tab.close();
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível abrir a apólice.'));
      },
    });
  }

  protected askDelete(): void {
    this.deleteOpen.set(true);
  }

  protected closeDelete(): void {
    if (!this.deleting()) this.deleteOpen.set(false);
  }

  protected confirmDelete(): void {
    if (this.deleting()) return;
    this.error.set(null);
    this.deleting.set(true);
    this.insurancesService.deletePolicyDocument(this.insuranceId()).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.document.set(null);
        this.changed.emit(null);
        this.notifications.success('Apólice removida.');
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível remover a apólice.'));
      },
    });
  }
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
