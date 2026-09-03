import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import {
  DocumentsCard,
  DocumentsCardOps,
  DocumentSlotDef,
} from '../../components/documents/documents-card';
import { VehiclesService } from '../../services/vehicles.service';
import { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import { VEHICLE_DOCUMENT_KIND_META, VehicleDocumentKind } from '../../types/vehicle.types';

/** Cópia da aba reservada. Anexo de veículo não cobra nada — não fale em pagamento. */
export const VEHICLE_DOCUMENT_PLACEHOLDER_COPY: PendingTabPlaceholderCopy = {
  documentTitle: 'Abrindo o documento…',
  title: 'Abrindo o documento do veículo',
  note: 'Não feche esta aba. O documento abre em instantes.',
  stalledNote:
    'Não foi possível abrir o documento. Feche esta aba e tente novamente na aba anterior.',
};

/**
 * Documentos do veículo — wrapper do `DocumentsCard` compartilhado (FIX-0232,
 * adoção do padrão canônico do FIX-0226/0227/0231): este arquivo diz O QUE o
 * veículo anexa (CRLV + Outro, sem portão) e COMO os dados trafegam
 * (`VehiclesService`); o comportamento — UM por tipo, estados
 * vermelho/verde, upload abortável, dado legado N por tipo visível e
 * removível — mora no componente compartilhado.
 *
 * REGRA NOVA do FIX-0232: o CRLV é UM arquivo (o mais recente); CRLVs de anos
 * anteriores já gravados continuam visíveis e removíveis como dado legado, mas
 * anexar um novo exige remover o atual primeiro. O servidor também recusa o
 * duplicado (400 `fieldErrors.kind`), e essa mensagem cai no banner inline do
 * card compartilhado.
 */
@Component({
  selector: 'app-vehicle-documents-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [DocumentsCard],
  template: `
    <app-documents-card
      title="Documentos anexados"
      [slotDefs]="slotDefs"
      [ops]="ops"
      description="Toque em um tipo para anexar os documentos do veículo. São aceitos PDF, JPG ou PNG até 20MB cada."
      [placeholderCopy]="placeholderCopy"
    />
  `,
})
export class VehicleDocumentsCard {
  private readonly vehiclesService = inject(VehiclesService);

  readonly vehicleId = input.required<string>();

  /**
   * Dois tipos, SEM PORTÃO — a lista é constante (array simples, não computed:
   * nada aqui reage a estado). Se aparecer lógica de portão neste arquivo, ela
   * foi inventada.
   */
  protected readonly slotDefs: DocumentSlotDef[] = [
    {
      kind: 'CRLV',
      label: VEHICLE_DOCUMENT_KIND_META['CRLV'],
      hint: 'Sempre o mais recente; anexar de novo substitui.',
      required: true,
    },
    {
      kind: 'OTHER',
      label: VEHICLE_DOCUMENT_KIND_META['OTHER'],
      hint: 'Qualquer outro arquivo do veículo.',
      required: false,
    },
  ];

  protected readonly placeholderCopy = VEHICLE_DOCUMENT_PLACEHOLDER_COPY;

  protected readonly ops: DocumentsCardOps = {
    list: () => this.vehiclesService.listDocuments(this.vehicleId()),
    upload: (kind, file) =>
      this.vehiclesService.uploadDocument(this.vehicleId(), kind as VehicleDocumentKind, file),
    remove: (doc) => this.vehiclesService.deleteDocument(this.vehicleId(), doc.id),
    signedUrl: (doc) => this.vehiclesService.documentSignedUrl(this.vehicleId(), doc.id),
  };
}
