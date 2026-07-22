import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Subscription } from 'rxjs';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { ExternalNavigationService } from '../../../services/external-navigation.service';
import { NotificationService } from '../../../services/notification.service';
import {
  RentalDocumentDto,
  SignatureStatus,
  SignerRequest,
} from '../../../types/rental.types';
import { RentalService } from '../rental.service';

interface SignatureBadge {
  label: string;
  chip: string;
}

/**
 * Card do contrato. Fetches CONTRACT + status de assinatura. Fluxo de assinatura
 * (Autentique) via modal com signatários; polling a cada 30s quando PENDING.
 */
@Component({
  selector: 'app-rental-contract-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [FormsModule, PageCard, ConfirmDialog],
  template: `
    <app-page-card title="Contrato">
      <div class="p-4 sm:p-6 space-y-4">
        @if (loading()) {
          <div class="h-16 rounded-xl bg-neutral-100 animate-pulse"></div>
        } @else if (contract(); as c) {
          <div
            class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3"
          >
            <div class="min-w-0 flex items-center gap-3">
              <span
                class="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-600 shrink-0"
                aria-hidden="true"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </span>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-semibold text-neutral-900 truncate">contrato.pdf</p>
                  @if (signatureBadge(); as b) {
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                      [class]="b.chip"
                      [attr.aria-label]="'Assinatura: ' + b.label">
                      {{ b.label }}
                    </span>
                  }
                </div>
                <p class="text-xs text-neutral-500 tabular-nums">
                  {{ formatSize(c.sizeBytes) }} · Enviado {{ formatDate(c.createdDate) }}
                </p>
              </div>
            </div>
            <div class="flex flex-col sm:flex-row gap-2 shrink-0">
              <button type="button" (click)="openContract()" [disabled]="opening()"
                class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold shadow-sm transition-colors min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                @if (opening()) { Abrindo… } @else { Abrir PDF }
              </button>
              <button type="button" (click)="askDelete()"
                class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-sm font-medium transition-colors min-h-[44px]"
              >
                Remover
              </button>
            </div>
          </div>

          @if (canRequestSignature()) {
            <button type="button" (click)="openSignatureModal()"
              class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition-colors min-h-[44px]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>
              </svg>
              @if (signatureStatus() === 'REFUSED' || signatureStatus() === 'EXPIRED') {
                Reenviar para assinatura
              } @else {
                Solicitar assinatura
              }
            </button>
          }

          @if (signatureStatus() === 'PENDING') {
            <p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              Aguardando signatários assinarem. Verificando a cada 30 segundos…
            </p>
          }

          @if (uploading()) {
            <div class="rounded-xl border border-primary-200 bg-primary-50/60 p-3 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs text-primary-800 font-medium">
                  Enviando contrato… {{ uploadProgress() ?? 0 }}%
                </p>
                <button type="button" (click)="cancelUpload()"
                  class="text-xs text-neutral-600 hover:text-rose-600 font-medium">
                  Cancelar
                </button>
              </div>
              <div class="h-1.5 rounded-full bg-primary-100 overflow-hidden">
                <div class="h-full bg-primary-500 transition-all"
                     [style.width.%]="uploadProgress() ?? 0"></div>
              </div>
            </div>
          } @else {
            <button type="button" (click)="picker.click()"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-neutral-300 hover:border-primary-400 text-sm font-medium text-neutral-600 hover:text-primary-600 transition-colors min-h-[48px]">
              Substituir contrato
            </button>
          }
        } @else {
          <div class="rounded-xl border-2 border-dashed border-neutral-300 p-6 sm:p-8 text-center space-y-3">
            <p class="text-sm text-neutral-600">
              Nenhum contrato enviado ainda. Anexe o PDF assinado para este aluguel.
            </p>
            @if (uploading()) {
              <div class="rounded-xl bg-primary-50/60 border border-primary-200 p-3 space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs text-primary-800 font-medium">
                    Enviando… {{ uploadProgress() ?? 0 }}%
                  </p>
                  <button type="button" (click)="cancelUpload()"
                    class="text-xs text-neutral-600 hover:text-rose-600 font-medium">
                    Cancelar
                  </button>
                </div>
                <div class="h-1.5 rounded-full bg-primary-100 overflow-hidden">
                  <div class="h-full bg-primary-500 transition-all"
                       [style.width.%]="uploadProgress() ?? 0"></div>
                </div>
              </div>
            } @else {
              <button type="button" (click)="picker.click()"
                class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold shadow-sm transition-colors min-h-[48px]">
                Enviar contrato PDF
              </button>
            }
          </div>
        }

        <input #picker type="file" accept="application/pdf" hidden (change)="onFileSelected($event)" />
      </div>
    </app-page-card>

    <app-confirm-dialog
      [open]="deleteOpen()"
      title="Remover contrato?"
      message="O arquivo será apagado do storage e não poderá ser recuperado. Tem certeza?"
      confirmLabel="Remover"
      variant="danger"
      (confirmed)="confirmDelete()"
      (cancelled)="closeDelete()"
    />

    @if (signatureModalOpen()) {
      <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
        (click)="closeSignatureModal()">
        <div class="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden"
          (click)="$event.stopPropagation()">
          <div class="p-4 sm:p-6 border-b border-neutral-100">
            <h3 class="text-base font-semibold text-neutral-900">Solicitar assinatura eletrônica</h3>
            <p class="text-xs text-neutral-500 mt-1">
              Cada signatário receberá um email do Autentique com link direto para assinar.
            </p>
          </div>
          <div class="p-4 sm:p-6 space-y-3 max-h-[60vh] overflow-y-auto">
            @for (s of signers(); track $index; let i = $index) {
              <div class="flex gap-2 items-start">
                <div class="flex-1 space-y-2">
                  <input type="text" [(ngModel)]="s.name" placeholder="Nome do signatário"
                    class="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm min-h-[44px]" />
                  <input type="email" [(ngModel)]="s.email" placeholder="email@exemplo.com"
                    class="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm min-h-[44px]" />
                </div>
                @if (signers().length > 1) {
                  <button type="button" (click)="removeSigner(i)"
                    class="mt-1 p-2 text-neutral-400 hover:text-rose-600 min-h-[44px] min-w-[44px]"
                    aria-label="Remover signatário">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                }
              </div>
            }
            @if (signers().length < 6) {
              <button type="button" (click)="addSigner()"
                class="w-full py-2 rounded-lg border border-dashed border-neutral-300 hover:border-primary-400 text-sm text-neutral-600 hover:text-primary-600 min-h-[44px]">
                + Adicionar signatário
              </button>
            }
          </div>
          <div class="p-4 sm:p-6 border-t border-neutral-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button type="button" (click)="closeSignatureModal()" [disabled]="requesting()"
              class="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-neutral-200 hover:bg-neutral-50 text-sm font-medium min-h-[44px]">
              Cancelar
            </button>
            <button type="button" (click)="submitSignature()" [disabled]="requesting() || !canSubmit()"
              class="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed">
              @if (requesting()) { Enviando… } @else { Enviar para assinatura }
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class RentalContractCard implements OnInit, OnDestroy {
  private readonly rentalService = inject(RentalService);
  private readonly notifications = inject(NotificationService);
  private readonly externalNav = inject(ExternalNavigationService);

  readonly rentalId = input.required<string>();
  readonly changed = output<void>();

  /** Snapshot compartilhado — evita fetch duplicado com checklist + inspection-card. */
  private readonly snapshot = computed(() => this.rentalService.rentalState(this.rentalId())());

  protected readonly contract = computed<RentalDocumentDto | null>(
    () => this.snapshot()?.documents.find((d) => d.kind === 'CONTRACT') ?? null,
  );
  /** `null` enquanto snapshot inicial não carregou. */
  protected readonly loading = computed(() => this.snapshot() === null);
  protected readonly signatureStatus = computed<SignatureStatus | null>(() => {
    const snap = this.snapshot();
    if (!snap) return null;
    if (!snap.documents.some((d) => d.kind === 'CONTRACT')) return null;
    return snap.contractSignature?.status ?? 'NOT_REQUIRED';
  });

  protected readonly uploading = signal(false);
  /** 0-100 durante upload; nulo quando o browser não reporta total (fallback determinado). */
  protected readonly uploadProgress = signal<number | null>(null);
  private uploadSub: Subscription | null = null;
  protected readonly opening = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);

  protected readonly signatureModalOpen = signal(false);
  protected readonly requesting = signal(false);
  protected readonly signers = signal<SignerRequest[]>([]);

  private pollHandle: ReturnType<typeof setInterval> | null = null;

  protected readonly signatureBadge = computed<SignatureBadge | null>(() => {
    const s = this.signatureStatus();
    if (!s || s === 'NOT_REQUIRED') return null;
    return {
      PENDING: { label: 'Aguardando assinatura', chip: 'bg-amber-100 text-amber-800' },
      SIGNED: { label: 'Assinado', chip: 'bg-emerald-100 text-emerald-800' },
      REFUSED: { label: 'Recusado', chip: 'bg-rose-100 text-rose-800' },
      EXPIRED: { label: 'Expirado', chip: 'bg-neutral-200 text-neutral-700' },
    }[s];
  });

  protected readonly canRequestSignature = computed(() => {
    const s = this.signatureStatus();
    return s === 'NOT_REQUIRED' || s === 'REFUSED' || s === 'EXPIRED';
  });

  protected canSubmit(): boolean {
    return this.signers().every((s) => s.name.trim().length > 0 && /.+@.+\..+/.test(s.email.trim()));
  }

  constructor() {
    // Snapshot é fonte da verdade: quando o status vai pra PENDING (após upload ou
    // solicitação de assinatura), habilita o polling; qualquer outro estado desliga.
    effect(() => {
      const status = this.signatureStatus();
      if (status === 'PENDING') this.startPolling();
      else this.stopPolling();
    });

    // Toast on signature transitions. Decoupled from the poll tick so the toast
    // fires when the shared signal actually updates (async, after the HTTP round-trip),
    // not on the microtask right after `refreshContractSignature` is dispatched.
    // Skip the very first emission to avoid a toast on initial hydration.
    let prev: SignatureStatus | null | undefined = undefined;
    effect(() => {
      const current = this.signatureStatus();
      if (prev === undefined) {
        prev = current;
        return;
      }
      if (current === prev) return;
      prev = current;
      if (current === 'SIGNED') {
        this.notifications.push('success', 'Contrato assinado por todos.');
      } else if (current === 'REFUSED') {
        this.notifications.push('warning', 'Assinatura recusada por um signatário.');
      } else if (current === 'EXPIRED') {
        this.notifications.push('warning', 'Link de assinatura expirou.');
      }
    });
  }

  ngOnInit(): void {
    this.rentalService.loadRentalState(this.rentalId());
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.uploadSub?.unsubscribe();
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      this.notifications.push('error', 'Selecione um arquivo PDF.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.notifications.push('error', 'PDF excede 10MB.');
      return;
    }

    this.uploading.set(true);
    this.uploadProgress.set(0);
    this.uploadSub = this.rentalService
      .uploadContractWithProgress(this.rentalId(), file)
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const pct = event.total
              ? Math.round((event.loaded / event.total) * 100)
              : null;
            this.uploadProgress.set(pct);
          } else if (event.type === HttpEventType.Response && event.body) {
            this.finishUpload();
            this.notifications.push('success', 'Contrato enviado.');
            this.rentalService.refreshRentalState(this.rentalId());
            this.changed.emit();
          }
        },
        error: (err: HttpErrorResponse) => {
          this.finishUpload();
          this.notifications.push('error', this.extractError(err, 'Não foi possível enviar o contrato.'));
        },
      });
  }

  protected cancelUpload(): void {
    if (this.uploadSub) {
      // unsubscribe aborta o request no browser (HttpClient cancela o XHR).
      this.uploadSub.unsubscribe();
      this.uploadSub = null;
      this.finishUpload();
      this.notifications.push('info', 'Envio cancelado.');
    }
  }

  private finishUpload(): void {
    this.uploading.set(false);
    this.uploadProgress.set(null);
    this.uploadSub = null;
  }

  protected openContract(): void {
    const doc = this.contract();
    if (!doc || this.opening()) return;
    this.opening.set(true);
    this.rentalService.documentSignedUrl(this.rentalId(), doc.id).subscribe({
      next: (res) => {
        this.opening.set(false);
        this.externalNav.openExternal(res.url);
      },
      error: (err: HttpErrorResponse) => {
        this.opening.set(false);
        this.notifications.push('error', this.extractError(err, 'Não foi possível abrir o contrato.'));
      },
    });
  }

  protected askDelete(): void { this.deleteOpen.set(true); }
  protected closeDelete(): void { if (!this.deleting()) this.deleteOpen.set(false); }
  protected confirmDelete(): void {
    const doc = this.contract();
    if (!doc) return;
    this.deleting.set(true);
    this.rentalService.deleteDocument(this.rentalId(), doc.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.stopPolling();
        this.notifications.push('success', 'Contrato removido.');
        this.rentalService.refreshRentalState(this.rentalId());
        this.changed.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.notifications.push('error', this.extractError(err, 'Não foi possível remover o contrato.'));
      },
    });
  }

  protected openSignatureModal(): void {
    this.signers.set([{ name: '', email: '' }]);
    this.signatureModalOpen.set(true);
  }
  protected closeSignatureModal(): void {
    if (this.requesting()) return;
    this.signatureModalOpen.set(false);
  }
  protected addSigner(): void {
    this.signers.update((list) => [...list, { name: '', email: '' }]);
  }
  protected removeSigner(index: number): void {
    this.signers.update((list) => list.filter((_, i) => i !== index));
  }

  protected submitSignature(): void {
    if (!this.canSubmit()) return;
    this.requesting.set(true);
    const payload = this.signers().map((s) => ({ name: s.name.trim(), email: s.email.trim() }));
    this.rentalService.requestContractSignature(this.rentalId(), payload).subscribe({
      next: () => {
        this.requesting.set(false);
        this.signatureModalOpen.set(false);
        this.notifications.push('success', 'Solicitação enviada. Signatários receberão email.');
        // Ajusta status compartilhado — effect() ligará o polling automaticamente.
        this.rentalService.refreshContractSignature(this.rentalId());
      },
      error: (err: HttpErrorResponse) => {
        this.requesting.set(false);
        this.notifications.push('error', this.extractError(err, 'Não foi possível solicitar assinatura.'));
      },
    });
  }

  private startPolling(): void {
    if (this.pollHandle != null) return;
    // Apenas dispara refresh a cada 30s; a UX de toast é tratada por um effect()
    // que reage à atualização do signal compartilhado (assíncrona, após o HTTP).
    this.pollHandle = setInterval(() => {
      this.rentalService.refreshContractSignature(this.rentalId());
    }, 30_000);
  }

  private stopPolling(): void {
    if (this.pollHandle != null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  protected formatSize(bytes: number | null): string {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
