import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { EMPTY, Observable, Subscription, from, of, switchMap } from 'rxjs';
import { PageCard } from '../core/page-card/page-card';
import { ConfirmDialog } from '../core/confirm-dialog/confirm-dialog';
import { BottomSheet } from '../core/bottom-sheet/bottom-sheet';
import { KvList } from '../core/kv-list/kv-list';
import { ListChevron, ListGroup, ListRow } from '../core/list-group/list-group';
import { StatusChip } from '../core/status-chip/status-chip';
import { AlertBanner } from '../alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { DocumentPreviewService } from '../document-preview/document-preview.service';
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_LABEL,
  DOCUMENT_ACCEPT,
  formatDocumentSize,
  isAllowedDocumentFile,
} from './document-file-rules';

/**
 * Definição de UM slot esperado, na ordem em que deve aparecer.
 *
 * `gated` é DINÂMICO: o consumidor recalcula as defs quando o portão muda
 * (ex.: `isAppDriver` do motorista) e o card reage — inclusive no intervalo
 * entre o toque no slot e a escolha do arquivo, ver `onFileSelected()`.
 */
export interface DocumentSlotDef {
  kind: string;
  label: string;
  hint: string;
  required: boolean;
  /** Portão fechado: veda envio novo; o slot só aparece se JÁ tem arquivo. */
  gated?: boolean;
  /** Mensagem inline quando um envio do kind vedado é recusado. */
  gatedRefusalMessage?: string;
  /**
   * Preparo do arquivo antes do envio. Só para o slot que PEDE: foto de veículo
   * comprime; documento nunca (ver a nota "NÃO COMPRIME" do card). Com `prepare`,
   * o teto vale para o arquivo PREPARADO, não para o que o usuário escolheu.
   */
  prepare?: (file: File) => Promise<File>;
  /** Teto próprio do tipo, quando é menor que `MAX_DOCUMENT_BYTES`. */
  maxBytes?: number;
  /** O mesmo teto, como o usuário lê nas mensagens. */
  maxLabel?: string;
}

/** O mínimo estrutural que o card precisa de um documento persistido. */
export interface DocumentLike {
  id: string;
  kind: string;
  kindLabel: string;
  fileName: string;
  sizeBytes: number;
  createdDate: string;
}

/**
 * As operações de dados do card, injetadas pelo consumidor — o card é dono do
 * FLUXO (assinatura, cancelamento/abort, erros, estados), nunca do endpoint.
 */
export interface DocumentsCardOps {
  list: () => Observable<DocumentLike[]>;
  upload: (kind: string, file: File) => Observable<DocumentLike>;
  remove: (doc: DocumentLike) => Observable<unknown>;
  signedUrl: (doc: DocumentLike) => Observable<{ url: string }>;
}

/** Um tipo de documento e o arquivo anexado sob ele. */
export interface DocumentSlot {
  kind: string;
  label: string;
  hint: string;
  required: boolean;
  /**
   * A REGRA DE PRODUTO é `maxPerKind` (1 por padrão — a CNH é um arquivo só,
   * frente e verso juntos). Continua lista porque o SERVIDOR ainda aceita N
   * por tipo e dado legado com mais de um arquivo precisa continuar visível e
   * removível — esconder o excedente tiraria do usuário a única forma de
   * resolvê-lo.
   */
  files: DocumentLike[];
  uploading: boolean;
  /**
   * `false` quando o slot só está visível porque JÁ tem arquivo, mas o portão
   * que autorizaria novos envios está fechado. Ver `slots()`.
   */
  uploadable: boolean;
  /**
   * Hierarquia visual do slot, em um lugar só para template e teste:
   * `gated` (portão fechado) > `filled` (tem arquivo) > `empty`.
   */
  state: 'empty' | 'filled' | 'gated';
}

/**
 * Card de documentos de um pai (motorista, veículo, manutenção…) — extraído do
 * card do motorista (FIX-0231, supersede o FIX-0150); a forma canônica é a do
 * FIX-0226/0227.
 *
 * ESTRUTURA: uma LISTA DE SLOTS, um por tipo esperado. O slot É a afordância —
 * tocá-lo abre o seletor de arquivos DAQUELE tipo. Não existe `<select>` e não
 * existe botão "Anexar documento" separado: o usuário não precisa mais saber de
 * antemão o que quer, ele vê o buraco e o preenche.
 *
 * UM ARQUIVO POR TIPO é a regra de produto (`maxPerKind`, default 1). O slot
 * cheio NÃO abre o seletor — o segundo gesto é remover (e anexar de novo),
 * nunca acrescentar. O SERVIDOR ainda aceita N por tipo (só o teto de 20 por
 * pai), então dado legado com mais de um arquivo pode existir: o slot lista
 * TODOS, com abrir/remover por arquivo, porque esconder o excedente tiraria do
 * usuário a única forma de resolvê-lo.
 *
 * NÃO EXIBE BARRA DE PROGRESSO, e isso é deliberado: o app usa
 * `provideHttpClient(withFetch())` e o `FetchBackend` do Angular nunca emite
 * `HttpEventType.UploadProgress`. Qualquer barra aqui seria uma animação
 * desconectada do envio real — o defeito já registrado neste projeto. O estado
 * é indeterminado, assumido como tal, e o "Cancelar envio" aborta o request de
 * verdade (o `unsubscribe` dispara o `AbortController` do FetchBackend).
 *
 * NÃO COMPRIME o arquivo, e isso também é deliberado: comprimir uma CNH a deixa
 * ILEGÍVEL, o que anula a razão de anexá-la. A compressão do
 * `RentalInspectionService` serve foto de vistoria e não vale aqui. A única
 * exceção é opt-in e por slot (`DocumentSlotDef.prepare`): a foto do veículo é
 * imagem de vitrine, não documento a ser lido.
 */
@Component({
  selector: 'app-documents-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    PageCard,
    ConfirmDialog,
    AlertBanner,
    BottomSheet,
    KvList,
    ListGroup,
    ListRow,
    ListChevron,
    StatusChip,
  ],
  templateUrl: './documents-card.html',
})
export class DocumentsCard implements OnInit, OnDestroy {
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly preview = inject(DocumentPreviewService);

  /** Slots esperados, NA ORDEM em que aparecem — fixa, para o usuário decorar. */
  readonly slotDefs = input.required<DocumentSlotDef[]>();
  readonly ops = input.required<DocumentsCardOps>();
  /** Descrição sob o título, com a entidade no genitivo ("do motorista"…). */
  readonly description = input.required<string>();
  readonly title = input('Documentos');
  /** Teto POR TIPO. 1 = regra canônica; N continua possível (incidentes). */
  readonly maxPerKind = input(1);
  /**
   * `card` é o cartão com slots. `rows` é a mesma regra em linhas agrupadas, para quem
   * mora numa coluna de grupos: sem descrição nem contador, que ali seriam ruído.
   */
  readonly variant = input<'card' | 'rows'>('card');

  /**
   * SUBSTANTIVO da entidade nas mensagens do card (toasts, erros, diálogo,
   * rótulos acessíveis). O sinistro chama seus arquivos de "anexo" e o card
   * dele se intitula "Anexos" — sem este input as mensagens diriam
   * "documento" embaixo daquele título, que foi o defeito de coerência da
   * adoção (FIX-0234). As demais entidades ficam no default.
   */
  readonly nounSingular = input('documento');
  readonly nounPlural = input('documentos');

  /**
   * A lista como o card a conhece: depois de carregar, enviar ou remover. Quem
   * depende dela (a foto no detalhe do veículo) acompanha por aqui, sem um segundo
   * GET de documentos e sem ficar para trás quando o usuário mexe no slot.
   */
  readonly documentsChange = output<DocumentLike[]>();

  /** O substantivo em início de frase ("Documento enviado." / "Anexo enviado."). */
  protected readonly nounCapitalized = computed(() => {
    const noun = this.nounSingular();
    return noun.charAt(0).toUpperCase() + noun.slice(1);
  });

  protected readonly accept = DOCUMENT_ACCEPT;

  protected readonly documents = signal<DocumentLike[]>([]);
  protected readonly loading = signal(false);
  protected readonly deleting = signal<DocumentLike | null>(null);
  protected readonly deletingBusy = signal(false);
  /** Arquivo aberto na folha de `rows`, com Abrir e Remover. */
  protected readonly fileSheet = signal<{ label: string; doc: DocumentLike } | null>(null);
  /** Falha de negócio (inclusive o teto de 20 anexos): banner inline, nunca toast. */
  protected readonly error = signal<string | null>(null);

  /**
   * ALVO do seletor de arquivos — a intenção do gesto, não um estado de tela.
   *
   * É escrito por `openPicker()` no instante do toque e lido por
   * `onFileSelected()` quando o arquivo chega. NÃO indica envio em voo, e essa
   * distinção é o conserto de um defeito real: o diálogo nativo de arquivos
   * pode ser dispensado sem escolher nada, e nesse caso nenhum envio começou.
   * Confundir os dois fazia o slot anunciar "Enviando…" no instante do toque e
   * nunca mais sair disso.
   */
  protected readonly pendingKind = signal<string | null>(null);

  /**
   * Tipo do envio REALMENTE em voo. Só é escrito quando o request começa e é
   * limpo por `finishUpload()`. É ele que decide dentro de qual slot o estado
   * "Enviando…" aparece e que trava os outros slots.
   */
  protected readonly uploadingKind = signal<string | null>(null);

  private readonly picker = viewChild<ElementRef<HTMLInputElement>>('picker');

  /**
   * Um slot por tipo esperado, com os arquivos daquele tipo agrupados dentro.
   *
   * O slot de portão fechado aparece quando JÁ existe arquivo sob ele. O caso
   * é real: um pai que perdeu a condição do portão continuaria com o arquivo
   * no banco — escondê-lo tiraria do usuário a única forma de vê-lo e de
   * removê-lo. O slot aparece, mas `uploadable` fica `false` e ele não aceita
   * envio novo. O portão veda ENVIO; não esconde dado que já existe.
   */
  protected readonly slots = computed<DocumentSlot[]>(() => {
    const docs = this.documents();
    const sending = this.uploadingKind();
    return this.slotDefs()
      .map((def) => {
        const files = docs.filter((d) => d.kind === def.kind);
        const uploadable = !def.gated;
        const state: DocumentSlot['state'] = !uploadable
          ? 'gated'
          : files.length > 0
            ? 'filled'
            : 'empty';
        return {
          kind: def.kind,
          label: def.label,
          hint: def.hint,
          required: def.required,
          files,
          uploading: sending === def.kind,
          uploadable,
          state,
        };
      })
      .filter((slot) => slot.uploadable || slot.files.length > 0);
  });

  /** Há um envio em voo (em qualquer slot). Trava os demais slots. */
  protected readonly uploading = computed(() => this.uploadingKind() !== null);

  /** Slots essenciais visíveis — os opcionais ficam fora do contador. */
  private readonly requiredSlots = computed(() => this.slots().filter((s) => s.required));

  protected readonly requiredTotal = computed(() => this.requiredSlots().length);

  /** O número que responde "o que ainda falta?" sem o usuário abrir nada. */
  protected readonly requiredFilled = computed(
    () => this.requiredSlots().filter((s) => s.files.length > 0).length,
  );

  protected readonly allRequiredFilled = computed(
    () => this.requiredTotal() > 0 && this.requiredFilled() === this.requiredTotal(),
  );

  private uploadSub: Subscription | null = null;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.uploadSub?.unsubscribe();
  }

  /**
   * `Array.isArray` em vez de `?? []`: a garantia que importa é que
   * `documents()` seja SEMPRE um array, porque `slots()` faz `.filter` sobre
   * ele. Um corpo de erro que não seja lista (um objeto de erro, uma string de
   * HTML) passaria pelo `??` e estouraria — a forma exata do `TypeError` que já
   * derrubou uma view aqui. E o caminho de ERRO também zera a lista: sem isso
   * uma recarga que falha deixaria na tela os arquivos da carga anterior.
   */
  private load(): void {
    this.loading.set(true);
    this.ops()
      .list()
      .subscribe({
        next: (docs) => {
          this.documents.set(Array.isArray(docs) ? docs : []);
          this.loading.set(false);
          this.documentsChange.emit(this.documents());
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.documents.set([]);
          this.documentsChange.emit(this.documents());
          this.error.set(
            this.apiErrors.messageFor(err, `Não foi possível carregar os ${this.nounPlural()}.`),
          );
        },
      });
  }

  /**
   * O slot É a afordância: tocá-lo registra o tipo e abre o seletor.
   *
   * PRIMEIRA METADE DO PORTÃO NO ENVIO: um kind vedado nem chega a abrir o
   * seletor. É barato e evita fazer o usuário escolher um arquivo para só
   * depois ouvir "não". A segunda metade está em `onFileSelected()`, e as duas
   * são necessárias — ver o comentário de lá.
   */
  protected openPicker(slot: DocumentSlot): void {
    if (this.uploading()) return;
    // Teto POR TIPO: slot cheio não abre o seletor. O botão já vem
    // desabilitado no template; a guarda aqui é a segunda metade da mesma
    // regra, para o caso de o clique chegar por outro caminho.
    if (slot.files.length >= this.maxPerKind()) return;
    if (!this.canUpload(slot.kind)) {
      this.refuseGatedKind(slot.kind);
      return;
    }
    this.error.set(null);
    this.pendingKind.set(slot.kind);
    this.picker()?.nativeElement.click();
  }

  /** Portão do envio, em um lugar só, lido por `openPicker` e `onFileSelected`. */
  private canUpload(kind: string): boolean {
    return !this.slotDefs().find((def) => def.kind === kind)?.gated;
  }

  /**
   * Recusa em vez de reclassificar em silêncio — arquivo arquivado sob o tipo
   * errado é pior que envio negado. NÃO adotar outro tipo pelo usuário é mais
   * fiel à intenção original do que escolher um por ele.
   */
  private refuseGatedKind(kind: string): void {
    this.pendingKind.set(null);
    const def = this.slotDefs().find((d) => d.kind === kind);
    this.error.set(
      def?.gatedRefusalMessage ??
        `Este tipo de ${this.nounSingular()} não está disponível. ` +
          'Escolha outro tipo e envie de novo.',
    );
  }

  protected onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    // Zera o input ANTES de qualquer retorno: sem isso, escolher o MESMO arquivo
    // de novo depois de um erro não dispara `change`.
    target.value = '';
    const kind = this.pendingKind();
    if (!file || !kind) {
      this.pendingKind.set(null);
      return;
    }

    // SEGUNDA METADE DO PORTÃO NO ENVIO. Não é redundante com `openPicker()`:
    // entre o toque no slot e a escolha do arquivo o diálogo nativo do sistema
    // fica aberto por segundos, e nesse intervalo o portão pode fechar (a
    // recarga do pai chega, a flag some do JSON). O `pendingKind` já apanhado
    // subiria um kind vedado.
    if (!this.canUpload(kind)) {
      this.refuseGatedKind(kind);
      return;
    }

    if (!isAllowedDocumentFile(file)) {
      this.pendingKind.set(null);
      this.error.set('Formato não suportado. Aceitos: PDF, JPG, PNG, WebP, HEIC/HEIF.');
      return;
    }
    const def = this.slotDefs().find((d) => d.kind === kind);
    this.error.set(null);
    // O estado "Enviando…" nasce AQUI, junto do request, e não no toque do
    // slot: o diálogo nativo pode ter sido dispensado sem escolher arquivo.
    this.uploadingKind.set(kind);
    // Sem compressão, salvo o slot que pede (`prepare`): comprimir uma CNH a
    // deixa ilegível. O preparo mora dentro da assinatura para o "Cancelar
    // envio" valer também enquanto ele roda.
    this.uploadSub = (def?.prepare ? from(def.prepare(file)) : of(file))
      .pipe(
        switchMap((ready) => {
          if (ready.size > (def?.maxBytes ?? MAX_DOCUMENT_BYTES)) {
            this.finishUpload();
            this.error.set(
              `O arquivo tem ${formatDocumentSize(ready.size)} e o limite é ${this.limitLabel(def)}. ` +
                `Fotografe o ${this.nounSingular()} com menos resolução e envie de novo.`,
            );
            return EMPTY;
          }
          return this.ops().upload(kind, ready);
        }),
      )
      .subscribe({
        next: (doc) => {
          this.finishUpload();
          // O slot tinha vaga (cheio não abre o seletor), então o append
          // preenche o tipo — e preserva eventual dado legado de outros tipos.
          this.documents.update((list) => [...list, doc]);
          this.documentsChange.emit(this.documents());
          this.notifications.success(`${this.nounCapitalized()} enviado.`);
        },
        error: (err: HttpErrorResponse) => {
          this.finishUpload();
          this.error.set(this.uploadErrorMessage(err, def));
        },
      });
  }

  private limitLabel(def: DocumentSlotDef | undefined): string {
    return def?.maxLabel ?? MAX_DOCUMENT_LABEL;
  }

  /**
   * `status === 0` devolve `null` de propósito: quem avisa "sem conexão" é o
   * `errorInterceptor`, e um banner aqui daria duas mensagens para a mesma
   * falha. 413 usa o teto do cliente para não contradizer a guarda acima.
   *
   * Os erros de negócio do backend chegam em `fieldErrors.file` — o teto de 20
   * anexos por pai entre eles — e `messageFor` já os prioriza sobre o
   * fallback, então o texto do servidor é o que aparece no banner inline.
   */
  private uploadErrorMessage(
    err: HttpErrorResponse,
    def: DocumentSlotDef | undefined,
  ): string | null {
    this.apiErrors.claim(err);
    if (err.status === 0) return null;
    if (err.status === 413) {
      return `O arquivo passou do limite de ${this.limitLabel(def)}. Reduza a qualidade e envie de novo.`;
    }
    return this.apiErrors.messageFor(
      err,
      `Não foi possível enviar o ${this.nounSingular()}.`,
    );
  }

  protected cancelUpload(): void {
    if (!this.uploadSub) return;
    // `unsubscribe` aborta o request no browser (FetchBackend usa AbortController).
    this.uploadSub.unsubscribe();
    this.finishUpload();
    this.notifications.info('Envio cancelado.');
  }

  private finishUpload(): void {
    this.pendingKind.set(null);
    this.uploadingKind.set(null);
    this.uploadSub = null;
  }

  /**
   * Abre o documento no visualizador do app (`DocumentPreviewService`), nunca numa aba
   * nova. O modal abre NA HORA do toque e só então pede a signed URL; falha do request
   * (inclusive a mensagem do servidor) aparece DENTRO do modal, com "Tentar de novo".
   */
  protected openDocument(doc: DocumentLike): void {
    this.error.set(null);
    this.preview.open({
      source: () => this.ops().signedUrl(doc),
      fileName: doc.fileName,
      title: doc.kindLabel,
      caption: doc.fileName,
      errorMessage: `Não foi possível abrir o ${this.nounSingular()}.`,
    });
  }

  protected askDelete(doc: DocumentLike): void {
    this.deleting.set(doc);
  }

  protected cancelDelete(): void {
    if (this.deletingBusy()) return;
    this.deleting.set(null);
  }

  protected confirmDelete(): void {
    const doc = this.deleting();
    if (!doc || this.deletingBusy()) return;
    this.error.set(null);
    this.deletingBusy.set(true);
    this.ops()
      .remove(doc)
      .subscribe({
        next: () => {
          this.deletingBusy.set(false);
          this.deleting.set(null);
          this.documents.update((list) => list.filter((d) => d.id !== doc.id));
          this.documentsChange.emit(this.documents());
          this.notifications.success(`${this.nounCapitalized()} removido.`);
        },
        error: (err: HttpErrorResponse) => {
          this.deletingBusy.set(false);
          this.deleting.set(null);
          this.error.set(
            this.apiErrors.messageFor(err, `Não foi possível remover o ${this.nounSingular()}.`),
          );
        },
      });
  }

  /**
   * Rótulo do cabeçalho do slot: o que responde "falta alguma coisa aqui?".
   * Com `maxPerKind` 1 o preenchido diz "Anexado"; o plural só existe para
   * dado legado que o servidor ainda guarda (N por tipo).
   */
  /** Falta de verdade: só um essencial vazio se parece com um erro. */
  protected isMissing(slot: DocumentSlot): boolean {
    return slot.state === 'empty' && slot.required;
  }

  /** Opcional vazio: nada está errado, é só um convite. */
  protected isCalm(slot: DocumentSlot): boolean {
    return slot.state === 'empty' && !slot.required;
  }

  protected openFileSheet(slot: DocumentSlot, doc: DocumentLike): void {
    this.fileSheet.set({ label: slot.label, doc });
  }

  protected closeFileSheet(): void {
    this.fileSheet.set(null);
  }

  /** A folha sai primeiro: a confirmação não pode abrir por trás dela. */
  protected removeFromSheet(doc: DocumentLike): void {
    this.closeFileSheet();
    this.askDelete(doc);
  }

  protected fileRowAriaLabel(slot: DocumentSlot, doc: DocumentLike): string {
    return `${slot.label}, ${doc.fileName}: ver opções`;
  }

  protected slotCountLabel(slot: DocumentSlot): string {
    const n = slot.files.length;
    if (n === 0) return slot.required ? 'Falta anexar' : 'Adicionar';
    if (n === 1) return this.maxPerKind() === 1 ? 'Anexado' : '1 arquivo';
    return `${n} arquivos`;
  }

  /**
   * O leitor de tela precisa ouvir o mesmo que a tela mostra: slot com vaga é
   * a afordância de anexar; slot cheio não aceita outro arquivo — o caminho é
   * remover o atual. No slot de portão FECHADO (visível só porque guarda
   * arquivo legado) remover é possível mas REANEXAR não — a label não pode
   * prometer uma substituição que o portão recusa.
   */
  protected slotAriaLabel(slot: DocumentSlot): string {
    if (slot.state === 'gated') {
      return `${slot.label} — ${this.nounSingular()} anexado. Este tipo não aceita novos envios.`;
    }
    if (slot.files.length >= this.maxPerKind()) {
      return `${slot.label} — ${this.nounSingular()} anexado. Remova o arquivo atual para substituir.`;
    }
    // Modo N parcialmente cheio: já tem documento E ainda tem vaga — a label
    // não pode dizer "nenhum arquivo" nem prometer substituição.
    if (slot.files.length > 0) {
      return `Anexar ${slot.label} — ${this.nounSingular()} anexado, ainda há vaga`;
    }
    return `Anexar ${slot.label} — nenhum arquivo anexado`;
  }

  /** Rótulos do template que carregam o substantivo da entidade. */
  protected readonly uploadingText = computed(
    () => `Enviando o ${this.nounSingular()}… Mantenha esta tela aberta.`,
  );
  protected readonly removeDialogTitle = computed(() => `Remover ${this.nounSingular()}?`);

  protected openAriaLabel(doc: DocumentLike): string {
    return `Abrir ${this.nounSingular()} ${doc.fileName}`;
  }

  protected removeAriaLabel(doc: DocumentLike): string {
    return `Remover ${this.nounSingular()} ${doc.fileName}`;
  }

  protected sizeText(doc: DocumentLike): string {
    return formatDocumentSize(doc.sizeBytes);
  }

  protected uploadedAtText(doc: DocumentLike): string {
    if (!doc.createdDate) return '—';
    return new Date(doc.createdDate).toLocaleDateString('pt-BR');
  }
}
