import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, throwError } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { SessionService } from '../../../../services/session.service';
import { TenantResetRegistry } from '../../../../services/tenant-reset.registry';
import { ContractTemplateDto } from '../contract-template-service';
import { ContractAiCapability } from './contract-ai-capability';
import {
  CONFIRM_OVERWRITE_CODES,
  FIELD_LABELS,
  errorCode,
  failureMessage,
  httpErrorMessage,
} from './contract-ai.messages';
import {
  DraftDecision,
  DraftDecisionsResponse,
  DraftStatusResponse,
  DraftSubmittedResponse,
  FlowStep,
  MaskedTextResponse,
} from './contract-ai.types';

const BASE = `${environment.apiUrl}/settings/contract-template`;
const STORAGE_KEY = 'contractAiDraftId';
const DECISIONS_KEY = 'contractAiDecisions';

/** Backoff do polling: 1,5 s crescendo 1,5x até 5 s; desiste após ~4 min. */
export const POLL_FIRST_DELAY_MS = 1500;
export const POLL_MAX_DELAY_MS = 5000;
export const POLL_MAX_ATTEMPTS = 60;
const POLL_MAX_NETWORK_FAILURES = 3;

export function pollDelay(attempt: number): number {
  return Math.min(POLL_FIRST_DELAY_MS * Math.pow(1.5, attempt), POLL_MAX_DELAY_MS);
}

/** Ids de sugestao do backend: s0001, s0002... (SuggestionValidator). */
const SUGGESTION_ID_RE = /^s\d{1,6}$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Estado do fluxo de contrato com IA. Só o draftId (UUID, sem dado pessoal) vai para a
 * sessão, para o reload retomar; o texto do contrato nunca é guardado nem logado.
 */
@Injectable({ providedIn: 'root' })
export class ContractAiService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);

  private readonly capability = inject(ContractAiCapability);
  /** true/false quando a capacidade e conhecida; null enquanto desconhecida. */
  readonly enabled = computed<boolean | null>(() => {
    const st = this.capability.state();
    if (st === 'on') return true;
    return st === 'off' || st === 'unavailable' ? false : null;
  });
  readonly draftId = signal<string | null>(null);
  readonly draft = signal<DraftStatusResponse | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly pollTimedOut = signal(false);
  /** Texto mascarado exato exibido na tela de consentimento (nunca persistido). */
  readonly masked = signal<MaskedTextResponse | null>(null);
  readonly maskedLoading = signal(false);
  readonly showFields = signal(false);
  /** "Voltar e ajustar": reabre as dúvidas mesmo com o rascunho já READY. */
  readonly reviewDoubts = signal(false);
  /** Decisões locais por sugestão (PUT sempre manda o conjunto inteiro). */
  readonly decisions = signal<Record<string, DraftDecision>>({});
  /** Preenchido quando o save pede confirmação explícita para substituir o template ativo. */
  readonly overwriteCode = signal<string | null>(null);
  readonly savedTemplate = signal<ContractTemplateDto | null>(null);

  readonly step = computed<FlowStep>(() => {
    if (this.savedTemplate()) return 'saved';
    if (!this.draftId()) return 'intro';
    const d = this.draft();
    if (!d) return 'progress';
    switch (d.status) {
      case 'AWAITING_CONSENT':
        return 'consent';
      case 'ANALYZING':
        return 'progress';
      case 'NEEDS_REVIEW':
        return 'doubts';
      case 'READY':
        if (this.reviewDoubts()) return 'doubts';
        return this.showFields() ? 'fields' : 'preview';
      case 'FAILED':
        return 'failed';
      case 'SAVED':
        return 'saved';
      default:
        return 'expired';
    }
  });

  readonly failureText = computed(() => failureMessage(this.draft()?.failureCode ?? null));

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollSub: Subscription | null = null;
  private initStarted = false;

  constructor() {
    inject(TenantResetRegistry).register(() => this.reset());
  }

  reset(): void {
    this.stopPolling();
    this.initStarted = false;
    this.clearDraft();
    this.savedTemplate.set(null);
  }

  /** Pede a capacidade (cache em memoria) e, estando ligada, retoma o rascunho da sessao. */
  init(): void {
    if (this.initStarted) return;
    this.initStarted = true;
    this.capability.load((on) => {
      if (on) this.resume();
    });
  }

  private resume(): void {
    const stored = this.session.getItem(STORAGE_KEY);
    if (stored && UUID_RE.test(stored)) {
      this.draftId.set(stored);
      this.restoreDecisions();
      this.startPolling();
    } else if (stored) {
      this.session.removeItem(STORAGE_KEY);
    }
  }

  submit(file: File): void {
    if (this.busy()) return;
    this.error.set(null);
    this.busy.set(true);
    const form = new FormData();
    form.append('file', file);
    this.http.post<DraftSubmittedResponse>(`${BASE}/drafts`, form).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.draftId.set(res.draftId);
        this.session.setItem(STORAGE_KEY, res.draftId);
        this.decisions.set({});
        this.masked.set(null);
        this.pollTimedOut.set(false);
        this.stopPolling();
        // O upload só cria o rascunho: a análise aguarda o consentimento.
        this.draft.set({
          draftId: res.draftId,
          status: res.status,
          failureCode: null,
          filename: null,
          layoutSimplified: false,
          certain: [],
          doubts: [],
        });
        if (res.status === 'ANALYZING') this.startPolling();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(
          httpErrorMessage(err, 'Não foi possível enviar o arquivo. Tente de novo.'),
        );
      },
    });
  }

  /** Idempotente: se já há polling em curso, não abre outro. */
  startPolling(): void {
    if (this.pollTimer !== null || (this.pollSub !== null && !this.pollSub.closed)) return;
    const id = this.draftId();
    if (!id) return;
    this.pollTimedOut.set(false);
    let attempt = 0;
    let failures = 0;
    const tick = (): void => {
      this.pollTimer = null;
      this.pollSub = this.fetchStatus(id).subscribe({
        next: (d) => {
          failures = 0;
          this.applyDraft(d);
          if (d.status !== 'ANALYZING') return;
          attempt += 1;
          if (attempt >= POLL_MAX_ATTEMPTS) {
            this.pollTimedOut.set(true);
            return;
          }
          this.pollTimer = setTimeout(tick, pollDelay(attempt));
        },
        error: (err: HttpErrorResponse) => {
          if (err.status === 404) {
            this.clearDraft();
            this.error.set('Esta análise não existe mais. Envie o arquivo de novo.');
            return;
          }
          failures += 1;
          if (failures >= POLL_MAX_NETWORK_FAILURES) {
            this.error.set(httpErrorMessage(err, 'Não foi possível acompanhar a análise.'));
            this.pollTimedOut.set(true);
            return;
          }
          this.pollTimer = setTimeout(tick, pollDelay(failures));
        },
      });
    };
    tick();
  }

  stopPolling(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  /** Recarrega o rascunho uma vez (sem polling). */
  refresh(): void {
    const id = this.draftId();
    if (!id) return;
    this.fetchStatus(id).subscribe({
      next: (d) => this.applyDraft(d),
      error: (err: HttpErrorResponse) =>
        this.error.set(httpErrorMessage(err, 'Não foi possível atualizar a análise.')),
    });
  }

  private fetchStatus(id: string): Observable<DraftStatusResponse> {
    return this.http.get<DraftStatusResponse>(`${BASE}/drafts/${id}`);
  }

  private applyDraft(d: DraftStatusResponse): void {
    this.draft.set(d);
    if (d.status === 'EXPIRED' || d.status === 'SAVED') this.session.removeItem(STORAGE_KEY);
  }

  /** GET masked-text: o texto exato que seria enviado, com versão e hash do consentimento. */
  loadMaskedText(): void {
    const id = this.draftId();
    if (!id || this.maskedLoading()) return;
    this.maskedLoading.set(true);
    this.masked.set(null);
    this.http.get<MaskedTextResponse>(`${BASE}/drafts/${id}/masked-text`).subscribe({
      next: (m) => {
        this.maskedLoading.set(false);
        this.masked.set(m);
      },
      error: (err: HttpErrorResponse) => {
        this.maskedLoading.set(false);
        if (errorCode(err) === 'DRAFT_NOT_AWAITING_CONSENT') {
          // O servidor já passou do consentimento: segue o status real, sem tentar de novo.
          this.refresh();
          return;
        }
        if (err.status === 404) {
          this.clearDraft();
          this.error.set('Esta análise não existe mais. Envie o arquivo de novo.');
          return;
        }
        this.error.set(httpErrorMessage(err, 'Não foi possível carregar o texto a enviar.'));
      },
    });
  }

  /** POST consent com versão e hash EXATAMENTE como recebidos; só então a análise começa. */
  consent(): void {
    const id = this.draftId();
    const m = this.masked();
    if (!id || !m || this.busy()) return;
    this.error.set(null);
    this.busy.set(true);
    this.http
      .post<DraftSubmittedResponse>(`${BASE}/drafts/${id}/consent`, {
        consentVersion: m.consentVersion,
        maskedTextSha256: m.maskedTextSha256,
      })
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.masked.set(null);
          this.draft.update((d) => (d ? { ...d, status: res.status ?? 'ANALYZING' } : d));
          this.pollTimedOut.set(false);
          this.stopPolling();
          this.startPolling();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          const code = errorCode(err);
          this.error.set(httpErrorMessage(err, 'Não foi possível autorizar o envio. Tente de novo.'));
          if (code === 'CONSENT_VERSION_MISMATCH' || code === 'CONSENT_TEXT_MISMATCH') {
            // Reabre a tela com o texto/versão novos.
            this.masked.set(null);
            this.loadMaskedText();
          } else if (code === 'DRAFT_NOT_AWAITING_CONSENT' || code === 'DRAFT_EXPIRING') {
            this.refresh();
          }
        },
      });
  }

  /** DELETE do rascunho (libera o limite). 404 também limpa; outros erros preservam. */
  discard(): void {
    const id = this.draftId();
    if (!id || this.busy()) return;
    this.error.set(null);
    this.busy.set(true);
    this.http.delete<void>(`${BASE}/drafts/${id}`).subscribe({
      next: () => {
        this.busy.set(false);
        this.clearDraft();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        if (err.status === 404) {
          this.clearDraft();
          return;
        }
        this.error.set(httpErrorMessage(err, 'Não foi possível descartar o arquivo.'));
      },
    });
  }

  /** Cancelar também libera o rascunho no servidor; se falhar, a tela e o erro permanecem. */
  cancelConsent(): void {
    this.discard();
  }

  setDecision(decision: DraftDecision): void {
    this.decisions.update((cur) => ({ ...cur, [decision.id]: decision }));
    // Só ids de sugestão e nomes de campo: sem texto do contrato. Sem isto, recarregar e
    // salvar de novo enviaria um conjunto vazio e apagaria as respostas já dadas.
    this.session.setItem(DECISIONS_KEY, JSON.stringify(this.decisions()));
  }

  private restoreDecisions(): void {
    try {
      const raw = this.session.getItem(DECISIONS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      const clean: Record<string, DraftDecision> = {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, v] of Object.entries(parsed as Record<string, unknown>)) {
          const d = v as Partial<DraftDecision> | null;
          if (
            d &&
            typeof d === 'object' &&
            SUGGESTION_ID_RE.test(key) &&
            d.id === key &&
            typeof d.field === 'string' &&
            Object.hasOwn(FIELD_LABELS, d.field) &&
            typeof d.accept === 'boolean'
          ) {
            clean[key] = { id: key, field: d.field, accept: d.accept };
          }
        }
      }
      this.decisions.set(clean);
    } catch {
      this.decisions.set({});
    }
  }

  /** Grava o conjunto inteiro de decisões; `onDone` roda só com sucesso. */
  commitDecisions(onDone?: (res: DraftDecisionsResponse) => void): void {
    const id = this.draftId();
    if (!id || this.busy()) return;
    this.error.set(null);
    this.busy.set(true);
    const decisions = Object.values(this.decisions());
    this.http
      .put<DraftDecisionsResponse>(`${BASE}/drafts/${id}/decisions`, { decisions })
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.draft.update((d) => (d ? { ...d, status: res.status } : d));
          this.reviewDoubts.set(false);
          onDone?.(res);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.error.set(
            httpErrorMessage(err, 'Não foi possível guardar suas respostas. Tente de novo.'),
          );
        },
      });
  }

  preview(): Observable<Blob> {
    const id = this.draftId();
    if (!id || !UUID_RE.test(id)) {
      return throwError(() => new Error('Nenhum rascunho para pre-visualizar.'));
    }
    return this.http.get(`${BASE}/drafts/${id}/preview`, { responseType: 'blob' });
  }

  save(confirmOverwrite: boolean): void {
    const id = this.draftId();
    if (!id || this.busy()) return;
    this.error.set(null);
    this.busy.set(true);
    const body = confirmOverwrite ? { confirmOverwrite: true } : {};
    this.http.post<ContractTemplateDto>(`${BASE}/drafts/${id}/save`, body).subscribe({
      next: (tpl) => {
        this.busy.set(false);
        this.overwriteCode.set(null);
        this.savedTemplate.set(tpl);
        this.clearDraft();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        const code = errorCode(err);
        if (code && CONFIRM_OVERWRITE_CODES.includes(code)) {
          this.overwriteCode.set(code);
          return;
        }
        // Falha no save preserva o rascunho: nada é limpo aqui.
        const message = httpErrorMessage(err, 'Não foi possível salvar o contrato. Tente de novo.');
        if (code === 'DRAFT_ALREADY_SAVED') this.clearDraft();
        this.error.set(message);
        if (code === 'DOUBTS_PENDING' || code === 'DRAFT_CHANGED' || code === 'DRAFT_FAILED') {
          this.refresh();
        }
      },
    });
  }

  cancelOverwrite(): void {
    this.overwriteCode.set(null);
  }

  /** Abandona o rascunho local (o backend o expira sozinho). */
  clearDraft(): void {
    this.stopPolling();
    this.draftId.set(null);
    this.draft.set(null);
    this.masked.set(null);
    this.maskedLoading.set(false);
    this.decisions.set({});
    this.showFields.set(false);
    this.reviewDoubts.set(false);
    this.overwriteCode.set(null);
    this.pollTimedOut.set(false);
    this.error.set(null);
    this.session.removeItem(STORAGE_KEY);
    this.session.removeItem(DECISIONS_KEY);
  }

  acknowledgeSaved(): void {
    this.savedTemplate.set(null);
  }
}
