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
import { MaintenancesService } from '../../services/maintenances.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import {
  MAINTENANCE_DOCUMENT_KIND_META,
  MaintenanceDocument,
  MaintenanceDocumentKind,
} from '../../types/maintenance.types';

/**
 * Teto do cliente, alinhado ao `MAX_BYTES` de `MaintenanceDocumentService`.
 * A guarda existe para falhar ANTES de gastar a franquia de dados de quem está
 * fotografando a nota fiscal na oficina, pelo celular.
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

/** Cópia da aba reservada. Anexo de manutenção não cobra nada — não fale em pagamento. */
export const MAINTENANCE_DOCUMENT_PLACEHOLDER_COPY: PendingTabPlaceholderCopy = {
  documentTitle: 'Abrindo o documento…',
  title: 'Abrindo o documento da manutenção',
  note: 'Não feche esta aba. O documento abre em instantes.',
  stalledNote:
    'Não foi possível abrir o documento. Feche esta aba e tente novamente na aba anterior.',
};

/**
 * Definição estática dos slots, NA ORDEM EM QUE APARECEM. São só DOIS.
 *
 * A ordem é fixa de propósito: um slot que muda de lugar conforme o
 * preenchimento é um slot que o usuário não consegue decorar.
 *
 * `required` alimenta o contador. `OTHER` fica de fora porque é ilimitado e não
 * completa nunca — contá-lo transformaria o resumo em mentira.
 */
const MAINTENANCE_SLOT_DEFS: ReadonlyArray<{
  kind: MaintenanceDocumentKind;
  hint: string;
  required: boolean;
}> = [
  {
    kind: 'NOTA_FISCAL',
    hint: 'Peça e serviço saem em notas diferentes — todas convivem aqui.',
    required: true,
  },
  { kind: 'OTHER', hint: 'Qualquer outro arquivo da manutenção.', required: false },
];

/** Um tipo de documento e TODOS os arquivos já anexados sob ele. */
export interface MaintenanceDocumentSlot {
  kind: MaintenanceDocumentKind;
  label: string;
  hint: string;
  required: boolean;
  /** N arquivos, não um. É a diferença estrutural para a vistoria. */
  files: MaintenanceDocument[];
  uploading: boolean;
}

/**
 * Anexos da manutenção: nota fiscal e outros arquivos avulsos.
 *
 * ESTRUTURA: uma LISTA DE SLOTS, um por tipo esperado, igual ao card do veículo
 * (FEAT-0038). O slot É a afordância — tocá-lo abre o seletor de arquivos
 * DAQUELE tipo. Não existe `<select>` e não existe botão "Anexar documento"
 * separado: o usuário vê o buraco e o preenche.
 *
 * ACRESCENTA, NUNCA SUBSTITUI — e aqui isso é mais crítico que nos irmãos.
 * Várias notas fiscais na MESMA manutenção é o caso NORMAL, não a exceção: peça
 * e mão de obra saem de fornecedores diferentes e o serviço às vezes é faturado
 * em parcelas (ver o javadoc de `MaintenanceDocumentKindEnum` e o COMMENT da
 * V70). A tabela não tem unicidade por kind de propósito. Se o envio passasse a
 * substituir, a nota do outro fornecedor sumiria EM SILÊNCIO — por isso existe
 * spec dedicada para essa invariante.
 *
 * NÃO EXIBE BARRA DE PROGRESSO, e isso é deliberado: o app usa
 * `provideHttpClient(withFetch())` e o `FetchBackend` do Angular nunca emite
 * `HttpEventType.UploadProgress`. Qualquer barra aqui seria uma animação
 * desconectada do envio real — o defeito já registrado neste projeto. O estado
 * é indeterminado, assumido como tal, e o "Cancelar envio" aborta o request de
 * verdade (o `unsubscribe` dispara o `AbortController` do FetchBackend).
 *
 * NÃO COMPRIME o arquivo, e isso também é deliberado: comprimir uma nota fiscal
 * a deixa ILEGÍVEL, o que anula a razão de anexá-la.
 */
@Component({
  selector: 'app-maintenance-documents-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [PageCard, ConfirmDialog, AlertBanner],
  templateUrl: './maintenance-documents-card.html',
})
export class MaintenanceDocumentsCard implements OnInit, OnDestroy {
  private readonly maintenancesService = inject(MaintenancesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly externalNavigation = inject(ExternalNavigationService);

  readonly maintenanceId = input.required<string>();

  protected readonly documents = signal<MaintenanceDocument[]>([]);
  protected readonly loading = signal(false);
  protected readonly openingId = signal<string | null>(null);
  protected readonly deleting = signal<MaintenanceDocument | null>(null);
  protected readonly deletingBusy = signal(false);
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
  protected readonly pendingKind = signal<MaintenanceDocumentKind | null>(null);

  /**
   * Tipo do envio REALMENTE em voo. Só é escrito quando o request começa e é
   * limpo por `finishUpload()`. É ele que decide dentro de qual slot o estado
   * "Enviando…" aparece e que trava os outros slots.
   */
  protected readonly uploadingKind = signal<MaintenanceDocumentKind | null>(null);

  private readonly picker = viewChild<ElementRef<HTMLInputElement>>('picker');

  /**
   * Um slot por tipo esperado, com os arquivos daquele tipo agrupados dentro.
   *
   * Dois tipos, SEM PORTÃO. Igual ao card do veículo e diferente do card do
   * motorista: aqui nenhum slot depende de campo do cadastro, a lista é
   * constante e não há condição a avaliar. Se aparecer lógica de portão neste
   * arquivo, ela foi inventada.
   */
  protected readonly slots = computed<MaintenanceDocumentSlot[]>(() => {
    const docs = this.documents();
    const sending = this.uploadingKind();
    return MAINTENANCE_SLOT_DEFS.map((def) => ({
      kind: def.kind,
      label: MAINTENANCE_DOCUMENT_KIND_META[def.kind],
      hint: def.hint,
      required: def.required,
      files: docs.filter((d) => d.kind === def.kind),
      uploading: sending === def.kind,
    }));
  });

  /** Há um envio em voo (em qualquer slot). Trava os demais slots. */
  protected readonly uploading = computed(() => this.uploadingKind() !== null);

  /** Slots essenciais — `OTHER` fora, ver `MAINTENANCE_SLOT_DEFS`. */
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
   * derrubou uma view aqui (FIX-0205). Leitura rasa, verificação estrita. E o
   * caminho de ERRO também zera a lista: sem isso uma recarga que falha
   * deixaria na tela os arquivos da carga anterior.
   */
  private load(): void {
    this.loading.set(true);
    this.maintenancesService.listDocuments(this.maintenanceId()).subscribe({
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

  /** O slot É a afordância: tocá-lo registra o tipo e abre o seletor. */
  protected openPicker(slot: MaintenanceDocumentSlot): void {
    if (this.uploading()) return;
    this.error.set(null);
    this.pendingKind.set(slot.kind);
    this.picker()?.nativeElement.click();
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
    // O estado "Enviando…" nasce AQUI, junto do request, e não no toque do
    // slot: o diálogo nativo pode ter sido dispensado sem escolher arquivo.
    this.uploadingKind.set(kind);
    // Sem compressão: comprimir uma nota fiscal a deixa ilegível.
    this.uploadSub = this.maintenancesService
      .uploadDocument(this.maintenanceId(), kind, file)
      .subscribe({
        next: (doc) => {
          this.finishUpload();
          // ACRESCENTA. Uma nota fiscal nova NÃO substitui a anterior: peça e
          // mão de obra saem de fornecedores diferentes e ambas têm de
          // continuar acessíveis. Substituir apagaria em silêncio a nota do
          // outro fornecedor.
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
   * anexos por manutenção entre eles, que o servidor descreve como teto TÉCNICO
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
    this.uploadingKind.set(null);
    this.uploadSub = null;
  }

  /**
   * Abre o documento numa aba nova pela signed URL. A aba é reservada de forma
   * SÍNCRONA dentro do gesto (browsers móveis só permitem `window.open` com o
   * gesto ainda na pilha) e navegada quando a URL chega; se o request falhar a
   * aba é fechada em vez de virar uma aba branca órfã.
   */
  protected openDocument(doc: MaintenanceDocument): void {
    if (this.openingId()) return;
    this.error.set(null);
    this.openingId.set(doc.id);

    const tab = this.externalNavigation.openPendingTab(MAINTENANCE_DOCUMENT_PLACEHOLDER_COPY);
    if (tab.blocked) {
      this.openingId.set(null);
      this.error.set('Permita pop-ups neste site para abrir o documento em uma nova aba.');
      return;
    }

    this.maintenancesService.documentSignedUrl(this.maintenanceId(), doc.id).subscribe({
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

  protected askDelete(doc: MaintenanceDocument): void {
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
    this.maintenancesService.deleteDocument(this.maintenanceId(), doc.id).subscribe({
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
  protected slotCountLabel(slot: MaintenanceDocumentSlot): string {
    const n = slot.files.length;
    if (n === 0) return slot.required ? 'Falta anexar' : 'Nenhum arquivo';
    return n === 1 ? '1 arquivo' : `${n} arquivos`;
  }

  /**
   * O leitor de tela precisa ouvir o mesmo que a tela mostra: o tipo, quantos
   * arquivos existem e que tocar ali anexa mais um.
   */
  protected slotAriaLabel(slot: MaintenanceDocumentSlot): string {
    const n = slot.files.length;
    const estado = n === 0 ? 'nenhum arquivo anexado' : `${n} ${n === 1 ? 'arquivo' : 'arquivos'}`;
    return `Anexar ${slot.label} — ${estado}`;
  }

  protected sizeText(doc: MaintenanceDocument): string {
    return formatSize(doc.sizeBytes);
  }

  protected uploadedAtText(doc: MaintenanceDocument): string {
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
