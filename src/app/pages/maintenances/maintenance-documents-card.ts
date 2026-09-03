import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import {
  DocumentsCard,
  DocumentsCardOps,
  DocumentSlotDef,
} from '../../components/documents/documents-card';
import { MaintenancesService } from '../../services/maintenances.service';
import { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import {
  MAINTENANCE_DOCUMENT_KIND_META,
  MaintenanceDocumentKind,
} from '../../types/maintenance.types';

/** Cópia da aba reservada. Anexo de manutenção não cobra nada — não fale em pagamento. */
export const MAINTENANCE_DOCUMENT_PLACEHOLDER_COPY: PendingTabPlaceholderCopy = {
  documentTitle: 'Abrindo o documento…',
  title: 'Abrindo o documento da manutenção',
  note: 'Não feche esta aba. O documento abre em instantes.',
  stalledNote:
    'Não foi possível abrir o documento. Feche esta aba e tente novamente na aba anterior.',
};

/**
 * Documentos da manutenção — wrapper do `DocumentsCard` compartilhado
 * (FIX-0233, adoção do padrão canônico do FIX-0226/0227/0231). A antiga cópia
 * inline das constantes de arquivo morreu aqui: as regras vêm da fonte única
 * (`components/documents/document-file-rules`).
 *
 * REGRA NOVA do FIX-0233 (decisão estrita do usuário): UMA nota fiscal por
 * manutenção — o teto prático vira 2 arquivos (1 NF + 1 Outro). Quem precisa
 * de mais notas registra manutenções POR EVENTO (a válvula de escape que o
 * javadoc do backend descreve). Dado legado com N notas continua visível e
 * removível. O servidor também recusa o kind duplicado (400
 * `fieldErrors.kind`), e essa mensagem cai no banner inline do card.
 */
@Component({
  selector: 'app-maintenance-documents-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [DocumentsCard],
  template: `
    <app-documents-card
      title="Documentos anexados"
      [slotDefs]="slotDefs"
      [ops]="ops"
      description="Toque em um tipo para anexar os documentos da manutenção. São aceitos PDF, JPG ou PNG até 20MB cada."
      [placeholderCopy]="placeholderCopy"
    />
  `,
})
export class MaintenanceDocumentsCard {
  private readonly maintenancesService = inject(MaintenancesService);

  readonly maintenanceId = input.required<string>();

  /** Dois tipos, SEM PORTÃO — lista constante. */
  protected readonly slotDefs: DocumentSlotDef[] = [
    {
      kind: 'NOTA_FISCAL',
      label: MAINTENANCE_DOCUMENT_KIND_META['NOTA_FISCAL'],
      hint: 'Uma por manutenção. Para mais notas, registre manutenções por evento.',
      required: true,
    },
    {
      kind: 'OTHER',
      label: MAINTENANCE_DOCUMENT_KIND_META['OTHER'],
      hint: 'Qualquer outro arquivo da manutenção.',
      required: false,
    },
  ];

  protected readonly placeholderCopy = MAINTENANCE_DOCUMENT_PLACEHOLDER_COPY;

  protected readonly ops: DocumentsCardOps = {
    list: () => this.maintenancesService.listDocuments(this.maintenanceId()),
    upload: (kind, file) =>
      this.maintenancesService.uploadDocument(
        this.maintenanceId(),
        kind as MaintenanceDocumentKind,
        file,
      ),
    remove: (doc) => this.maintenancesService.deleteDocument(this.maintenanceId(), doc.id),
    signedUrl: (doc) => this.maintenancesService.documentSignedUrl(this.maintenanceId(), doc.id),
  };
}
