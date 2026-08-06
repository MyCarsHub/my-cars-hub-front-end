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
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import { VehicleIncidentsService } from '../../services/vehicle-incidents.service';
import {
  INCIDENT_DOCUMENT_KIND_OPTIONS,
  IncidentDocument,
  IncidentDocumentKind,
} from '../../types/vehicle-incident.types';

/**
 * Teto do cliente, alinhado ao `MAX_BYTES` de `VehicleIncidentDocumentService`.
 * A guarda existe para falhar ANTES de gastar a franquia de dados de quem está
 * na rua registrando o acidente pelo celular.
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

/** Cópia da aba reservada. Anexo de sinistro não cobra nada — não fale em pagamento. */
export const INCIDENT_DOCUMENT_PLACEHOLDER_COPY: PendingTabPlaceholderCopy = {
  documentTitle: 'Abrindo o anexo…',
  title: 'Abrindo o anexo do sinistro',
  note: 'Não feche esta aba. O documento abre em instantes.',
  stalledNote:
    'Não foi possível abrir o anexo. Feche esta aba e tente novamente na aba anterior.',
};

/**
 * Anexos do sinistro: fotos do dano, boletim de ocorrência, orçamento de reparo.
 *
 * NÃO EXIBE BARRA DE PROGRESSO, e isso é deliberado: o app usa
 * `provideHttpClient(withFetch())` e o `FetchBackend` do Angular nunca emite
 * `HttpEventType.UploadProgress`. Qualquer barra aqui seria uma animação
 * desconectada do envio real — o defeito já registrado neste projeto. O estado
 * é indeterminado, assumido como tal, e o "Cancelar envio" aborta o request de
 * verdade (o `unsubscribe` dispara o `AbortController` do FetchBackend).
 */
@Component({
  selector: 'app-incident-documents-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [FormsModule, PageCard, ConfirmDialog, AlertBanner],
  templateUrl: './incident-documents-card.html',
})
export class IncidentDocumentsCard implements OnInit, OnDestroy {
  private readonly incidentsService = inject(VehicleIncidentsService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly externalNavigation = inject(ExternalNavigationService);

  readonly incidentId = input.required<string>();

  protected readonly kindOptions = INCIDENT_DOCUMENT_KIND_OPTIONS;

  protected readonly documents = signal<IncidentDocument[]>([]);
  protected readonly loading = signal(false);
  protected readonly uploading = signal(false);
  protected readonly openingId = signal<string | null>(null);
  protected readonly deleting = signal<IncidentDocument | null>(null);
  protected readonly deletingBusy = signal(false);
  /** Falha de negócio: banner inline dentro do card, nunca toast. */
  protected readonly error = signal<string | null>(null);

  protected readonly selectedKind = signal<IncidentDocumentKind>('DAMAGE_PHOTO');

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
    this.incidentsService.listDocuments(this.incidentId()).subscribe({
      next: (docs) => {
        this.documents.set(docs ?? []);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar os anexos.'));
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
          'Reduza a qualidade da foto e envie de novo.',
      );
      return;
    }

    this.error.set(null);
    this.uploading.set(true);
    this.uploadSub = this.incidentsService
      .uploadDocument(this.incidentId(), this.selectedKind(), file)
      .subscribe({
        next: (doc) => {
          this.finishUpload();
          this.documents.update((list) => [...list, doc]);
          this.notifications.success('Anexo enviado.');
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
   */
  private uploadErrorMessage(err: HttpErrorResponse): string | null {
    this.apiErrors.claim(err);
    if (err.status === 0) return null;
    if (err.status === 413) {
      return 'O arquivo passou do limite de 20MB. Reduza a qualidade e envie de novo.';
    }
    return this.apiErrors.messageFor(err, 'Não foi possível enviar o anexo.');
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
   * Abre o anexo numa aba nova pela signed URL. A aba é reservada de forma
   * SÍNCRONA dentro do gesto (browsers móveis só permitem `window.open` com o
   * gesto ainda na pilha) e navegada quando a URL chega; se o request falhar a
   * aba é fechada em vez de virar uma aba branca órfã.
   */
  protected openDocument(doc: IncidentDocument): void {
    if (this.openingId()) return;
    this.error.set(null);
    this.openingId.set(doc.id);

    const tab = this.externalNavigation.openPendingTab(INCIDENT_DOCUMENT_PLACEHOLDER_COPY);
    if (tab.blocked) {
      this.openingId.set(null);
      this.error.set('Permita pop-ups neste site para abrir o anexo em uma nova aba.');
      return;
    }

    this.incidentsService.documentSignedUrl(this.incidentId(), doc.id).subscribe({
      next: (res) => {
        this.openingId.set(null);
        tab.navigate(res.url);
      },
      error: (err: HttpErrorResponse) => {
        this.openingId.set(null);
        tab.close();
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível abrir o anexo.'));
      },
    });
  }

  protected askDelete(doc: IncidentDocument): void {
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
    this.incidentsService.deleteDocument(this.incidentId(), doc.id).subscribe({
      next: () => {
        this.deletingBusy.set(false);
        this.deleting.set(null);
        this.documents.update((list) => list.filter((d) => d.id !== doc.id));
        this.notifications.success('Anexo removido.');
      },
      error: (err: HttpErrorResponse) => {
        this.deletingBusy.set(false);
        this.deleting.set(null);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível remover o anexo.'));
      },
    });
  }

  protected sizeText(doc: IncidentDocument): string {
    return formatSize(doc.sizeBytes);
  }

  protected uploadedAtText(doc: IncidentDocument): string {
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
