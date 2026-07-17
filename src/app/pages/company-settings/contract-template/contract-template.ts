import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { NotificationService } from '../../../services/notification.service';
import { ContractTemplateDto, ContractTemplateService } from './contract-template-service';

/**
 * Configurações → Contratos. Locadora sobe UM DOCX com placeholders
 * {{driverName}} etc. Ao criar aluguel, o backend usa esse template
 * pra gerar o contrato preenchido automaticamente. Mobile-first.
 */
@Component({
  selector: 'app-contract-template',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [DefaultPageLayout, PageCard, ConfirmDialog],
  template: `
    <app-default-page-layout
      title="Template de contrato"
      description="Configure uma vez e o contrato é gerado automaticamente em cada novo aluguel."
    >
      <div class="space-y-4 sm:space-y-6">
        <app-page-card title="Como funciona">
          <div class="p-4 sm:p-6 text-sm text-neutral-600 space-y-2">
            <p>
              1. Abra seu contrato no Word e faça <b>Localizar e substituir</b>: troque
              os dados fixos por placeholders como
              <code class="text-xs bg-neutral-100 px-1 rounded">{{ '{{driverName}}' }}</code>,
              <code class="text-xs bg-neutral-100 px-1 rounded">{{ '{{vehiclePlate}}' }}</code>.
            </p>
            <p>2. Salve como .docx e envie aqui.</p>
            <p>3. Ao criar um aluguel, o backend gera o contrato preenchido automaticamente.</p>
            <p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
              <b>Importante:</b> digite cada placeholder de uma vez, sem trocar formatação no meio
              do <code class="text-xs">{{ '{{ }}' }}</code> — caso contrário o Word quebra
              o texto internamente e a substituição falha.
            </p>
          </div>
        </app-page-card>

        <app-page-card title="Template atual">
          <div class="p-4 sm:p-6 space-y-4">
            @if (loading()) {
              <div class="h-16 rounded-xl bg-neutral-100 animate-pulse"></div>
            } @else if (template(); as t) {
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3">
                <div class="min-w-0 flex items-center gap-3">
                  <span class="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 shrink-0" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </span>
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-neutral-900 truncate">{{ t.filename }}</p>
                    <p class="text-xs text-neutral-500 tabular-nums">
                      {{ formatSize(t.sizeBytes) }} · Atualizado {{ formatDate(t.uploadedAt) }}
                    </p>
                  </div>
                </div>
                <div class="flex flex-col sm:flex-row gap-2 shrink-0">
                  <button type="button" (click)="picker.click()" [disabled]="uploading()"
                    class="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold shadow-sm min-h-[44px] disabled:opacity-60">
                    Substituir
                  </button>
                  <button type="button" (click)="askDelete()"
                    class="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-sm font-medium min-h-[44px]">
                    Remover
                  </button>
                </div>
              </div>
            } @else {
              <button type="button" (click)="picker.click()" [disabled]="uploading()"
                class="w-full inline-flex items-center justify-center gap-2 px-4 py-6 sm:py-8 rounded-xl border-2 border-dashed border-neutral-300 hover:border-primary-400 text-sm font-medium text-neutral-600 hover:text-primary-600 transition-colors min-h-[80px] disabled:opacity-60">
                @if (uploading()) { Enviando… } @else { Enviar template .docx }
              </button>
            }

            <input #picker type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              hidden (change)="onFileSelected($event)" />
          </div>
        </app-page-card>

        <app-page-card title="Precisa de ajuda pra montar o contrato?">
          <div class="p-4 sm:p-6 space-y-3 text-sm">
            <p class="text-neutral-600">
              Não sabe por onde começar? Baixe um contrato de locação exemplo com todos
              os placeholders prontos — cole no Word, ajuste e salve como .docx. Ou peça
              pra IA (ChatGPT / Claude / Gemini) refinar o texto pra você.
            </p>
            <button type="button" (click)="downloadExample()" [disabled]="exampleLoading()"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold shadow-sm min-h-[44px] disabled:opacity-60">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <polyline points="9 15 12 18 15 15"/>
              </svg>
              @if (exampleLoading()) { Baixando… } @else { Baixar contrato exemplo (.md) }
            </button>
            <div class="flex flex-col sm:flex-row gap-2">
              <button type="button" (click)="copyAiInstructions()" [disabled]="aiLoading()"
                class="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold shadow-sm min-h-[44px] disabled:opacity-60">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                @if (aiLoading()) { Carregando… } @else { Copiar instruções para IA }
              </button>
              <button type="button" (click)="downloadAiInstructions()" [disabled]="aiLoading()"
                class="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-primary-200 hover:bg-primary-50 text-primary-700 text-sm font-semibold min-h-[44px] disabled:opacity-60">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download .md para IA
              </button>
            </div>
          </div>
        </app-page-card>

        <app-page-card title="Placeholders">
          <div class="p-4 sm:p-6 space-y-4 text-sm">
            @if (template(); as t) {
              @if (missingRequired().length > 0) {
                <div class="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p class="font-semibold text-amber-900 mb-1">
                    Placeholders no template que o backend não reconhece:
                  </p>
                  <div class="flex flex-wrap gap-1">
                    @for (v of missingRequired(); track v) {
                      <code class="text-xs bg-amber-100 text-amber-900 px-2 py-0.5 rounded">
                        {{ '{{' }}{{ v }}{{ '}}' }}
                      </code>
                    }
                  </div>
                  <p class="text-xs text-amber-700 mt-2">
                    Estes serão deixados literais no contrato final. Renomeie ou remova.
                  </p>
                </div>
              }

              <div>
                <p class="font-semibold text-neutral-800 mb-2">Detectados no seu template:</p>
                @if (t.detectedPlaceholders.length > 0) {
                  <div class="flex flex-wrap gap-1">
                    @for (v of t.detectedPlaceholders; track v) {
                      <code class="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                        {{ '{{' }}{{ v }}{{ '}}' }}
                      </code>
                    }
                  </div>
                } @else {
                  <p class="text-neutral-500 text-xs">Nenhum placeholder detectado.</p>
                }
              </div>
            }

            <div class="space-y-3">
              <p class="font-semibold text-neutral-800">Variáveis suportadas ({{ supportedVars().length }}):</p>
              @for (group of groupedVars(); track group.label) {
                <div>
                  <p class="text-xs uppercase tracking-wide text-neutral-500 font-semibold mb-1.5">
                    {{ group.label }}
                  </p>
                  <div class="flex flex-wrap gap-1">
                    @for (v of group.vars; track v) {
                      <code class="text-xs bg-neutral-100 text-neutral-700 px-2 py-0.5 rounded">
                        {{ '{{' }}{{ v }}{{ '}}' }}
                      </code>
                    }
                  </div>
                </div>
              }
              <p class="text-xs text-neutral-500">
                Copie qualquer uma acima e cole no seu contrato Word.
              </p>
            </div>
          </div>
        </app-page-card>
      </div>
    </app-default-page-layout>

    <app-confirm-dialog
      [open]="deleteOpen()"
      title="Remover template?"
      message="O template será apagado e novos aluguéis voltarão a exigir upload manual do contrato."
      confirmLabel="Remover"
      variant="danger"
      (confirmed)="confirmDelete()"
      (cancelled)="closeDelete()"
    />
  `,
})
export class ContractTemplate implements OnInit {
  private readonly service = inject(ContractTemplateService);
  private readonly notifications = inject(NotificationService);

  private static readonly DEFAULT_SUPPORTED = [
    'companyName', 'companyCnpj',
    'driverName', 'driverCpf', 'driverEmail', 'driverPhone',
    'driverLicense', 'driverLicenseCategory', 'driverLicenseExpiry',
    'driverAddress', 'driverCep',
    'vehiclePlate', 'vehicleBrand', 'vehicleModel', 'vehicleYear',
    'vehicleColor', 'vehicleChassi', 'vehicleRenavam', 'vehicleMileage',
    'rentalId', 'contractDate',
    'startDate', 'endDate', 'totalAmount', 'caucaoAmount', 'periodRate', 'billingFrequency',
    'initialKm', 'pickupDate', 'firstPaymentDate', 'dailyInterest', 'lateFine',
  ];

  protected readonly template = signal<ContractTemplateDto | null>(null);
  protected readonly loading = signal(false);
  protected readonly uploading = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);
  protected readonly aiLoading = signal(false);
  protected readonly exampleLoading = signal(false);

  protected readonly supportedVars = computed(
    () => this.template()?.supportedVariables ?? ContractTemplate.DEFAULT_SUPPORTED,
  );

  /**
   * Agrupa as variáveis por prefixo pra render em seções no UI —
   * facilita achar o placeholder certo entre 30+ opções.
   */
  protected readonly groupedVars = computed<{ label: string; vars: string[] }[]>(() => {
    const all = this.supportedVars();
    const groups = [
      { label: 'Locadora', prefix: 'company' },
      { label: 'Motorista', prefix: 'driver' },
      { label: 'Veículo', prefix: 'vehicle' },
    ];
    const grouped = groups.map((g) => ({
      label: g.label,
      vars: all.filter((v) => v.startsWith(g.prefix)),
    }));
    const known = new Set(grouped.flatMap((g) => g.vars));
    const rest = all.filter((v) => !known.has(v));
    if (rest.length > 0) grouped.push({ label: 'Contrato / Aluguel', vars: rest });
    return grouped.filter((g) => g.vars.length > 0);
  });

  protected readonly missingRequired = computed(() => {
    const t = this.template();
    if (!t) return [];
    const supported = new Set(t.supportedVariables);
    return t.detectedPlaceholders.filter((v) => !supported.has(v));
  });

  ngOnInit(): void {
    this.reload();
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      this.notifications.push('error', 'Envie um arquivo .docx do Word.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.notifications.push('error', 'Template excede 5MB.');
      return;
    }
    this.uploading.set(true);
    this.service.upload(file).subscribe({
      next: (tpl) => {
        this.uploading.set(false);
        this.template.set(tpl);
        this.notifications.push('success', 'Template salvo.');
      },
      error: (err: HttpErrorResponse) => {
        this.uploading.set(false);
        this.notifications.push('error', this.extractError(err, 'Falha ao enviar template.'));
      },
    });
  }

  protected askDelete(): void { this.deleteOpen.set(true); }
  protected closeDelete(): void { if (!this.deleting()) this.deleteOpen.set(false); }
  protected confirmDelete(): void {
    this.deleting.set(true);
    this.service.delete().subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.template.set(null);
        this.notifications.push('success', 'Template removido.');
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.notifications.push('error', this.extractError(err, 'Falha ao remover template.'));
      },
    });
  }

  private reload(): void {
    this.loading.set(true);
    this.service.get().subscribe({
      next: (tpl) => {
        this.template.set(tpl);
        this.loading.set(false);
      },
      error: () => {
        this.template.set(null);
        this.loading.set(false);
      },
    });
  }

  protected formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  protected copyAiInstructions(): void {
    if (this.aiLoading()) return;
    this.aiLoading.set(true);
    this.service.aiInstructions().subscribe({
      next: (md) => {
        this.aiLoading.set(false);
        navigator.clipboard.writeText(md).then(
          () => this.notifications.push('success', 'Instruções copiadas — cole no ChatGPT / Claude.'),
          () => this.notifications.push('error', 'Copie manualmente pelo botão de download.'),
        );
      },
      error: (err: HttpErrorResponse) => {
        this.aiLoading.set(false);
        this.notifications.push('error', this.extractError(err, 'Falha ao carregar instruções.'));
      },
    });
  }

  protected downloadAiInstructions(): void {
    if (this.aiLoading()) return;
    this.aiLoading.set(true);
    this.service.aiInstructions().subscribe({
      next: (md) => {
        this.aiLoading.set(false);
        this.saveAsMarkdown(md, 'mycarshub-contrato-instrucoes.md');
      },
      error: (err: HttpErrorResponse) => {
        this.aiLoading.set(false);
        this.notifications.push('error', this.extractError(err, 'Falha ao baixar instruções.'));
      },
    });
  }

  protected downloadExample(): void {
    if (this.exampleLoading()) return;
    this.exampleLoading.set(true);
    this.service.example().subscribe({
      next: (md) => {
        this.exampleLoading.set(false);
        this.saveAsMarkdown(md, 'contrato-exemplo.md');
        this.notifications.push(
          'success',
          'Exemplo baixado — abra no Word e salve como .docx.',
        );
      },
      error: (err: HttpErrorResponse) => {
        this.exampleLoading.set(false);
        this.notifications.push('error', this.extractError(err, 'Falha ao baixar exemplo.'));
      },
    });
  }

  private saveAsMarkdown(md: string, filename: string): void {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') return body.message;
    return fallback;
  }
}
