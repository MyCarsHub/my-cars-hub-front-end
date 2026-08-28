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
  signal,
  viewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverService } from '../../services/driver.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import {
  DRIVER_DOCUMENT_KIND_META,
  DriverDocument,
  DriverDocumentKind,
} from '../../types/driver.types';

/**
 * Teto do cliente, alinhado ao `MAX_BYTES` de `DriverDocumentService`.
 * A guarda existe para falhar ANTES de gastar a franquia de dados de quem está
 * fotografando a CNH pelo celular.
 */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Allowlist espelhada do backend — o que não está aqui seria recusado lá. */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];

/** Cópia da aba reservada. Anexo de motorista não cobra nada — não fale em pagamento. */
export const DRIVER_DOCUMENT_PLACEHOLDER_COPY: PendingTabPlaceholderCopy = {
  documentTitle: 'Abrindo o documento…',
  title: 'Abrindo o documento do motorista',
  note: 'Não feche esta aba. O documento abre em instantes.',
  stalledNote:
    'Não foi possível abrir o documento. Feche esta aba e tente novamente na aba anterior.',
};

/**
 * Definição estática dos slots, NA ORDEM EM QUE APARECEM.
 *
 * A ordem é fixa de propósito: um slot que muda de lugar conforme o
 * preenchimento é um slot que o usuário não consegue decorar. Preenchido ou
 * vazio, a CNH está sempre no topo.
 *
 * `required` alimenta o contador "N de M". `OTHER` fica de fora porque é
 * ilimitado e não completa nunca — contá-lo transformaria o resumo em mentira,
 * com um total que ninguém consegue atingir.
 */
const DRIVER_SLOT_DEFS: ReadonlyArray<{
  kind: DriverDocumentKind;
  hint: string;
  required: boolean;
}> = [
  { kind: 'CNH', hint: 'Frente e verso são dois arquivos do mesmo tipo.', required: true },
  {
    kind: 'ADDRESS_PROOF',
    hint: 'Conta de luz, água ou internet dos últimos meses.',
    required: true,
  },
  { kind: 'INCOME_PROOF', hint: 'Holerite, extrato bancário ou declaração.', required: true },
  { kind: 'APP_RIDE_RECEIPT', hint: 'Extrato de corridas do aplicativo.', required: true },
  { kind: 'OTHER', hint: 'Qualquer outro arquivo do motorista.', required: false },
];

/** Um tipo de documento e TODOS os arquivos já anexados sob ele. */
export interface DriverDocumentSlot {
  kind: DriverDocumentKind;
  label: string;
  hint: string;
  required: boolean;
  /** N arquivos, não um. É a diferença estrutural para a vistoria. */
  files: DriverDocument[];
  uploading: boolean;
  /**
   * `false` quando o slot só está visível porque JÁ tem arquivo, mas o portão
   * que autorizaria novos envios está fechado. Ver `slots()`.
   */
  uploadable: boolean;
}

/**
 * Documentos do motorista: CNH, comprovante de residência, comprovante de
 * renda, extrato de aplicativo.
 *
 * ESTRUTURA: uma LISTA DE SLOTS, um por tipo esperado. O slot É a afordância —
 * tocá-lo abre o seletor de arquivos DAQUELE tipo. Não existe `<select>` e não
 * existe botão "Anexar documento" separado: o usuário não precisa mais saber de
 * antemão o que quer, ele vê o buraco e o preenche.
 *
 * POR QUE NÃO O GRID DE QUADRADOS DA VISTORIA. Lá cada ângulo tem NO MÁXIMO uma
 * foto, reenviar SUBSTITUI, e a miniatura É a resposta para "esse ângulo está
 * feito?". Aqui nada disso vale: um tipo guarda N arquivos (CNH frente e verso,
 * ver o COMMENT da V65), enviar ACRESCENTA, e boa parte dos documentos é PDF,
 * que não tem miniatura. Um quadrado exibindo "a CNH mais recente" esconderia a
 * outra — a mesma invisibilidade do `<select>`, só que mais bonita. Então o
 * slot fica e o quadrado sai: cada slot expande para a LISTA dos seus arquivos,
 * com contador no cabeçalho e abrir/remover por arquivo.
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
 * `RentalInspectionService` serve foto de vistoria e não vale aqui.
 *
 * `CNH` é UM tipo, não FRENTE/VERSO — frente e verso são dois arquivos `CNH`.
 */
@Component({
  selector: 'app-driver-documents-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [PageCard, ConfirmDialog, AlertBanner],
  templateUrl: './driver-documents-card.html',
})
export class DriverDocumentsCard implements OnInit, OnDestroy {
  private readonly driverService = inject(DriverService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly externalNavigation = inject(ExternalNavigationService);

  readonly driverId = input.required<string>();

  /**
   * Vem de `DriverResponse.isAppDriver` (FEAT-0034, migration V69).
   *
   * Tipado `boolean | undefined` DE PROPÓSITO. O `main` do backend está
   * congelado ANTES da V69, então contra a API hoje em produção a chave nem
   * chega no JSON e o valor é `undefined` — não `false`. O default `undefined`
   * garante que esquecer o binding também falhe fechado.
   */
  readonly isAppDriver = input<boolean | undefined>(undefined);

  /**
   * Portão FAIL-CLOSED do slot `APP_RIDE_RECEIPT`.
   *
   * Compara com `=== true` em vez de testar truthiness: ausente/`undefined`/
   * `null` fecham o slot, que é a direção segura enquanto a V69 não sobe. E lê
   * o input direto — nada de encadear propriedade de objeto possivelmente nulo,
   * que é a forma exata do `TypeError` que já derrubou uma view aqui.
   */
  protected readonly showAppRideReceipt = computed(() => this.isAppDriver() === true);

  protected readonly documents = signal<DriverDocument[]>([]);
  protected readonly loading = signal(false);
  protected readonly openingId = signal<string | null>(null);
  protected readonly deleting = signal<DriverDocument | null>(null);
  protected readonly deletingBusy = signal(false);
  /** Falha de negócio (inclusive o teto de 20 anexos): banner inline, nunca toast. */
  protected readonly error = signal<string | null>(null);

  /**
   * Tipo do envio EM VOO — não uma escolha prévia do usuário.
   *
   * Substitui o antigo `selectedKind` do `<select>`. É escrito por
   * `openPicker()` no instante do toque e lido por `onFileSelected()`, então
   * carrega a intenção do gesto e nada mais. Nulo quando não há envio em voo, e
   * é ele que decide DENTRO DE QUAL SLOT o estado "Enviando…" aparece.
   */
  protected readonly pendingKind = signal<DriverDocumentKind | null>(null);

  private readonly picker = viewChild<ElementRef<HTMLInputElement>>('picker');

  /**
   * Um slot por tipo esperado, com os arquivos daquele tipo agrupados dentro.
   *
   * O slot do extrato de aplicativo aparece quando o portão está aberto OU
   * quando já existe arquivo sob ele. O segundo caso é real: um motorista que
   * era de app, anexou o extrato e depois teve a flag desligada continuaria com
   * o arquivo no banco — escondê-lo tiraria do usuário a única forma de vê-lo e
   * de removê-lo. O slot aparece, mas `uploadable` fica `false` e ele não
   * aceita envio novo. O portão veda ENVIO; não esconde dado que já existe.
   */
  protected readonly slots = computed<DriverDocumentSlot[]>(() => {
    const docs = this.documents();
    const gateOpen = this.showAppRideReceipt();
    const pending = this.pendingKind();
    return DRIVER_SLOT_DEFS.map((def) => {
      const files = docs.filter((d) => d.kind === def.kind);
      const uploadable = def.kind !== 'APP_RIDE_RECEIPT' || gateOpen;
      return {
        kind: def.kind,
        label: DRIVER_DOCUMENT_KIND_META[def.kind],
        hint: def.hint,
        required: def.required,
        files,
        uploading: pending === def.kind,
        uploadable,
      };
    }).filter((slot) => slot.uploadable || slot.files.length > 0);
  });

  /** Há um envio em voo (em qualquer slot). Trava os demais slots. */
  protected readonly uploading = computed(() => this.pendingKind() !== null);

  /** Slots essenciais visíveis — `OTHER` fora, ver `DRIVER_SLOT_DEFS`. */
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
    this.driverService.listDocuments(this.driverId()).subscribe({
      next: (docs) => {
        this.documents.set(Array.isArray(docs) ? docs : []);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.documents.set([]);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar os documentos.'));
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
  protected openPicker(slot: DriverDocumentSlot): void {
    if (this.uploading()) return;
    if (!this.canUpload(slot.kind)) {
      this.refuseGatedKind();
      return;
    }
    this.error.set(null);
    this.pendingKind.set(slot.kind);
    this.picker()?.nativeElement.click();
  }

  /** Portão do envio, em um lugar só, lido por `openPicker` e `onFileSelected`. */
  private canUpload(kind: DriverDocumentKind): boolean {
    return kind !== 'APP_RIDE_RECEIPT' || this.showAppRideReceipt();
  }

  /**
   * Recusa em vez de reclassificar em silêncio — arquivo arquivado sob o tipo
   * errado é pior que envio negado.
   *
   * A versão do `<select>` fazia `selectedKind.set('CNH')` depois de recusar,
   * mas aquilo era só devolver o combo a um valor exibível. Sem combo não há
   * nada a redefinir, e NÃO adotar outro tipo pelo usuário é mais fiel à
   * intenção original do que escolher um por ele.
   */
  private refuseGatedKind(): void {
    this.pendingKind.set(null);
    this.error.set(
      'Extrato de aplicativo não está disponível para este motorista. ' +
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
    // fica aberto por segundos, e nesse intervalo o input `isAppDriver` pode
    // mudar (a recarga do motorista chega, a flag some do JSON). O
    // `pendingKind` já apanhado subiria um kind vedado. É a mesma guarda que
    // existia contra `selectedKind`, reescrita para o novo ponto de entrada.
    if (!this.canUpload(kind)) {
      this.refuseGatedKind();
      return;
    }

    if (!this.isAllowed(file)) {
      this.pendingKind.set(null);
      this.error.set('Formato não suportado. Aceitos: PDF, JPG, PNG, WebP, HEIC/HEIF.');
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      this.pendingKind.set(null);
      this.error.set(
        `O arquivo tem ${formatSize(file.size)} e o limite é 20MB. ` +
          'Fotografe o documento com menos resolução e envie de novo.',
      );
      return;
    }

    this.error.set(null);
    // Sem compressão: comprimir uma CNH a deixa ilegível.
    this.uploadSub = this.driverService.uploadDocument(this.driverId(), kind, file).subscribe({
      next: (doc) => {
        this.finishUpload();
        // Acrescenta. Um segundo arquivo do MESMO tipo NÃO substitui o
        // primeiro: frente e verso da CNH são duas linhas `CNH`.
        this.documents.update((list) => [...list, doc]);
        this.notifications.success('Documento enviado.');
      },
      error: (err: HttpErrorResponse) => {
        this.finishUpload();
        this.error.set(this.uploadErrorMessage(err));
      },
    });
  }

  private isAllowed(file: File): boolean {
    if (ALLOWED_MIME_TYPES.includes(file.type)) return true;
    // Alguns Android entregam `type` vazio para HEIC — cai no nome do arquivo.
    const name = file.name.toLowerCase();
    return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  }

  /**
   * `status === 0` devolve `null` de propósito: quem avisa "sem conexão" é o
   * `errorInterceptor`, e um banner aqui daria duas mensagens para a mesma
   * falha. 413 usa o teto do cliente para não contradizer a guarda acima.
   *
   * Os erros de negócio do backend chegam em `fieldErrors.file` — o teto de 20
   * anexos por motorista entre eles, que o servidor descreve como teto TÉCNICO
   * e não restrição de plano — e `messageFor` já os prioriza sobre o fallback,
   * então o texto do servidor é o que aparece no banner inline.
   */
  private uploadErrorMessage(err: HttpErrorResponse): string | null {
    this.apiErrors.claim(err);
    if (err.status === 0) return null;
    if (err.status === 413) {
      return 'O arquivo passou do limite de 20MB. Reduza a qualidade e envie de novo.';
    }
    return this.apiErrors.messageFor(err, 'Não foi possível enviar o documento.');
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
    this.uploadSub = null;
  }

  /**
   * Abre o documento numa aba nova pela signed URL. A aba é reservada de forma
   * SÍNCRONA dentro do gesto (browsers móveis só permitem `window.open` com o
   * gesto ainda na pilha) e navegada quando a URL chega; se o request falhar a
   * aba é fechada em vez de virar uma aba branca órfã.
   */
  protected openDocument(doc: DriverDocument): void {
    if (this.openingId()) return;
    this.error.set(null);
    this.openingId.set(doc.id);

    const tab = this.externalNavigation.openPendingTab(DRIVER_DOCUMENT_PLACEHOLDER_COPY);
    if (tab.blocked) {
      this.openingId.set(null);
      this.error.set('Permita pop-ups neste site para abrir o documento em uma nova aba.');
      return;
    }

    this.driverService.documentSignedUrl(this.driverId(), doc.id).subscribe({
      next: (res) => {
        this.openingId.set(null);
        tab.navigate(res.url);
      },
      error: (err: HttpErrorResponse) => {
        this.openingId.set(null);
        tab.close();
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível abrir o documento.'));
      },
    });
  }

  protected askDelete(doc: DriverDocument): void {
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
    this.driverService.deleteDocument(this.driverId(), doc.id).subscribe({
      next: () => {
        this.deletingBusy.set(false);
        this.deleting.set(null);
        this.documents.update((list) => list.filter((d) => d.id !== doc.id));
        this.notifications.success('Documento removido.');
      },
      error: (err: HttpErrorResponse) => {
        this.deletingBusy.set(false);
        this.deleting.set(null);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível remover o documento.'));
      },
    });
  }

  /** Rótulo do cabeçalho do slot: o que responde "falta alguma coisa aqui?". */
  protected slotCountLabel(slot: DriverDocumentSlot): string {
    const n = slot.files.length;
    if (n === 0) return slot.required ? 'Falta anexar' : 'Nenhum arquivo';
    return n === 1 ? '1 arquivo' : `${n} arquivos`;
  }

  /**
   * O leitor de tela precisa ouvir o mesmo que a tela mostra: o tipo, quantos
   * arquivos existem e que tocar ali anexa mais um.
   */
  protected slotAriaLabel(slot: DriverDocumentSlot): string {
    const n = slot.files.length;
    const estado = n === 0 ? 'nenhum arquivo anexado' : `${n} ${n === 1 ? 'arquivo' : 'arquivos'}`;
    return `Anexar ${slot.label} — ${estado}`;
  }

  protected sizeText(doc: DriverDocument): string {
    return formatSize(doc.sizeBytes);
  }

  protected uploadedAtText(doc: DriverDocument): string {
    if (!doc.createdDate) return '—';
    return new Date(doc.createdDate).toLocaleDateString('pt-BR');
  }
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
