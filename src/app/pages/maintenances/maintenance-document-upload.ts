import { MaintenanceDocumentKind } from '../../types/maintenance.types';

/**
 * As regras de arquivo (allowlist, teto, `accept`, formatação) moram na FONTE
 * ÚNICA `components/documents/document-file-rules.ts` desde o FIX-0231, e a
 * cópia inline do card morreu na adoção (FIX-0233). Este arquivo guarda apenas
 * o tipo do item pendente do formulário de cadastro.
 */

/**
 * Um arquivo escolhido no cadastro e ainda NÃO enviado.
 *
 * O `uid` existe porque o envio é sequencial e cada sucesso remove o seu item
 * da fila: sem uma identidade estável, um reenvio depois de falha parcial não
 * saberia quais arquivos já subiram e mandaria tudo de novo, duplicando anexo.
 */
export interface PendingMaintenanceDoc {
  uid: string;
  file: File;
  kind: MaintenanceDocumentKind;
}
