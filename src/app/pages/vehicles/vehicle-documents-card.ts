import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import {
  DocumentLike,
  DocumentsCard,
  DocumentsCardOps,
  DocumentSlotDef,
} from '../../components/documents/documents-card';
import {
  MAX_DOCUMENT_LABEL,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_LABEL,
} from '../../components/documents/document-file-rules';
import { ImageCompressionService } from '../../services/image-compression.service';
import { VehiclesService } from '../../services/vehicles.service';
import { VEHICLE_DOCUMENT_KIND_META, VehicleDocumentKind } from '../../types/vehicle.types';

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
      [description]="description"
      (documentsChange)="documentsChange.emit($event)"
    />
  `,
})
export class VehicleDocumentsCard {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly compression = inject(ImageCompressionService);

  readonly vehicleId = input.required<string>();

  /** Repassa a lista do card compartilhado; o detalhe tira dela a foto. */
  readonly documentsChange = output<DocumentLike[]>();

  /** A foto tem teto próprio (`MAX_PHOTO_BYTES`): a frase geral não pode prometer mais. */
  protected readonly description =
    'Toque em um tipo para anexar os documentos do veículo. São aceitos PDF, JPG ou PNG até ' +
    `${MAX_DOCUMENT_LABEL} cada.`;

  /**
   * Três tipos, SEM PORTÃO — a lista é constante (array simples, não computed:
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
    {
      // V115 — OPCIONAL. Vira a miniatura do card na lista de veículos; sem
      // ela, a lista usa a frente da última vistoria aprovada. Só imagem: o
      // servidor recusa PDF neste tipo, e a mensagem cai no banner do card.
      // É o ÚNICO tipo comprimido: a miniatura baixa este arquivo inteiro a
      // cada carga da lista, e foto de carro não precisa de legibilidade.
      kind: 'PHOTO',
      label: VEHICLE_DOCUMENT_KIND_META['PHOTO'],
      hint: `Opcional. Aparece na lista e no detalhe do veículo. Só imagem: JPG, PNG ou WebP, até ${MAX_PHOTO_LABEL}.`,
      required: false,
      prepare: (file) => this.compression.compress(file),
      maxBytes: MAX_PHOTO_BYTES,
      maxLabel: MAX_PHOTO_LABEL,
    },
  ];

  protected readonly ops: DocumentsCardOps = {
    list: () => this.vehiclesService.listDocuments(this.vehicleId()),
    upload: (kind, file) =>
      this.vehiclesService.uploadDocument(this.vehicleId(), kind as VehicleDocumentKind, file),
    remove: (doc) => this.vehiclesService.deleteDocument(this.vehicleId(), doc.id),
    signedUrl: (doc) => this.vehiclesService.documentSignedUrl(this.vehicleId(), doc.id),
  };
}
