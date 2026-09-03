import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import {
  DocumentsCard,
  DocumentsCardOps,
  DocumentSlotDef,
} from '../../components/documents/documents-card';
import { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import { VehicleIncidentsService } from '../../services/vehicle-incidents.service';
import {
  INCIDENT_DOCUMENT_KIND_META,
  IncidentDocumentKind,
} from '../../types/vehicle-incident.types';

/** Cópia da aba reservada. Anexo de sinistro não cobra nada — não fale em pagamento. */
export const INCIDENT_DOCUMENT_PLACEHOLDER_COPY: PendingTabPlaceholderCopy = {
  documentTitle: 'Abrindo o anexo…',
  title: 'Abrindo o anexo do sinistro',
  note: 'Não feche esta aba. O documento abre em instantes.',
  stalledNote:
    'Não foi possível abrir o anexo. Feche esta aba e tente novamente na aba anterior.',
};

/**
 * Anexos do sinistro — wrapper do `DocumentsCard` compartilhado (FIX-0234,
 * adoção em MODO N): `maxPerKind` ilimitado porque várias fotos do dano na
 * MESMA ocorrência é o caso NORMAL, não a exceção. O antigo `<select>` de tipo
 * morreu na adoção: cada tipo agora é um slot tocável, como nos irmãos.
 *
 * O sinistro chama seus arquivos de ANEXO, não "documento": `nounSingular`
 * mantém toasts, erros, diálogo e rótulos acessíveis coerentes com o título
 * "Anexos" (FIX-0234, iteração 3).
 *
 * Nenhum tipo é essencial (`required: false` em todos): sinistro sem boletim
 * existe, e cobrar um "N de M" aqui seria inventar obrigação — o card
 * compartilhado esconde o contador quando não há essencial.
 */
@Component({
  selector: 'app-incident-documents-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [DocumentsCard],
  template: `
    <app-documents-card
      title="Anexos"
      nounSingular="anexo"
      nounPlural="anexos"
      [slotDefs]="slotDefs"
      [ops]="ops"
      [maxPerKind]="maxPerKind"
      description="Fotos do dano, boletim de ocorrência, orçamento de reparo. Aceitos PDF, JPG, PNG, WebP e HEIC/HEIF, até 20MB por arquivo."
      [placeholderCopy]="placeholderCopy"
    />
  `,
})
export class IncidentDocumentsCard {
  private readonly incidentsService = inject(VehicleIncidentsService);

  readonly incidentId = input.required<string>();

  /** MODO N: nenhum teto por tipo — fotos do dano se acumulam por natureza. */
  protected readonly maxPerKind = Infinity;

  protected readonly slotDefs: DocumentSlotDef[] = [
    {
      kind: 'DAMAGE_PHOTO',
      label: INCIDENT_DOCUMENT_KIND_META['DAMAGE_PHOTO'],
      hint: 'Fotos tiradas no local valem mais que qualquer descrição depois.',
      required: false,
    },
    {
      kind: 'POLICE_REPORT',
      label: INCIDENT_DOCUMENT_KIND_META['POLICE_REPORT'],
      hint: 'O B.O. registrado da ocorrência.',
      required: false,
    },
    {
      kind: 'REPAIR_QUOTE',
      label: INCIDENT_DOCUMENT_KIND_META['REPAIR_QUOTE'],
      hint: 'Orçamento da oficina para o reparo.',
      required: false,
    },
    {
      kind: 'INSURANCE_CLAIM',
      label: INCIDENT_DOCUMENT_KIND_META['INSURANCE_CLAIM'],
      hint: 'Comunicação ou processo junto à seguradora.',
      required: false,
    },
    {
      kind: 'OTHER',
      label: INCIDENT_DOCUMENT_KIND_META['OTHER'],
      hint: 'Qualquer outro arquivo do sinistro.',
      required: false,
    },
  ];

  protected readonly placeholderCopy = INCIDENT_DOCUMENT_PLACEHOLDER_COPY;

  protected readonly ops: DocumentsCardOps = {
    list: () => this.incidentsService.listDocuments(this.incidentId()),
    upload: (kind, file) =>
      this.incidentsService.uploadDocument(this.incidentId(), kind as IncidentDocumentKind, file),
    remove: (doc) => this.incidentsService.deleteDocument(this.incidentId(), doc.id),
    signedUrl: (doc) => this.incidentsService.documentSignedUrl(this.incidentId(), doc.id),
  };
}
