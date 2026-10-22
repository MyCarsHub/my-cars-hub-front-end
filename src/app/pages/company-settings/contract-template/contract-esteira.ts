import { HttpErrorResponse } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { LoggerService } from '../../../services/logger.service';
import { ContractAiCapability } from './ai/contract-ai-capability';
import { ContractAiService } from './ai/contract-ai.service';
import { httpErrorMessage, safeText } from './ai/contract-ai.messages';
import { ContractBaseService } from './base/contract-base.service';
import { ContractIcon } from './contract-icon';
import { ContractPaper, PaperMode } from './contract-paper';
import {
  PaperDocument,
  buildBaseDocument,
  buildMarkdownDocument,
  buildMaskedDocument,
  buildPlainDocument,
} from './contract-paper.model';
import { ContractTemplateDto, ContractTemplateService } from './contract-template-service';
import { readDocxParagraphs } from './docx-text';
import { formatFileSize } from './contract-dropzone';
import { ContractClausesStep } from './steps/clauses-step';
import { ContractConsentStep } from './steps/consent-step';
import { ContractQuestionsStep } from './steps/questions-step';
import { ContractReviewStep } from './steps/review-step';
import { ContractUploadStep } from './steps/upload-step';
import { ContractWordStep } from './steps/word-step';

export type EsteiraPath = 'mine' | 'zero' | 'word';
export type EsteiraView =
  | 'start'
  | 'upload'
  | 'consent'
  | 'reading'
  | 'fields'
  | 'review'
  | 'failed'
  | 'expired'
  | 'clauses'
  | 'word';

const MAX_BYTES = 5 * 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/**
 * Lado a lado a partir de 1000 px de CONTEÚDO (README). O protótipo mede a área principal com
 * o respiro da página; aqui medimos o cartão, que é essa área menos o respiro (`lg:px-10`).
 * Com a sidebar, 1280 px de tela dão ~940 px de cartão — no protótipo isso já é lado a lado.
 */
const SPLIT_MIN_PX = 900;
/** Celular: área principal < 640 px no protótipo = cartão < 608 px aqui (`px-4`). */
const NARROW_MAX_PX = 608;
const READING_TEXTS = ['Abrindo o arquivo', 'Procurando nomes, valores e datas', 'Quase pronto'];
const READING_PCT = ['25%', '60%', '90%'];
const STEPS: Record<EsteiraPath, string[]> = {
  mine: ['Enviar', 'Autorizar', 'Campos', 'Conferir'],
  zero: ['Cláusulas', 'Conferir'],
  word: [],
};

/**
 * A esteira da página de contrato: escolhe o caminho, conduz as etapas e mantém o contrato
 * ao vivo visível em todas elas. O estado do caminho com IA mora no `ContractAiService`
 * (reaproveitado do fluxo anterior); o do «Montar do zero», aqui e no `ContractBaseService`.
 */
@Component({
  selector: 'app-contract-esteira',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    NgTemplateOutlet,
    AlertBanner,
    ConfirmDialog,
    ContractPaper,
    ContractUploadStep,
    ContractConsentStep,
    ContractQuestionsStep,
    ContractClausesStep,
    ContractReviewStep,
    ContractWordStep,
    ContractIcon,
  ],
  templateUrl: './contract-esteira.html',
  // Entrada de cada etapa e a varredura da leitura: só com movimento liberado pelo sistema.
  styles: `
    @keyframes step-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: none; }
    }
    @keyframes scan {
      0% { transform: translateY(-2rem); }
      100% { transform: translateY(9rem); }
    }
    .footer-lift { box-shadow: 0 -10px 24px -14px rgb(16 16 16 / 0.25); }
    .scan-line {
      display: none;
      background: linear-gradient(to bottom, transparent, rgb(255 182 153 / 0.6), transparent);
    }
    @media (prefers-reduced-motion: no-preference) {
      .step-in { animation: step-in 240ms var(--ease-out) both; }
      .scan-line { display: block; animation: scan 1.8s ease-in-out infinite; }
    }
  `,
})
export class ContractEsteira {
  protected readonly ai = inject(ContractAiService);
  protected readonly capability = inject(ContractAiCapability);
  protected readonly baseSvc = inject(ContractBaseService);
  private readonly templates = inject(ContractTemplateService);
  private readonly logger = inject(LoggerService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  /** Contrato em uso (ou `null`). */
  readonly template = input<ContractTemplateDto | null>(null);
  readonly saved = output<ContractTemplateDto>();

  // ---- layout
  private readonly width = signal(1200);
  protected readonly split = computed(() => this.width() >= SPLIT_MIN_PX);
  protected readonly narrow = computed(() => this.width() < NARROW_MAX_PX);
  /** Ponteiro grosso (dedo): «Toque para escolher» em vez de «Arraste…». */
  protected readonly touch = signal(false);
  protected readonly where = computed(() => (this.split() ? 'ao lado' : 'logo abaixo'));

  // ---- estado comum
  protected readonly path = signal<EsteiraPath | null>(null);
  protected readonly mode = signal<PaperMode>('example');
  protected readonly exitOpen = signal(false);
  protected readonly focusId = signal<string | null>(null);

  // ---- «Ajustar o meu contrato»
  protected readonly file = signal<File | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly fetchingCurrent = signal(false);
  private readonly uploadLines = signal<string[] | null>(null);
  protected readonly uploadReading = signal(false);
  protected readonly agreed = signal(false);
  protected readonly qIndex = signal(0);
  /** Texto mascarado guardado SÓ em memória: o contrato ao vivo das etapas seguintes. */
  private readonly maskedParagraphs = signal<{ id: string; text: string }[] | null>(null);
  private readonly fallbackLines = signal<string[] | null>(null);
  private readonly fallbackLoading = signal(false);
  private maskedRequestedFor: string | null = null;
  private fallbackRequestedFor: string | null = null;
  protected readonly readingTick = signal(0);
  private readingTimer: ReturnType<typeof setInterval> | null = null;

  // ---- «Montar do zero»
  protected readonly zeroStep = signal<0 | 1>(0);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly zeroSaving = signal(false);
  protected readonly zeroError = signal<string | null>(null);

  // ---- «Fazer no Word»
  private readonly exampleMd = signal<string | null>(null);
  private readonly exampleLoading = signal(false);

  protected readonly aiState = this.capability.state;
  protected readonly aiReady = computed(() => this.capability.state() === 'on');
  protected readonly aiPending = computed(() => {
    const s = this.capability.state();
    return s === 'unknown' || s === 'loading';
  });
  protected readonly baseState = this.baseSvc.availability;

  protected readonly view = computed<EsteiraView>(() => {
    const path = this.path();
    if (!path) return 'start';
    if (path === 'word') return 'word';
    if (path === 'zero') return this.zeroStep() === 0 ? 'clauses' : 'review';
    switch (this.ai.step()) {
      case 'intro':
      case 'saved':
        return 'upload';
      case 'consent':
        return 'consent';
      case 'progress':
        return 'reading';
      case 'doubts':
        return 'fields';
      case 'preview':
      case 'fields':
        return 'review';
      case 'failed':
        return 'failed';
      default:
        return 'expired';
    }
  });

  protected readonly steps = computed(() => {
    const path = this.path();
    return path ? STEPS[path] : [];
  });

  protected readonly stepIndex = computed(() => {
    switch (this.view()) {
      case 'consent':
        return 1;
      case 'reading':
      case 'fields':
      case 'failed':
      case 'expired':
        return 2;
      case 'review':
        return this.path() === 'zero' ? 1 : 3;
      default:
        return 0;
    }
  });

  protected readonly title = computed(() => {
    switch (this.path()) {
      case 'mine':
        return 'Ajustar o meu contrato';
      case 'zero':
        return 'Montar do zero';
      case 'word':
        return 'Fazer no Word';
      default:
        return this.template() ? 'Quer mudar o contrato?' : 'Vamos montar o seu contrato';
    }
  });

  protected readonly subtitle = computed(() => {
    const path = this.path();
    if (!path) {
      return `Escolha um caminho. O contrato aparece ${this.split() ? 'ao lado' : 'logo abaixo'} e nada muda até você salvar.`;
    }
    if (path === 'word') return 'Troque os dados fixos pelos campos e envie o arquivo do Word.';
    return `O contrato ${this.where()} muda a cada passo. Nada é salvo antes do fim.`;
  });

  /** Nome do passo seguinte («Depois: Conferir»); `null` no último. */
  protected readonly nextStepName = computed(() => this.steps()[this.stepIndex() + 1] ?? null);

  /** Chave da tela da etapa: muda a cada etapa e a cada pergunta (dispara a entrada). */
  protected readonly stepKey = computed(() => {
    const v = this.view();
    return v === 'fields' ? `fields-${this.qIndex()}` : `${this.path() ?? 'none'}-${v}`;
  });

  protected readonly readingTexts = READING_TEXTS;

  /** Enquanto o primário está ocupado («Salvando…»), sai a seta. */
  protected readonly busyNext = computed(() => this.ai.busy() || this.zeroSaving());

  // ---- classes repetidas (botões e cartões de caminho)
  protected readonly primaryBtn =
    'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary-500 px-6 text-[17px] font-semibold text-white shadow-md transition hover:bg-primary-600 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
  protected readonly secondaryBtn =
    'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-5 text-base font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2';
  protected readonly cardOn =
    'border-neutral-200 shadow-sm hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-lg active:translate-y-0 motion-reduce:hover:translate-y-0';
  protected readonly cardOff = 'border-dashed border-neutral-300 bg-neutral-50/60';

  protected readonly doubts = computed(() => this.ai.draft()?.doubts ?? []);
  protected readonly notMaskedLabels = computed(() =>
    (this.ai.masked()?.notMasked ?? []).map((n) => safeText(n.label)),
  );

  // ---- contrato ao vivo
  private readonly zeroDoc = computed<PaperDocument>(() => {
    const base = this.baseSvc.base();
    if (!base) return { paragraphs: [], fields: [], clauses: 0 };
    const focus = this.view() === 'clauses' ? this.focusId() : null;
    return buildBaseDocument(base.clauses, this.selected(), focus);
  });

  private readonly maskedDoc = computed<PaperDocument | null>(() => {
    const paragraphs = this.maskedParagraphs();
    if (!paragraphs) return null;
    const view = this.view();
    if (view === 'consent' || view === 'reading') {
      return buildMaskedDocument(paragraphs, { stage: 'consent' });
    }
    const d = this.ai.draft();
    return buildMaskedDocument(paragraphs, {
      stage: view === 'fields' ? 'fields' : 'review',
      suggestions: [...(d?.certain ?? []), ...(d?.doubts ?? [])],
      doubtIds: new Set((d?.doubts ?? []).map((s) => s.id)),
      decisions: this.ai.decisions(),
      focusId: view === 'fields' ? this.focusId() : null,
    });
  });

  protected readonly paper = computed(() => {
    const view = this.view();
    const empty = (title: string, text: string) => ({
      title,
      doc: null as PaperDocument | null,
      empty: text,
      loading: false,
      modeSwitch: false,
      forceNames: false,
    });
    const show = (title: string, doc: PaperDocument | null, extra: Partial<{ loading: boolean; modeSwitch: boolean; forceNames: boolean }> = {}) => ({
      title,
      doc,
      empty: '',
      loading: extra.loading ?? false,
      modeSwitch: extra.modeSwitch ?? false,
      forceNames: extra.forceNames ?? false,
    });
    switch (view) {
      case 'start':
        return empty(
          'Contrato',
          `Escolha um caminho ${this.split() ? 'ao lado' : 'acima'}. O contrato aparece aqui e muda a cada passo.`,
        );
      case 'upload':
      case 'failed':
      case 'expired': {
        if (!this.file()) {
          return empty('Seu contrato', 'O seu contrato aparece aqui assim que você escolher o arquivo.');
        }
        const lines = this.uploadLines();
        if (!this.uploadReading() && (!lines || lines.length === 0)) {
          return empty(
            'Seu contrato, como foi enviado',
            'Não deu para mostrar o texto deste arquivo aqui. Você ainda pode continuar.',
          );
        }
        return show('Seu contrato, como foi enviado', lines ? buildPlainDocument(lines) : null, {
          loading: this.uploadReading(),
        });
      }
      case 'consent':
      case 'reading':
        return show('O que a IA vai ler', this.maskedDoc(), {
          loading: this.ai.maskedLoading() || !this.maskedDoc(),
        });
      case 'fields':
        if (!this.maskedDoc()) {
          return empty('Como o contrato vai ficar', 'O contrato aparece aqui ao conferir.');
        }
        return show('Como o contrato vai ficar', this.maskedDoc(), { modeSwitch: true });
      case 'review':
        if (this.path() === 'zero') {
          return show('Seu contrato', this.zeroDoc(), { modeSwitch: true });
        }
        if (this.maskedDoc()) return show('Seu contrato', this.maskedDoc(), { modeSwitch: true });
        return show('Seu contrato, com dados de exemplo', this.fallbackDoc(), {
          loading: this.fallbackLoading(),
        });
      case 'clauses':
        return show('Seu contrato', this.zeroDoc(), {
          modeSwitch: true,
          loading: this.baseState() === 'loading',
        });
      case 'word': {
        const md = this.exampleMd();
        return show('Contrato exemplo com os campos', md ? buildMarkdownDocument(md) : null, {
          loading: this.exampleLoading() || !md,
          forceNames: true,
        });
      }
    }
  });

  private readonly fallbackDoc = computed(() => {
    const lines = this.fallbackLines();
    return lines ? buildPlainDocument(lines) : null;
  });

  protected readonly paperMode = computed<PaperMode>(() =>
    this.paper().forceNames ? 'names' : this.mode(),
  );
  protected readonly paperDraft = computed(
    () =>
      this.path() === 'zero' && this.baseState() === 'on' && this.baseSvc.base()?.draft === true,
  );

  /** Campos e cláusulas da etapa «Conferir». */
  protected readonly reviewCounts = computed(() => {
    if (this.path() === 'zero') {
      const doc = this.zeroDoc();
      return { fields: doc.fields.length, clauses: doc.clauses };
    }
    const d = this.ai.draft();
    const decisions = this.ai.decisions();
    const fields = new Set<string>();
    for (const s of d?.certain ?? []) {
      const dec = decisions[s.id];
      if (!dec || dec.accept) fields.add(dec?.field ?? s.field);
    }
    for (const s of d?.doubts ?? []) {
      const dec = decisions[s.id];
      if (dec?.accept) fields.add(dec.field);
    }
    const doc = this.maskedDoc() ?? this.fallbackDoc();
    return { fields: fields.size, clauses: doc?.clauses ?? 0 };
  });

  // ---- navegação do rodapé
  protected readonly showNav = computed(() => {
    const v = this.view();
    return !!this.path() && v !== 'word' && v !== 'reading' && v !== 'failed' && v !== 'expired';
  });

  protected readonly showBack = computed(() => {
    const v = this.view();
    if (v === 'fields') return this.qIndex() > 0;
    if (v === 'review' && this.path() === 'mine') return this.doubts().length > 0;
    return true;
  });

  protected readonly nextLabel = computed(() => {
    switch (this.view()) {
      case 'upload':
        return this.ai.busy() ? 'Enviando…' : 'Continuar';
      case 'consent':
        return this.ai.busy() ? 'Autorizando…' : 'Autorizar e analisar';
      case 'fields':
        if (this.ai.busy()) return 'Guardando…';
        return this.qIndex() < this.doubts().length - 1 ? 'Próxima pergunta' : 'Ver como ficou';
      case 'clauses':
        return 'Conferir contrato';
      case 'review':
        return this.ai.busy() || this.zeroSaving() ? 'Salvando…' : 'Salvar contrato';
      default:
        return 'Continuar';
    }
  });

  protected readonly nextDisabled = computed(() => {
    switch (this.view()) {
      case 'upload':
        return !this.file() || this.ai.busy() || this.fetchingCurrent();
      case 'consent':
        return !this.agreed() || !this.ai.masked() || this.ai.busy();
      case 'fields':
        return this.ai.busy();
      case 'clauses':
        return this.baseState() !== 'on';
      case 'review':
        return this.ai.busy() || this.zeroSaving();
      default:
        return false;
    }
  });

  protected readonly readingText = computed(
    () => READING_TEXTS[Math.min(this.readingTick(), READING_TEXTS.length - 1)],
  );
  protected readonly readingPct = computed(
    () => READING_PCT[Math.min(this.readingTick(), READING_PCT.length - 1)],
  );

  /**
   * «Cancelar» só quando o servidor deixa descartar: durante a leitura da IA o DELETE do
   * rascunho dá 409 (ANALYZING) e, com um envio em voo, o 202 chegaria depois e reabriria
   * o caminho. Nos dois casos o botão espera.
   */
  protected readonly canCancel = computed(
    () => this.view() !== 'reading' && !this.ai.busy() && !this.zeroSaving(),
  );

  /** Há trabalho a perder? Decide se «Cancelar» pede confirmação. */
  private readonly hasWork = computed(() => {
    const v = this.view();
    if (v === 'start' || v === 'word') return false;
    if (v === 'upload') return !!this.file();
    return true;
  });

  constructor() {
    this.capability.load();
    this.baseSvc.load();
    this.ai.init();

    afterNextRender(() => {
      const el = this.host.nativeElement;
      this.width.set(el.clientWidth || 1200);
      if (typeof matchMedia === 'function') this.touch.set(matchMedia('(pointer: coarse)').matches);
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(([entry]) => {
        const w = entry.contentRect.width;
        if (Math.abs(w - this.width()) > 0.5) this.width.set(w);
      });
      ro.observe(el);
      this.destroyRef.onDestroy(() => ro.disconnect());
    });

    // Um rascunho retomado da sessão (recarregar a página) reabre o caminho com IA.
    effect(() => {
      const id = this.ai.draftId();
      if (id && untracked(this.path) === null) this.path.set('mine');
    });

    // Autorizar: pede o texto exato (mascarado) uma vez por rascunho.
    effect(() => {
      const id = this.ai.draftId();
      if (this.view() !== 'consent' || !id) return;
      if (this.maskedRequestedFor === id) return;
      this.maskedRequestedFor = id;
      untracked(() => this.ai.loadMaskedText());
    });

    // O texto mascarado some do serviço no consentimento; a esteira guarda uma cópia em memória.
    effect(() => {
      const m = this.ai.masked();
      if (m) this.maskedParagraphs.set(m.paragraphs.map((p) => ({ id: p.id, text: safeText(p.text) })));
    });

    // Sem o texto mascarado (página recarregada no meio), «Conferir» usa a prévia do backend.
    effect(() => {
      const id = this.ai.draftId();
      if (this.view() !== 'review' || this.path() !== 'mine' || !id) return;
      if (this.maskedParagraphs() || this.fallbackRequestedFor === id) return;
      this.fallbackRequestedFor = id;
      untracked(() => this.loadFallback());
    });

    // Pergunta em foco no contrato ao vivo.
    effect(() => {
      if (this.view() !== 'fields') return;
      const id = this.doubts()[this.qIndex()]?.id ?? null;
      untracked(() => this.focusId.set(id));
    });

    // Barra de leitura: avança sozinha enquanto a análise roda.
    effect(() => {
      const reading = this.view() === 'reading';
      untracked(() => (reading ? this.startReading() : this.stopReading()));
    });

    // Contrato salvo pelo caminho com IA.
    effect(() => {
      const tpl = this.ai.savedTemplate();
      if (!tpl) return;
      untracked(() => {
        this.ai.acknowledgeSaved();
        this.finish(tpl);
      });
    });

    // Etapa nova: o foco vai para o título dela (teclado e leitor de tela acompanham), e
    // se o título ficou fora da tela (celular, botão no rodapé) a página sobe até ele.
    let firstKey = true;
    effect(() => {
      this.stepKey();
      if (firstKey) {
        firstKey = false;
        return;
      }
      afterNextRender(
        () => {
          const h = this.host.nativeElement.querySelector<HTMLElement>('[data-step-heading]');
          if (!h || typeof h.focus !== 'function') return;
          h.focus({ preventScroll: true });
          const r = h.getBoundingClientRect();
          const vh = typeof window === 'undefined' ? 0 : window.innerHeight;
          if ((r.top < 0 || r.top > vh * 0.6) && typeof h.scrollIntoView === 'function') {
            const reduce =
              typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
            h.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
          }
        },
        { injector: this.injector },
      );
    });

    this.destroyRef.onDestroy(() => this.stopReading());
  }

  // ---- caminhos
  protected start(path: EsteiraPath): void {
    if (path === 'mine' && !this.aiReady()) return;
    if (path === 'zero' && this.baseState() === 'off') return;
    this.resetLocal();
    this.path.set(path);
    if (path === 'zero') this.initZero();
    if (path === 'word') this.loadExample();
    this.scrollIntoView();
  }

  protected askExit(): void {
    if (!this.canCancel()) return;
    if (this.hasWork()) this.exitOpen.set(true);
    else this.exit();
  }

  protected exit(): void {
    this.exitOpen.set(false);
    if (this.ai.draftId()) {
      // Libera o rascunho no servidor; se falhar, o backend o expira sozinho.
      this.ai.discard();
      this.ai.clearDraft();
    }
    this.resetLocal();
    this.path.set(null);
  }

  private resetLocal(): void {
    this.file.set(null);
    this.fileError.set(null);
    this.uploadLines.set(null);
    this.agreed.set(false);
    this.qIndex.set(0);
    this.focusId.set(null);
    this.mode.set('example');
    this.maskedParagraphs.set(null);
    this.fallbackLines.set(null);
    this.maskedRequestedFor = null;
    this.fallbackRequestedFor = null;
    this.zeroStep.set(0);
    this.zeroError.set(null);
  }

  private finish(tpl: ContractTemplateDto): void {
    this.resetLocal();
    this.path.set(null);
    this.saved.emit(tpl);
  }

  // ---- «Ajustar o meu contrato»
  protected async pickFile(file: File): Promise<void> {
    this.file.set(null);
    this.uploadLines.set(null);
    const reject = (msg: string): void => this.fileError.set(msg);
    // MIME vazio é comum (Windows sem Office); MIME de outro tipo, não.
    if (!/\.docx$/i.test(file.name) || (file.type !== '' && file.type !== DOCX_MIME)) {
      return reject('Este arquivo não é do Word. Escolha o arquivo do contrato que termina em .docx.');
    }
    if (file.size > MAX_BYTES) return reject('O arquivo é maior que 5 MB.');
    if (!(await hasZipSignature(file))) {
      return reject('Este arquivo não parece ser um documento do Word. Escolha outro arquivo.');
    }
    this.fileError.set(null);
    this.file.set(file);
    void this.readUpload(file);
  }

  /** Nome do arquivo sem caracteres de controle/bidi (disfarçariam a extensão). */
  protected readonly fileName = computed(() => {
    const f = this.file();
    return f ? safeText(f.name) : null;
  });

  protected readonly fileSize = computed(() => {
    const f = this.file();
    return f ? formatFileSize(f.size) : null;
  });

  protected useCurrent(): void {
    const tpl = this.template();
    if (!tpl || this.fetchingCurrent()) return;
    this.fetchingCurrent.set(true);
    this.fileError.set(null);
    this.templates.downloadTemplate().subscribe({
      next: (blob) => {
        this.fetchingCurrent.set(false);
        void this.pickFile(new File([blob], tpl.filename, { type: DOCX_MIME }));
      },
      error: (err: HttpErrorResponse) => {
        this.fetchingCurrent.set(false);
        this.fileError.set(httpErrorMessage(err, 'Não foi possível buscar o contrato atual.'));
      },
    });
  }

  protected clearFile(): void {
    this.file.set(null);
    this.uploadLines.set(null);
  }

  private async readUpload(file: File): Promise<void> {
    this.uploadReading.set(true);
    this.uploadLines.set(null);
    try {
      const lines = await readDocxParagraphs(file);
      if (this.file() === file) this.uploadLines.set(lines);
    } catch (err) {
      // Só a falha; nunca o conteúdo do contrato.
      this.logger.error('contract upload text failed', err);
      if (this.file() === file) this.uploadLines.set([]);
    } finally {
      this.uploadReading.set(false);
    }
  }

  private loadFallback(): void {
    this.fallbackLoading.set(true);
    this.ai.preview().subscribe({
      next: (blob) => {
        readDocxParagraphs(blob)
          .then((lines) => this.fallbackLines.set(lines))
          .catch((err: unknown) => {
            this.logger.error('contract preview text failed', err);
            this.fallbackLines.set([]);
          })
          .finally(() => this.fallbackLoading.set(false));
      },
      error: () => {
        this.fallbackLoading.set(false);
        this.fallbackLines.set([]);
      },
    });
  }

  private startReading(): void {
    if (this.readingTimer !== null) return;
    this.readingTick.set(0);
    this.readingTimer = setInterval(() => {
      this.readingTick.update((t) => Math.min(t + 1, READING_TEXTS.length - 1));
    }, 1100);
  }

  private stopReading(): void {
    if (this.readingTimer !== null) clearInterval(this.readingTimer);
    this.readingTimer = null;
  }

  protected sendAnother(): void {
    this.ai.discard();
    this.ai.clearDraft();
    this.resetLocal();
  }

  protected retryReading(): void {
    this.ai.error.set(null);
    this.ai.startPolling();
  }

  // ---- «Montar do zero»
  private initZero(): void {
    const base = this.baseSvc.base();
    this.selected.set(
      new Set((base?.clauses ?? []).filter((c) => !c.fixed && c.defaultOn).map((c) => c.id)),
    );
  }

  protected retryBase(): void {
    this.baseSvc.load(true);
  }

  protected toggleClause(id: string): void {
    this.focusId.set(id);
    this.selected.update((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  private saveZero(): void {
    if (this.zeroSaving()) return;
    const base = this.baseSvc.base();
    if (!base) return;
    const ids = base.clauses.filter((c) => !c.fixed && this.selected().has(c.id)).map((c) => c.id);
    this.zeroSaving.set(true);
    this.zeroError.set(null);
    this.baseSvc.save(ids).subscribe({
      next: (tpl) => {
        this.zeroSaving.set(false);
        this.finish(tpl);
      },
      error: (err: HttpErrorResponse) => {
        this.zeroSaving.set(false);
        this.zeroError.set(httpErrorMessage(err, 'Não foi possível salvar o contrato. Tente de novo.'));
      },
    });
  }

  // ---- «Fazer no Word»
  private loadExample(): void {
    if (this.exampleMd() || this.exampleLoading()) return;
    this.exampleLoading.set(true);
    this.templates.example().subscribe({
      next: (md) => {
        this.exampleLoading.set(false);
        this.exampleMd.set(md);
      },
      error: () => {
        this.exampleLoading.set(false);
        this.exampleMd.set('');
      },
    });
  }

  protected wordUploaded(tpl: ContractTemplateDto): void {
    this.finish(tpl);
  }

  // ---- rodapé
  protected back(): void {
    switch (this.view()) {
      case 'upload':
        if (this.file()) this.exitOpen.set(true);
        else this.exit();
        return;
      case 'consent':
        // Voltar ao envio descarta o rascunho; o arquivo escolhido continua na tela.
        this.ai.discard();
        this.agreed.set(false);
        this.maskedRequestedFor = null;
        return;
      case 'fields': {
        const i = Math.max(0, this.qIndex() - 1);
        this.qIndex.set(i);
        this.focusId.set(this.doubts()[i]?.id ?? null);
        return;
      }
      case 'review':
        if (this.path() === 'zero') {
          this.zeroStep.set(0);
        } else {
          this.qIndex.set(Math.max(0, this.doubts().length - 1));
          this.ai.reviewDoubts.set(true);
        }
        return;
      case 'clauses':
        this.exitOpen.set(true);
        return;
    }
  }

  protected next(): void {
    if (this.nextDisabled()) return;
    switch (this.view()) {
      case 'upload': {
        const file = this.file();
        if (file) this.ai.submit(file);
        return;
      }
      case 'consent':
        this.ai.consent();
        return;
      case 'fields': {
        const doubts = this.doubts();
        const current = doubts[this.qIndex()];
        // «Próxima» sem tocar numa resposta aceita a mais provável.
        if (current && !this.ai.decisions()[current.id]) {
          this.ai.setDecision({ id: current.id, field: current.field, accept: true });
        }
        if (this.qIndex() < doubts.length - 1) {
          this.qIndex.update((i) => i + 1);
          this.focusId.set(doubts[this.qIndex()]?.id ?? null);
          return;
        }
        this.ai.commitDecisions();
        return;
      }
      case 'clauses':
        this.zeroStep.set(1);
        return;
      case 'review':
        if (this.path() === 'zero') this.saveZero();
        else this.ai.save(false);
        return;
    }
  }

  protected confirmOverwrite(): void {
    this.ai.save(true);
  }

  protected onFocus(id: string): void {
    this.focusId.set(id);
  }

  private scrollIntoView(): void {
    const el = this.host.nativeElement;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }
}

/** DOCX é um ZIP: os 4 primeiros bytes são PK 03 04. */
export function hasZipSignature(file: Blob): Promise<boolean> {
  return file
    .slice(0, 4)
    .arrayBuffer()
    .then((buf) => {
      const b = new Uint8Array(buf);
      return b.length === 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
    })
    .catch(() => false);
}