import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LoggerService } from '../../../../services/logger.service';
import { ContractAiService } from './contract-ai.service';
import { CONFIRM_OVERWRITE_CODES } from './contract-ai.messages';
import { buildPreviewSrcdoc, sanitizePreviewHtml } from './contract-ai-sanitize';

/**
 * Tela 4 — como fica. DOCX com dados de EXEMPLO renderizado inline por `docx-preview`
 * (import dinâmico, mesmo caminho já usado pela página). Falha no save preserva o rascunho.
 */
@Component({
  selector: 'app-contract-ai-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="space-y-4">
      <p class="text-sm text-neutral-600">
        Assim o contrato fica com dados de exemplo. Na hora de criar um aluguel, eles são trocados
        pelos dados reais.
      </p>

      @if (svc.draft(); as d) {
        @if (d.layoutSimplified) {
          <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Alguns detalhes de formatação (como colunas ou caixas de texto) foram simplificados.
            Confira o resultado antes de salvar.
          </p>
        }
      }

      @if (renderFailed()) {
        <p role="alert" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Não foi possível mostrar a pré-visualização. Você ainda pode voltar e ajustar.
        </p>
      } @else if (loading()) {
        <div class="h-40 rounded-xl bg-neutral-100 animate-pulse" aria-hidden="true"></div>
        <p class="sr-only" role="status">Carregando pré-visualização…</p>
      }

      <!-- sandbox vazio: sem scripts, sem same-origin, sem formulários nem navegação. -->
      <iframe
        #host
        sandbox=""
        referrerpolicy="no-referrer"
        title="Pré-visualização do contrato com dados de exemplo"
        class="h-[60vh] w-full rounded-xl border border-neutral-200 bg-neutral-100"
        [class.hidden]="loading() || renderFailed()"
      ></iframe>

      @if (svc.overwriteCode(); as code) {
        <div role="alertdialog" aria-labelledby="ai-overwrite-title"
          class="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
          <h3 id="ai-overwrite-title" class="text-sm font-semibold text-amber-900">
            Substituir o template atual?
          </h3>
          <p class="text-sm text-amber-900">
            @if (isSinceAnalysis(code)) {
              O template ativo foi alterado depois que a análise começou. Se continuar, ele será
              substituído por este.
            } @else {
              O template ativo mudou agora há pouco. Se continuar, ele será substituído por este.
            }
          </p>
          <div class="flex flex-col sm:flex-row gap-2">
            <button type="button" (click)="svc.save(true)" [disabled]="svc.busy()"
              class="w-full min-h-[48px] rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-[1.2rem] font-bold disabled:opacity-60">
              @if (svc.busy()) { Salvando… } @else { Substituir e salvar }
            </button>
            <button type="button" (click)="svc.cancelOverwrite()" [disabled]="svc.busy()"
              class="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 bg-white">
              Não substituir
            </button>
          </div>
        </div>
      } @else {
        <div class="flex flex-col gap-2">
          <button type="button" (click)="svc.save(false)" [disabled]="svc.busy()"
            class="w-full min-h-[48px] rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-[1.2rem] font-bold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed">
            @if (svc.busy()) { Salvando… } @else { Salvar contrato }
          </button>
          @if (hasDoubts()) {
            <button type="button" (click)="adjust()" [disabled]="svc.busy()"
              class="w-full min-h-[44px] rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              Voltar e ajustar
            </button>
          }
          <button type="button" (click)="svc.showFields.set(true)" [disabled]="svc.busy()"
            class="w-full min-h-[44px] rounded-xl text-sm font-semibold text-primary-700 hover:bg-primary-50">
            Escolher o que entra
          </button>
        </div>
      }
    </div>
  `,
})
export class ContractAiPreview implements OnInit {
  protected readonly svc = inject(ContractAiService);
  private readonly logger = inject(LoggerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = viewChild.required<ElementRef<HTMLIFrameElement>>('host');

  protected readonly loading = signal(true);
  protected readonly renderFailed = signal(false);
  private destroyed = false;

  constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
  }

  ngOnInit(): void {
    this.svc.preview().subscribe({
      next: (blob) => void this.render(blob),
      error: () => {
        this.loading.set(false);
        this.renderFailed.set(true);
      },
    });
  }

  private async render(blob: Blob): Promise<void> {
    try {
      const { renderAsync } = await import('docx-preview');
      if (this.destroyed) return;
      // Contêiner INERTE (documento sem navegador): nada carrega nem executa aqui.
      const inert = document.implementation.createHTMLDocument('').createElement('div');
      await renderAsync(blob, inert, undefined, {
        className: 'docx',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        useBase64URL: true,
        renderAltChunks: false,
        debug: false,
      });
      if (this.destroyed) return;
      this.host().nativeElement.srcdoc = buildPreviewSrcdoc(sanitizePreviewHtml(inert.innerHTML));
    } catch (err) {
      // Só a falha do render; nunca o conteúdo do contrato.
      this.logger.error('contract ai preview render failed', err);
      this.renderFailed.set(true);
    } finally {
      if (!this.destroyed) this.loading.set(false);
    }
  }

  protected isSinceAnalysis(code: string): boolean {
    return CONFIRM_OVERWRITE_CODES.includes(code) && code.endsWith('SINCE_ANALYSIS');
  }

  /** Volta a responder as dúvidas: reabre a análise sem perder as respostas dadas. */
  protected adjust(): void {
    this.svc.reviewDoubts.set(true);
  }

  protected hasDoubts(): boolean {
    return (this.svc.draft()?.doubts.length ?? 0) > 0;
  }
}
