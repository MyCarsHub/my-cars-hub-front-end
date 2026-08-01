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
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../../services/api-error.service';
import { DriverService } from '../../../services/driver.service';
import { LoggerService } from '../../../services/logger.service';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';
import {
  RentalContractSource,
  RentalDocumentDto,
  SignatureStatus,
  SignerRequest,
} from '../../../types/rental.types';
import { RentalService } from '../rental.service';
import { ContractDocxPreviewService } from './contract-docx-preview.service';

interface SignatureBadge {
  label: string;
  chip: string;
}

/**
 * Teto de upload do cliente. O backend aceita 20MB; a divergência é
 * INTENCIONAL — o app é usado majoritariamente em rede móvel, e 10MB é o
 * limite amigável pra franquia de dados. Não subir pra "casar" com o backend.
 */
const MAX_CONTRACT_BYTES = 10 * 1024 * 1024;

/**
 * Assinatura de um PDF (`%PDF-`), a ÚNICA autoridade sobre o formato do arquivo.
 *
 * O `mimeType` da linha MENTE por design do backend: ao receber o webhook do
 * Autentique (`AutentiqueWebhookService`) ele sobrescreve o MESMO objeto `.docx`
 * do storage com o PDF assinado e nunca atualiza `mime_type` — não existe método
 * pra isso. Um contrato AUTO assinado se declara DOCX pra sempre. Decidir pelo
 * MIME jogaria bytes de PDF num parser de DOCX e quebraria justamente o
 * contrato ASSINADO, que é o mais importante de conseguir abrir.
 */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

/**
 * Range que fareja o formato SEM baixar o arquivo. O caminho normal hoje é um
 * PDF anexado à mão (até 10MB) que o browser mesmo renderiza: puxar o corpo
 * inteiro só pra ler 5 bytes e depois deixar a aba baixar tudo de novo custaria
 * o DOBRO da franquia de dados no fluxo mais usado do app. O Supabase Storage
 * honra Range e responde 206; se algum proxy ignorar e responder 200, o corpo
 * que chegou já é o arquivo inteiro e é reaproveitado — nunca um segundo GET.
 */
const SNIFF_RANGE = `bytes=0-${PDF_MAGIC.length - 1}`;

/** `true` quando os primeiros bytes do arquivo são `%PDF-`. */
function isPdfBytes(head: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => head[index] === byte);
}

/**
 * Teto pra renderizar no cliente. Contratos AUTO saem do template com poucas
 * dezenas de KB; acima disto o parse trava (ou derruba por memória) uma aba de
 * celular, e o fallback com o arquivo original é uma resposta melhor que um
 * navegador congelado.
 */
const MAX_RENDER_BYTES = 8 * 1024 * 1024;

/** Watchdog do render. Um `.docx` patológico não pode prender a aba pra sempre. */
const RENDER_TIMEOUT_MS = 30_000;

/** Elemento da aba nova que recebe o documento renderizado. */
const VIEWER_HOST_ID = 'mch-doc';

/** Base comum das páginas escritas na aba nova (self-contained, zero rede). */
const TAB_STYLE =
  'body{margin:0;padding:0;background:#f5f5f5;color:#171717;' +
  'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.55;}' +
  'main{max-width:34rem;margin:0 auto;padding:24px 20px;}' +
  'h1{font-size:1.05rem;margin:0 0 .5rem;}' +
  'p{font-size:.9rem;color:#525252;margin:0 0 .75rem;}' +
  'a.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;' +
  'border-radius:12px;background:#0f766e;color:#fff;font-size:.9rem;font-weight:600;' +
  'text-decoration:none;}a.btn:focus-visible{outline:3px solid #0f766e;outline-offset:2px;}' +
  '.spin{width:26px;height:26px;border-radius:50%;border:3px solid #d4d4d4;' +
  'border-top-color:#0f766e;animation:s .9s linear infinite;margin-bottom:14px;}' +
  '@keyframes s{to{transform:rotate(360deg);}}' +
  '@media (prefers-reduced-motion:reduce){.spin{animation:none;}}' +
  '@media (prefers-color-scheme:dark){body{background:#171717;color:#fafafa;}' +
  'p{color:#a3a3a3;}}';

/** Moldura do documento renderizado: barra de contexto + páginas do Word. */
const VIEWER_STYLE =
  '.mch-note{margin:0;padding:10px 16px;background:#fff;color:#404040;' +
  'border-bottom:1px solid #e5e5e5;font-size:.8rem;text-align:center;}' +
  '.docx-wrapper{background:transparent!important;padding:16px 8px!important;}' +
  '.docx{background:#fff!important;margin:0 auto 16px;box-shadow:0 2px 8px rgba(0,0,0,.08);}';

/**
 * Conteúdo imediato da aba enquanto o arquivo é baixado. A aba precisa ser
 * aberta de forma síncrona (pop-up blocker) mas o download é assíncrono — sem
 * isto o usuário encara uma aba branca por segundos e conclui que travou.
 */
const LOADING_TAB_HTML =
  '<!doctype html><html lang="pt-br"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Carregando contrato…</title><style>' +
  TAB_STYLE +
  '</style></head><body><main role="status" aria-live="polite">' +
  '<div class="spin" aria-hidden="true"></div>' +
  '<h1>Carregando contrato…</h1>' +
  '<p>Buscando o arquivo do aluguel. Pode levar alguns segundos.</p>' +
  '</main></body></html>';

/**
 * Casca do visualizador de `.docx`.
 *
 * O viewport é fixado na largura de uma página (A4 tem ~794px, Carta ~816px) em
 * vez de `device-width`: assim o celular ENCAIXA a página inteira na tela — como
 * um viewer de PDF faz — em vez de cortar a folha e exigir scroll horizontal.
 * Desktop ignora a meta e usa a largura real da janela.
 *
 * A nota é curta de propósito: docx-preview reproduz o layout do Word (fontes,
 * alinhamento, tabelas, paginação), então isto NÃO é uma aproximação a ser
 * carimbada com avisos — é uma visualização, e o download continua sendo o
 * arquivo oficial.
 */
const VIEWER_SHELL_HTML =
  '<!doctype html><html lang="pt-br"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=840,initial-scale=1">' +
  '<title>Contrato de locação</title><style>' +
  TAB_STYLE +
  VIEWER_STYLE +
  '</style></head><body>' +
  '<p class="mch-note">Visualização do contrato — o arquivo de ' +
  '“Baixar Contrato” é o documento oficial.</p>' +
  `<div id="${VIEWER_HOST_ID}"></div>` +
  '</body></html>';

/** Escapa texto para interpolação segura em HTML (a signed URL entra num href). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Ponte do caminho PDF, escrita ANTES de navegar a aba pra signed URL.
 *
 * Nem todo browser renderiza PDF inline: Firefox Android, várias WebViews e um
 * `Content-Type` velho no storage transformam a navegação em DOWNLOAD — a aba
 * fica onde estava. Sem esta página ela ficaria parada no "Carregando contrato…"
 * pra sempre, que é pior que uma aba branca porque PARECE que ainda está
 * trabalhando. Aqui ela para numa página que explica e carrega o link do
 * arquivo. Quando o viewer nativo abre, a navegação descarta isto na hora.
 */
function openingPdfTabHtml(originalUrl: string): string {
  return (
    '<!doctype html><html lang="pt-br"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Abrindo o contrato…</title><style>' +
    TAB_STYLE +
    '</style></head><body><main>' +
    '<div role="status" aria-live="polite">' +
    '<div class="spin" aria-hidden="true"></div>' +
    '<h1>Abrindo o contrato…</h1>' +
    '<p>Se o contrato não aparecer, seu navegador provavelmente baixou o ' +
    'arquivo em vez de exibi-lo — procure na pasta de downloads.</p>' +
    '</div>' +
    `<p><a class="btn" href="${escapeHtml(originalUrl)}" download>Baixar contrato</a></p>` +
    '</main></body></html>'
  );
}

/**
 * Página de falha SEM link: usada quando nem a signed URL foi obtida, então não
 * existe arquivo pra oferecer. Escrita ANTES do `close()` de propósito — vários
 * browsers mobile recusam fechar a aba silenciosamente, e o `catch` do close
 * engoliria isso deixando a aba presa no "Carregando contrato…".
 */
const LINKLESS_FAILED_TAB_HTML =
  '<!doctype html><html lang="pt-br"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Falha ao abrir o contrato</title><style>' +
  TAB_STYLE +
  '</style></head><body><main>' +
  '<h1>Não foi possível abrir o contrato</h1>' +
  '<p>Não conseguimos preparar o link do arquivo. Feche esta aba, volte ao ' +
  'aluguel e use "Baixar Contrato".</p>' +
  '</main></body></html>';

/**
 * Página de falha. Substitui o "Carregando…" e sempre oferece o ARQUIVO
 * ORIGINAL — o requisito é nunca deixar a aba morta.
 */
function openFailedTabHtml(originalUrl: string): string {
  return (
    '<!doctype html><html lang="pt-br"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Falha ao exibir o contrato</title><style>' +
    TAB_STYLE +
    '</style></head><body><main>' +
    '<h1>Não foi possível exibir o contrato</h1>' +
    '<p>A visualização falhou neste navegador. Você ainda pode baixar o arquivo ' +
    'original — ele é o documento oficial.</p>' +
    `<p><a class="btn" href="${escapeHtml(originalUrl)}" download>Baixar contrato</a></p>` +
    '<p>Se o download falhar, o link temporário pode ter expirado: volte ao aluguel ' +
    'e use "Baixar Contrato".</p>' +
    '</main></body></html>'
  );
}

/**
 * Card do contrato. Fetches CONTRACT + status de assinatura. Fluxo de assinatura
 * (Autentique) via modal com signatários; polling a cada 30s quando PENDING.
 */
@Component({
  selector: 'app-rental-contract-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [FormsModule, PageCard, ConfirmDialog, AlertBanner],
  template: `
    <app-page-card title="Contrato">
      <div class="p-4 sm:p-6 space-y-4">
        @if (error(); as cardError) {
          <app-alert-banner variant="error" [message]="cardError" />
        }
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
                  <!-- Sem extensão de propósito: o mimeType da linha mente pra
                       contrato AUTO assinado (vira PDF sem o backend atualizar o
                       MIME), e o formato REAL só é conhecido depois de ler os
                       bytes — tarde demais pra rotular o card. -->
                  <p class="text-sm font-semibold text-neutral-900 truncate">Contrato</p>
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
            <div class="flex flex-col sm:flex-row flex-wrap gap-2 shrink-0">
              <button type="button" (click)="downloadContract()" [disabled]="downloading()"
                class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold shadow-sm transition-colors min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                @if (downloading()) { Baixando… } @else { Baixar Contrato }
              </button>
              <button type="button" (click)="openContract()" [disabled]="opening()"
                class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold shadow-sm transition-colors min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                @if (opening()) { Abrindo… } @else { Abrir contrato }
              </button>
              <button type="button" (click)="askDelete()"
                class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-sm font-medium transition-colors min-h-[44px]"
              >
                Remover
              </button>
            </div>
          </div>

          <!-- Wrapper condicional: dentro da coluna space-y-4, uma div vazia
               ainda conta como filho e deixa um gap fantasma acima do aviso. -->
          @if (canRequestSignature() || canMarkSigned()) {
            <div class="flex flex-col sm:flex-row gap-2">
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
              @if (canMarkSigned()) {
                <button type="button" (click)="askMarkSigned()" [disabled]="markingSigned()"
                  class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-700 hover:bg-primary-800 text-white text-sm font-semibold shadow-sm transition-colors min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Já Assinado
                </button>
              }
            </div>
          }

          @if (signatureStatus() === 'PENDING') {
            <p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              Aguardando signatários assinarem.
            </p>
          }

          @if (uploading()) {
            <div class="rounded-xl border border-primary-200 bg-primary-50/60 p-3 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs text-primary-800 font-medium">Enviando contrato…</p>
                <button type="button" (click)="cancelUpload()"
                  class="text-xs text-neutral-600 hover:text-rose-600 font-medium min-h-[44px] px-3">
                  Cancelar
                </button>
              </div>
              <div class="h-1.5 rounded-full bg-primary-100 overflow-hidden"
                   role="progressbar" aria-label="Enviando contrato">
                <div class="h-full w-1/3 rounded-full bg-primary-500 indeterminate-bar"></div>
              </div>
            </div>
          } @else {
            <button type="button" (click)="picker.click()"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-neutral-300 hover:border-primary-400 text-sm font-medium text-neutral-600 hover:text-primary-700 transition-colors min-h-[48px]">
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
                  <p class="text-xs text-primary-800 font-medium">Enviando contrato…</p>
                  <button type="button" (click)="cancelUpload()"
                    class="text-xs text-neutral-600 hover:text-rose-600 font-medium min-h-[44px] px-3">
                    Cancelar
                  </button>
                </div>
                <div class="h-1.5 rounded-full bg-primary-100 overflow-hidden"
                     role="progressbar" aria-label="Enviando contrato">
                  <div class="h-full w-1/3 rounded-full bg-primary-500 indeterminate-bar"></div>
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

    <app-confirm-dialog
      [open]="markSignedOpen()"
      title="Marcar contrato como assinado?"
      message="Use apenas se o contrato em papel já foi assinado por todas as partes. O contrato passa direto para ASSINADO, sem assinatura eletrônica. A ação registra quem marcou e quando, e não pode ser desfeita."
      confirmLabel="Marcar como assinado"
      variant="warning"
      (confirmed)="confirmMarkSigned()"
      (cancelled)="closeMarkSigned()"
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
                  <div>
                    <label class="sr-only" [attr.for]="'signer-' + i + '-name'">
                      Nome do signatário {{ i + 1 }}
                    </label>
                    <input type="text" [(ngModel)]="s.name" [name]="'signer-' + i + '-name'"
                      [id]="'signer-' + i + '-name'"
                      placeholder="Nome do signatário"
                      [attr.aria-invalid]="isNameInvalid(s.name) ? 'true' : null"
                      [attr.aria-describedby]="isNameInvalid(s.name) ? 'signer-' + i + '-name-error' : null"
                      [class]="'w-full px-3 py-2 rounded-lg border text-sm min-h-[44px] ' + (isNameInvalid(s.name) ? 'border-rose-400 bg-rose-50/40' : 'border-neutral-200')" />
                    @if (isNameInvalid(s.name)) {
                      <p class="text-xs text-rose-600 mt-1" [id]="'signer-' + i + '-name-error'" role="alert">
                        Informe o nome do signatário.
                      </p>
                    }
                  </div>
                  <div>
                    <label class="sr-only" [attr.for]="'signer-' + i + '-email'">
                      E-mail do signatário {{ i + 1 }}
                    </label>
                    <input type="email" [(ngModel)]="s.email" [name]="'signer-' + i + '-email'"
                      [id]="'signer-' + i + '-email'"
                      placeholder="email@exemplo.com"
                      [attr.aria-invalid]="isEmailInvalid(s.email) ? 'true' : null"
                      [attr.aria-describedby]="isEmailInvalid(s.email) ? 'signer-' + i + '-email-error' : null"
                      [class]="'w-full px-3 py-2 rounded-lg border text-sm min-h-[44px] ' + (isEmailInvalid(s.email) ? 'border-rose-400 bg-rose-50/40' : 'border-neutral-200')" />
                    @if (isEmailInvalid(s.email)) {
                      <p class="text-xs text-rose-600 mt-1" [id]="'signer-' + i + '-email-error'" role="alert">
                        Informe um e-mail válido (ex.: nome@empresa.com.br).
                      </p>
                    }
                  </div>
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
                class="w-full py-2 rounded-lg border border-dashed border-neutral-300 hover:border-primary-400 text-sm text-neutral-600 hover:text-primary-700 min-h-[44px]">
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
  // Tailwind não tem token de barra indeterminada; keyframe local (encapsulado
  // pelo Angular) é o mínimo necessário. Respeita prefers-reduced-motion.
  styles: `
    .indeterminate-bar {
      animation: contract-upload-indeterminate 1.2s ease-in-out infinite;
    }
    @keyframes contract-upload-indeterminate {
      0% { transform: translateX(-110%); }
      100% { transform: translateX(310%); }
    }
    /* Sem animação a barra vira estática: largura PARCIAL de propósito —
       100% leria como "concluído" num upload que ainda está em andamento. */
    @media (prefers-reduced-motion: reduce) {
      .indeterminate-bar {
        animation: none;
        width: 40%;
        opacity: 0.7;
      }
    }
  `,
})
export class RentalContractCard implements OnInit, OnDestroy {
  private readonly rentalService = inject(RentalService);
  private readonly driverService = inject(DriverService);
  private readonly session = inject(SessionService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly logger = inject(LoggerService);
  private readonly docxPreview = inject(ContractDocxPreviewService);

  readonly rentalId = input.required<string>();
  /**
   * Origem do contrato do rental. `null` = ainda não carregado ou rental antigo;
   * nesse caso o botão "Já Assinado" fica oculto (fail-closed — o backend também
   * recusa marcar contrato AUTO como assinado manualmente).
   */
  readonly contractSource = input<RentalContractSource | null>(null);
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

  /**
   * Falha da operacao (upload, download, abrir, remover, assinatura). Banner
   * inline dentro do card, nunca toast: o interceptor nao toasta 4xx e
   * `messageFor()` reivindica o erro, desarmando o safety net.
   */
  protected readonly error = signal<string | null>(null);

  protected readonly uploading = signal(false);
  private uploadSub: Subscription | null = null;
  protected readonly downloading = signal(false);
  protected readonly opening = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);
  protected readonly markSignedOpen = signal(false);
  protected readonly markingSigned = signal(false);

  protected readonly signatureModalOpen = signal(false);
  protected readonly requesting = signal(false);
  protected readonly prefilling = signal(false);
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

  /**
   * "Já Assinado" só faz sentido para contrato MANUAL com PDF anexado e sem
   * assinatura eletrônica ativa. Reusa `canRequestSignature()` de propósito: os
   * dois botões compartilham a MESMA janela de status (NOT_REQUIRED/REFUSED/
   * EXPIRED), então ao virar SIGNED (ou PENDING) ambos somem sozinhos — não há
   * lógica extra de esconder/desabilitar em lugar nenhum.
   */
  protected readonly canMarkSigned = computed(
    () => this.contractSource() === 'MANUAL' && this.canRequestSignature() && !!this.contract(),
  );

  protected canSubmit(): boolean {
    return this.signers().every((s) => s.name.trim().length > 0 && /.+@.+\..+/.test(s.email.trim()));
  }

  /** True quando o campo está vazio ou não bate com o formato básico de email. */
  protected isEmailInvalid(email: string): boolean {
    return !/.+@.+\..+/.test(email.trim());
  }

  /** True quando o nome do signatário está vazio — espelha o guard de `canSubmit`. */
  protected isNameInvalid(name: string): boolean {
    return name.trim().length === 0;
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

    // Guardas client-side: falham ANTES de qualquer request — nada de gastar
    // dados móveis num upload que o backend rejeitaria. Vão pro banner inline
    // (regra do AlertBanner: erro de negócio nunca em toast).
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      this.error.set('Formato não suportado. Selecione um arquivo PDF.');
      return;
    }
    if (file.size > MAX_CONTRACT_BYTES) {
      this.error.set(
        `O arquivo tem ${this.formatSize(file.size)} e o limite é 10MB. ` +
          'Comprima o PDF (ou reduza a qualidade do scan) e envie de novo.',
      );
      return;
    }

    this.error.set(null);
    this.uploading.set(true);
    this.uploadSub = this.rentalService
      .uploadContractWithProgress(this.rentalId(), file)
      .subscribe({
        // O app usa `withFetch()` e o FetchBackend só emite `Sent` e
        // `DownloadProgress` — `UploadProgress` NUNCA chega. Por isso não há
        // percentual aqui e a barra do template é indeterminada; trocar o
        // backend pra XHR só por causa disso seria desproporcional.
        next: (event) => {
          if (event.type === HttpEventType.Response && event.body) {
            this.finishUpload();
            this.notifications.push('success', 'Contrato enviado.');
            this.rentalService.refreshRentalState(this.rentalId());
            this.changed.emit();
          }
        },
        error: (err: HttpErrorResponse) => {
          this.finishUpload();
          this.error.set(this.uploadErrorMessage(err));
        },
      });
  }

  /**
   * Copy amigável pras falhas de upload que o usuário consegue agir em cima:
   * - status 0 → retorna `null` de propósito: quem toasta rede fora é o
   *   `errorInterceptor` ("Sem conexão com o servidor."). Um banner inline aqui
   *   daria DUAS mensagens pra mesma falha.
   * - 413 → o payload estourou o limite; usamos o teto de 10MB do cliente e não
   *   a mensagem do backend, que fala em 20MB e contradiria a guarda acima.
   * Qualquer outro status segue o contrato normal de `messageFor()`.
   * `claim()` mantém o safety-net do interceptor desarmado para 4xx.
   */
  private uploadErrorMessage(err: HttpErrorResponse): string | null {
    this.apiErrors.claim(err);
    if (err.status === 0) {
      return null;
    }
    if (err.status === 413) {
      return 'O arquivo passou do limite de 10MB. Comprima o PDF e envie de novo.';
    }
    return this.apiErrors.messageFor(err, 'Não foi possível enviar o contrato.');
  }

  protected cancelUpload(): void {
    if (this.uploadSub) {
      // unsubscribe aborta o request no browser (FetchBackend usa AbortController).
      this.uploadSub.unsubscribe();
      this.uploadSub = null;
      this.finishUpload();
      this.notifications.push('info', 'Envio cancelado.');
    }
  }

  private finishUpload(): void {
    this.uploading.set(false);
    this.uploadSub = null;
  }

  /**
   * Baixa o arquivo ORIGINAL do contrato, byte a byte, seja ele PDF (upload
   * manual / assinado no Autentique) ou DOCX (gerado pelo template). Este é o
   * caminho que entrega o documento OFICIAL — nada aqui passa por renderizador.
   *
   * A signed URL do Supabase é de curta duração (TTL do backend) e privada;
   * usamos `fetch` → Blob → anchor pra forçar o download com filename amigável
   * em vez de deixar o browser navegar pra URL (o que abriria o viewer inline
   * em vez de baixar).
   */
  protected downloadContract(): void {
    const doc = this.contract();
    if (!doc || this.downloading()) return;
    this.error.set(null);
    this.downloading.set(true);
    this.rentalService.documentSignedUrl(this.rentalId(), doc.id).subscribe({
      next: async (res) => {
        try {
          const resp = await fetch(res.url);
          if (!resp.ok) {
            if (resp.status === 404) {
              this.error.set('Contrato não encontrado. Faça upload novamente.');
              return;
            }
            throw new Error(`HTTP ${resp.status}`);
          }
          const blob = await resp.blob();
          if (blob.size === 0) {
            this.error.set('Contrato não encontrado. Faça upload novamente.');
            return;
          }
          // A extensão vem dos BYTES, nunca do `mimeType` da linha (que mente
          // pra contrato AUTO assinado — ver {@link PDF_MAGIC}). Fixar `.pdf`
          // salvava o contrato AUTO (um .docx) com nome .pdf e o Windows não
          // abria; confiar no MIME salvaria o contrato ASSINADO (um PDF de
          // verdade) como .docx, com o mesmo sintoma invertido.
          const head = new Uint8Array(await blob.slice(0, PDF_MAGIC.length).arrayBuffer());
          const filename = `Contrato-${this.rentalId()}.${isPdfBytes(head) ? 'pdf' : 'docx'}`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
          this.error.set('Falha ao baixar o contrato.');
          this.logger.error('[rental-contract-card] download failed', err, {
            rentalId: this.rentalId(),
          });
        } finally {
          this.downloading.set(false);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.downloading.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível baixar o contrato.'));
      },
    });
  }

  /**
   * Abre o contrato em nova aba. O formato é decidido pelos BYTES, nunca pelo
   * `mimeType` da linha — ver {@link PDF_MAGIC} pro porquê. Dois caminhos:
   *
   * - bytes começam com `%PDF-` (upload manual, ou AUTO já assinado no
   *   Autentique, que sobrescreve o mesmo `.docx` do storage com um PDF de
   *   verdade): navega a aba pra própria signed URL e deixa o viewer nativo
   *   renderizar. Fidelidade total, renderizador nem carregado.
   * - qualquer outra coisa → trata como `.docx` (contrato AUTO recém-gerado):
   *   nenhum browser renderiza DOCX inline — `window.open` caía em download e
   *   deixava a aba branca órfã. Aqui o arquivo é renderizado NA ABA por
   *   docx-preview, que reproduz o layout do Word.
   *
   * A aba é aberta SÍNCRONA nos dois casos pra escapar do pop-up blocker
   * (browsers só permitem `window.open` dentro do gesture handler) e recebe na
   * hora o documento "Carregando contrato…" — o download é assíncrono e uma
   * aba branca parada lê como travamento.
   */
  protected openContract(): void {
    const doc = this.contract();
    if (!doc || this.opening()) return;
    this.error.set(null);
    this.opening.set(true);
    const win = window.open('', '_blank');
    if (!win) {
      this.opening.set(false);
      this.error.set('Permita pop-ups pra abrir o contrato.');
      return;
    }
    this.writeIntoTab(win, LOADING_TAB_HTML);

    this.rentalService.documentSignedUrl(this.rentalId(), doc.id).subscribe({
      next: (res) => void this.showInTab(win, res.url),
      error: (err: HttpErrorResponse) => {
        this.opening.set(false);
        // Mensagem PRIMEIRO, close() depois: se o browser recusar fechar (comum
        // no mobile) a aba fica com a explicação em vez do spinner eterno.
        this.writeIntoTab(win, LINKLESS_FAILED_TAB_HTML);
        try {
          win.close();
        } catch {
          /* noop — algumas policies bloqueiam close cross-context */
        }
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível abrir o contrato.'));
      },
    });
  }

  /**
   * Fareja o formato pela assinatura e entrega a aba.
   *
   * A sonda pede só {@link SNIFF_RANGE} — o formato mora nos 5 primeiros bytes,
   * e o caminho PDF (o normal) navega a aba pra própria URL: baixar o arquivo
   * inteiro aqui faria o usuário pagar os mesmos MB duas vezes. O corpo COMPLETO
   * só é buscado no ramo DOCX, onde o parser precisa dele de verdade — e nem
   * isso quando a resposta veio 200 (Range ignorado), porque aí o arquivo
   * inteiro já está na mão.
   *
   * Qualquer falha — rede, signed URL expirada, arquivo vazio, grande demais,
   * DOCX ilegível, watchdog — troca o conteúdo da aba pela página de erro que
   * oferece o ARQUIVO ORIGINAL. A aba nunca fica branca e morta, que era o
   * sintoma deste fix.
   */
  private async showInTab(win: Window, url: string): Promise<void> {
    try {
      const probe = await fetch(url, { headers: { Range: SNIFF_RANGE } });
      if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
      const probeBytes = await probe.arrayBuffer();
      if (probeBytes.byteLength === 0) throw new Error('Arquivo vazio no storage.');

      // `Math.min` porque um arquivo com menos de 5 bytes estouraria o
      // construtor da view; nesse caso `isPdfBytes` já devolve false.
      const head = new Uint8Array(probeBytes, 0, Math.min(PDF_MAGIC.length, probeBytes.byteLength));
      if (isPdfBytes(head)) {
        // Rede de segurança escrita ANTES da navegação: se o browser baixar em
        // vez de renderizar, a aba PARA aqui, com link e explicação.
        this.writeIntoTab(win, openingPdfTabHtml(url));
        win.location.href = url;
        return;
      }

      // 206 = só a cabeça chegou, o parser precisa do resto. 200 = o servidor
      // ignorou o Range e mandou tudo; refazer o GET seria o desperdício que
      // esta sonda existe pra evitar.
      const source = probe.status === 200 ? probeBytes : await this.fetchFull(url);
      if (source.byteLength > MAX_RENDER_BYTES) {
        throw new Error(`DOCX acima do teto de render (${source.byteLength} bytes).`);
      }

      this.writeIntoTab(win, VIEWER_SHELL_HTML);
      const host = win.document.getElementById(VIEWER_HOST_ID);
      if (!host) throw new Error('Aba do contrato indisponível para render.');
      await this.renderWithWatchdog(source, host);
    } catch (err) {
      this.logger.error('[rental-contract-card] open contract failed', err, {
        rentalId: this.rentalId(),
      });
      this.error.set(
        'Não foi possível exibir o contrato. Use "Baixar Contrato" para abrir o arquivo original.',
      );
      this.writeIntoTab(win, openFailedTabHtml(url));
    } finally {
      this.opening.set(false);
    }
  }

  /** Baixa o arquivo inteiro — só o ramo DOCX, que precisa dos bytes pro parse. */
  private async fetchFull(url: string): Promise<ArrayBuffer> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength === 0) throw new Error('Arquivo vazio no storage.');
    return buffer;
  }

  /**
   * Render com watchdog. Cobre as travas que ESPERAM — um `import()` de
   * docx-preview que nunca resolve, I/O pendurado: aí o prazo estoura, a promise
   * rejeita e o `catch` de {@link showInTab} entrega a página com o arquivo
   * original. Não cobre CPU: o parse roda majoritariamente síncrono no event
   * loop do opener (pop-up same-origin compartilha a thread), então um arquivo
   * patológico bloquearia o próprio `setTimeout` — a defesa contra esse caso é
   * {@link MAX_RENDER_BYTES}, que barra o arquivo antes do parser. O render não
   * é cancelável — se terminar depois, escreve num host já descartado pelo
   * `document.open()` da página de erro.
   */
  private async renderWithWatchdog(source: ArrayBuffer, host: HTMLElement): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Render do contrato excedeu o tempo limite.')),
        RENDER_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([this.docxPreview.render(source, host), watchdog]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Escreve um documento inteiro na aba já aberta. `open()` explícito porque
   * cada página substitui a anterior ("Carregando…" → visualizador ou erro) —
   * sem ele o `write` concatenaria as duas. Falha silenciosa de propósito: se o
   * usuário já fechou a aba, isso não é um erro que ele precise ver.
   */
  private writeIntoTab(win: Window, html: string): void {
    try {
      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch {
      /* noop — aba fechada pelo usuário ou bloqueada por policy */
    }
  }

  protected askDelete(): void { this.deleteOpen.set(true); }
  protected closeDelete(): void { if (!this.deleting()) this.deleteOpen.set(false); }
  protected confirmDelete(): void {
    const doc = this.contract();
    if (!doc) return;
    this.error.set(null);
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
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível remover o contrato.'));
      },
    });
  }

  protected askMarkSigned(): void {
    this.markSignedOpen.set(true);
  }

  protected closeMarkSigned(): void {
    if (!this.markingSigned()) this.markSignedOpen.set(false);
  }

  /**
   * Marca o contrato em papel como assinado. Sem toast de sucesso próprio: o
   * effect() de transição de status já toasta quando o signal compartilhado vira
   * SIGNED — um push aqui duplicaria a notificação.
   *
   * O POST já devolve o DTO final (status=SIGNED / provider=MANUAL), então ele é
   * gravado DIRETO no snapshot compartilhado. Um GET de confirmação seria um
   * segundo round-trip na mesma rede móvel instável que motivou este fluxo: se
   * ele morresse, o write teria commitado no backend e a UI continuaria em
   * NOT_REQUIRED com os dois botões visíveis — o operador tocaria de novo e
   * levaria um 409 incompreensível. O GET fica só como fallback pro caso do
   * snapshot ainda não ter hidratado.
   * Erros (todos 4xx de negócio) vão pro banner inline via `messageFor()`.
   */
  protected confirmMarkSigned(): void {
    if (this.markingSigned()) return;
    this.error.set(null);
    this.markingSigned.set(true);
    this.rentalService.markContractSigned(this.rentalId()).subscribe({
      next: (signature) => {
        this.markingSigned.set(false);
        this.markSignedOpen.set(false);
        const applied =
          signature != null &&
          this.rentalService.applyContractSignature(this.rentalId(), signature);
        if (!applied) {
          this.rentalService.refreshContractSignature(this.rentalId());
        }
      },
      error: (err: HttpErrorResponse) => {
        this.markingSigned.set(false);
        this.markSignedOpen.set(false);
        this.error.set(
          this.apiErrors.messageFor(err, 'Não foi possível marcar o contrato como assinado.'),
        );
      },
    });
  }

  protected openSignatureModal(): void {
    // Seed defensively (driver empty + operator from session) so the modal
    // is usable even se o fetch do driver falhar. O fetch abaixo sobrescreve
    // apenas o signer 1 quando resolve.
    this.signers.set(this.buildInitialSigners(null));
    this.signatureModalOpen.set(true);
    this.prefilling.set(true);

    this.rentalService.getById(this.rentalId()).subscribe({
      next: (rental) => {
        if (!rental.driverId) {
          this.prefilling.set(false);
          return;
        }
        this.driverService.getOne(rental.driverId).subscribe({
          next: (driver) => {
            const email = driver.contact?.email?.trim() ?? '';
            this.signers.update((list) => {
              const next = [...list];
              next[0] = { name: driver.name ?? '', email };
              return next;
            });
            this.prefilling.set(false);
          },
          error: () => this.prefilling.set(false),
        });
      },
      error: () => this.prefilling.set(false),
    });
  }

  /**
   * Base seed: signer 1 = driver (preenchido depois pelo fetch, começa vazio),
   * signer 2 = operador logado (owner na maioria dos casos; para PLATFORM_ADMIN
   * operando outra company, é o próprio admin — a assinatura é de quem opera).
   * Owner sem email → não adiciona o signer 2 pra evitar linha inválida.
   */
  private buildInitialSigners(
    driver: { name: string; email: string } | null,
  ): SignerRequest[] {
    const list: SignerRequest[] = [
      { name: driver?.name ?? '', email: driver?.email ?? '' },
    ];
    const ownerName = this.session.getItem('name')?.trim() ?? '';
    const ownerEmail = this.session.getItem('email')?.trim() ?? '';
    if (ownerEmail) {
      list.push({ name: ownerName, email: ownerEmail });
    }
    return list;
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
    this.error.set(null);
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
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível solicitar assinatura.'));
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
}
