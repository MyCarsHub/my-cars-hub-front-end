import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  DocumentsCard,
  DocumentsCardOps,
  DocumentSlotDef,
} from '../../components/documents/documents-card';
import { DriverService } from '../../services/driver.service';
import { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import { DRIVER_DOCUMENT_KIND_META, DriverDocumentKind } from '../../types/driver.types';

/** Cópia da aba reservada. Anexo de motorista não cobra nada — não fale em pagamento. */
export const DRIVER_DOCUMENT_PLACEHOLDER_COPY: PendingTabPlaceholderCopy = {
  documentTitle: 'Abrindo o documento…',
  title: 'Abrindo o documento do motorista',
  note: 'Não feche esta aba. O documento abre em instantes.',
  stalledNote:
    'Não foi possível abrir o documento. Feche esta aba e tente novamente na aba anterior.',
};

/**
 * Documentos do motorista — o dono do PADRÃO extraído para o
 * `DocumentsCard` compartilhado (FIX-0231): este arquivo virou o wrapper que
 * diz O QUE o motorista anexa (slots, portão do extrato, cópias) e COMO os
 * dados trafegam (`DriverService`); todo o comportamento — um por tipo,
 * hierarquia de estados, upload abortável, dado legado N por tipo — mora no
 * componente compartilhado.
 *
 * `CNH` é UM tipo e UM arquivo (frente e verso juntos, FIX-0226).
 */
@Component({
  selector: 'app-driver-documents-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [DocumentsCard],
  template: `
    <app-documents-card
      [slotDefs]="slotDefs()"
      [ops]="ops"
      description="Toque em um tipo para anexar os documentos do motorista. São aceitos PDF, JPG ou PNG até 20MB cada."
      [placeholderCopy]="placeholderCopy"
    />
  `,
})
export class DriverDocumentsCard {
  private readonly driverService = inject(DriverService);

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
   * o input direto — nada de encadear propriedade de objeto possivelmente
   * nulo, que é a forma exata do `TypeError` que já derrubou uma view aqui.
   */
  private readonly showAppRideReceipt = computed(() => this.isAppDriver() === true);

  /**
   * Slots do motorista, NA ORDEM em que aparecem (fixa — um slot que muda de
   * lugar conforme o preenchimento é um slot que o usuário não decora).
   * `required` alimenta o contador "N de M"; `OTHER` fica fora por opcional.
   * As defs são um `computed` porque o portão do extrato é DINÂMICO: o card
   * compartilhado reage à recarga que fecha o portão no meio do gesto.
   */
  protected readonly slotDefs = computed<DocumentSlotDef[]>(() => {
    const gateOpen = this.showAppRideReceipt();
    return [
      {
        kind: 'CNH',
        label: DRIVER_DOCUMENT_KIND_META['CNH'],
        hint: 'Frente e verso.',
        required: true,
      },
      {
        kind: 'ADDRESS_PROOF',
        label: DRIVER_DOCUMENT_KIND_META['ADDRESS_PROOF'],
        hint: 'Conta de luz, água ou internet dos últimos meses.',
        required: true,
      },
      {
        kind: 'INCOME_PROOF',
        label: DRIVER_DOCUMENT_KIND_META['INCOME_PROOF'],
        hint: 'Holerite, extrato bancário ou declaração.',
        required: true,
      },
      {
        kind: 'APP_RIDE_RECEIPT',
        label: DRIVER_DOCUMENT_KIND_META['APP_RIDE_RECEIPT'],
        hint: 'Extrato de corridas do aplicativo.',
        required: true,
        gated: !gateOpen,
        gatedRefusalMessage:
          'Extrato de aplicativo não está disponível para este motorista. ' +
          'Escolha outro tipo e envie de novo.',
      },
      {
        kind: 'OTHER',
        label: DRIVER_DOCUMENT_KIND_META['OTHER'],
        hint: 'Qualquer outro arquivo do motorista.',
        required: false,
      },
    ];
  });

  protected readonly placeholderCopy = DRIVER_DOCUMENT_PLACEHOLDER_COPY;

  protected readonly ops: DocumentsCardOps = {
    list: () => this.driverService.listDocuments(this.driverId()),
    upload: (kind, file) =>
      this.driverService.uploadDocument(this.driverId(), kind as DriverDocumentKind, file),
    remove: (doc) => this.driverService.deleteDocument(this.driverId(), doc.id),
    signedUrl: (doc) => this.driverService.documentSignedUrl(this.driverId(), doc.id),
  };
}
