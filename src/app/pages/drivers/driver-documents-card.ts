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
import { DriverService } from '../../services/driver.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import {
  DRIVER_DOCUMENT_KIND_OPTIONS,
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
 * Documentos do motorista: CNH, comprovante de residência, comprovante de
 * renda, extrato de aplicativo.
 *
 * NÃO EXIBE BARRA DE PROGRESSO, e isso é deliberado: o app usa
 * `provideHttpClient(withFetch())` e o `FetchBackend` do Angular nunca emite
 * `HttpEventType.UploadProgress`. Qualquer barra aqui seria uma animação
 * desconectada do envio real — o defeito já registrado neste projeto. O estado
 * é indeterminado, assumido como tal, e o "Cancelar envio" aborta o request de
 * verdade (o `unsubscribe` dispara o `AbortController` do FetchBackend).
 *
 * NÃO COMPRIME o arquivo, e isso também é deliberado: comprimir uma CNH a
 * deixa ILEGÍVEL, o que anula a razão de anexá-la. A compressão do
 * `RentalInspectionService` serve foto de vistoria e não vale aqui.
 *
 * `CNH` é UM tipo, não FRENTE/VERSO — frente e verso são dois arquivos `CNH`.
 */
@Component({
  selector: 'app-driver-documents-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [FormsModule, PageCard, ConfirmDialog, AlertBanner],
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

  /** O slot do extrato de aplicativo só existe para motorista de app. */
  protected readonly kindOptions = computed(() =>
    DRIVER_DOCUMENT_KIND_OPTIONS.filter(
      (option) => option.value !== 'APP_RIDE_RECEIPT' || this.showAppRideReceipt(),
    ),
  );

  protected readonly documents = signal<DriverDocument[]>([]);
  protected readonly loading = signal(false);
  protected readonly uploading = signal(false);
  protected readonly openingId = signal<string | null>(null);
  protected readonly deleting = signal<DriverDocument | null>(null);
  protected readonly deletingBusy = signal(false);
  /** Falha de negócio (inclusive o teto de 20 anexos): banner inline, nunca toast. */
  protected readonly error = signal<string | null>(null);

  protected readonly selectedKind = signal<DriverDocumentKind>('CNH');

  protected readonly isEmpty = computed(() => !this.loading() && this.documents().length === 0);

  private uploadSub: Subscription | null = null;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.uploadSub?.unsubscribe();
  }

  private load(): void {
    this.loading.set(true);
    this.driverService.listDocuments(this.driverId()).subscribe({
      next: (docs) => {
        this.documents.set(docs ?? []);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
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

    // O portão vale no ENVIO, não só na exibição. Sem isto ele seria decorativo:
    // esconder a `<option>` não impede que um `selectedKind` já apanhado antes
    // do portão fechar suba um kind vedado. Recusa em vez de reclassificar em
    // silêncio — arquivo arquivado sob o tipo errado é pior que envio negado.
    if (this.selectedKind() === 'APP_RIDE_RECEIPT' && !this.showAppRideReceipt()) {
      this.selectedKind.set('CNH');
      this.error.set(
        'Extrato de aplicativo não está disponível para este motorista. ' +
          'Escolha outro tipo e envie de novo.',
      );
      return;
    }

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
    // Sem compressão: comprimir uma CNH a deixa ilegível.
    this.uploadSub = this.driverService
      .uploadDocument(this.driverId(), this.selectedKind(), file)
      .subscribe({
        next: (doc) => {
          this.finishUpload();
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
   * anexos por motorista entre eles — e `messageFor` já os prioriza sobre o
   * fallback, então o texto do servidor é o que aparece no banner inline.
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
