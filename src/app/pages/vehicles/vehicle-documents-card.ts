import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { VehiclesService } from '../../services/vehicles.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import {
  VEHICLE_DOCUMENT_KIND_OPTIONS,
  VehicleDocument,
  VehicleDocumentKind,
} from '../../types/vehicle.types';

/**
 * Teto do cliente, alinhado ao `MAX_BYTES` de `VehicleDocumentService`.
 * A guarda existe para falhar ANTES de gastar a franquia de dados de quem está
 * fotografando o CRLV pelo celular.
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

/** Cópia da aba reservada. Anexo de veículo não cobra nada — não fale em pagamento. */
export const VEHICLE_DOCUMENT_PLACEHOLDER_COPY: PendingTabPlaceholderCopy = {
  documentTitle: 'Abrindo o documento…',
  title: 'Abrindo o documento do veículo',
  note: 'Não feche esta aba. O documento abre em instantes.',
  stalledNote:
    'Não foi possível abrir o documento. Feche esta aba e tente novamente na aba anterior.',
};

/**
 * Anexos do veículo: CRLV e outros arquivos avulsos.
 *
 * NÃO EXIBE BARRA DE PROGRESSO, e isso é deliberado: o app usa
 * `provideHttpClient(withFetch())` e o `FetchBackend` do Angular nunca emite
 * `HttpEventType.UploadProgress`. Qualquer barra aqui seria uma animação
 * desconectada do envio real — o defeito já registrado neste projeto. O estado
 * é indeterminado, assumido como tal, e o "Cancelar envio" aborta o request de
 * verdade (o `unsubscribe` dispara o `AbortController` do FetchBackend).
 *
 * NÃO COMPRIME o arquivo, e isso também é deliberado: comprimir um CRLV o
 * deixa ILEGÍVEL, o que anula a razão de anexá-lo. A compressão do
 * `RentalInspectionService` serve foto de vistoria e não vale aqui.
 *
 * `CRLV` NÃO é único: o documento é reemitido a cada licenciamento, então o do
 * ano passado e o deste ano convivem como duas linhas `CRLV`. Enviar um novo
 * NÃO substitui o anterior — quem quiser remover o antigo remove à mão.
 */
@Component({
  selector: 'app-vehicle-documents-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [FormsModule, PageCard, ConfirmDialog, AlertBanner],
  templateUrl: './vehicle-documents-card.html',
})
export class VehicleDocumentsCard implements OnInit, OnDestroy {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly externalNavigation = inject(ExternalNavigationService);

  readonly vehicleId = input.required<string>();

  /**
   * Dois tipos, sem portão. Diferente do card do motorista, aqui nenhum slot
   * depende de campo do cadastro: a lista é constante e não há condição a
   * avaliar. Se aparecer lógica de portão neste arquivo, ela foi inventada.
   */
  protected readonly kindOptions = VEHICLE_DOCUMENT_KIND_OPTIONS;

  protected readonly documents = signal<VehicleDocument[]>([]);
  protected readonly loading = signal(false);
  protected readonly uploading = signal(false);
  protected readonly openingId = signal<string | null>(null);
  protected readonly deleting = signal<VehicleDocument | null>(null);
  protected readonly deletingBusy = signal(false);
  /** Falha de negócio (inclusive o teto de 20 anexos): banner inline, nunca toast. */
  protected readonly error = signal<string | null>(null);

  protected readonly selectedKind = signal<VehicleDocumentKind>('CRLV');

  protected readonly isEmpty = computed(() => !this.loading() && this.documents().length === 0);

  private uploadSub: Subscription | null = null;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.uploadSub?.unsubscribe();
  }

  /**
   * O `main` do backend está congelado ANTES da V68, então contra a API hoje em
   * produção esta rota não existe: o 404 cai no `error` e vira banner inline —
   * a tela do veículo continua utilizável, nunca branca.
   *
   * `Array.isArray` em vez de `?? []`: a garantia que importa é que
   * `documents()` seja SEMPRE um array, porque o template itera sobre ele. Um
   * corpo de erro que não seja lista (um objeto de erro, uma string de HTML)
   * passaria pelo `??` e estouraria no `@for` — a forma exata do `TypeError`
   * que já derrubou uma view aqui. Leitura rasa, verificação estrita, sem
   * encadear propriedade de objeto possivelmente nulo.
   */
  private load(): void {
    this.loading.set(true);
    this.vehiclesService.listDocuments(this.vehicleId()).subscribe({
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

  protected onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    // Zera o input ANTES de qualquer retorno: sem isso, escolher o MESMO arquivo
    // de novo depois de um erro não dispara `change`.
    target.value = '';
    if (!file) return;

    if (!this.isAllowed(file)) {
      this.error.set('Formato não suportado. Aceitos: PDF, JPG, PNG, WebP, HEIC/HEIF.');
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      this.error.set(
        `O arquivo tem ${formatSize(file.size)} e o limite é 20MB. ` +
          'Fotografe o documento com menos resolução e envie de novo.',
      );
      return;
    }

    this.error.set(null);
    this.uploading.set(true);
    // Sem compressão: comprimir um CRLV o deixa ilegível.
    this.uploadSub = this.vehiclesService
      .uploadDocument(this.vehicleId(), this.selectedKind(), file)
      .subscribe({
        next: (doc) => {
          this.finishUpload();
          // Acrescenta. Um CRLV novo NÃO substitui o anterior: são anos de
          // licenciamento diferentes e ambos têm de continuar acessíveis.
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
   * anexos por veículo entre eles, que o servidor descreve como teto TÉCNICO e
   * não restrição de plano — e `messageFor` já os prioriza sobre o fallback,
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
    this.uploading.set(false);
    this.uploadSub = null;
  }

  /**
   * Abre o documento numa aba nova pela signed URL. A aba é reservada de forma
   * SÍNCRONA dentro do gesto (browsers móveis só permitem `window.open` com o
   * gesto ainda na pilha) e navegada quando a URL chega; se o request falhar a
   * aba é fechada em vez de virar uma aba branca órfã.
   */
  protected openDocument(doc: VehicleDocument): void {
    if (this.openingId()) return;
    this.error.set(null);
    this.openingId.set(doc.id);

    const tab = this.externalNavigation.openPendingTab(VEHICLE_DOCUMENT_PLACEHOLDER_COPY);
    if (tab.blocked) {
      this.openingId.set(null);
      this.error.set('Permita pop-ups neste site para abrir o documento em uma nova aba.');
      return;
    }

    this.vehiclesService.documentSignedUrl(this.vehicleId(), doc.id).subscribe({
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

  protected askDelete(doc: VehicleDocument): void {
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
    this.vehiclesService.deleteDocument(this.vehicleId(), doc.id).subscribe({
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

  protected sizeText(doc: VehicleDocument): string {
    return formatSize(doc.sizeBytes);
  }

  protected uploadedAtText(doc: VehicleDocument): string {
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
