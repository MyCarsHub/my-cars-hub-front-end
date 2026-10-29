import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  ContactChannel,
  ContactSubjectType,
  RevealedContact,
} from '../../../types/admin-contact.types';

const API = `${environment.apiUrl}/admin/contacts/reveal`;

/**
 * Admin v2 (D1): o número inteiro só chega pela revelação AUDITADA. As listas
 * recebem `phoneMasked` do servidor e nada mais — a máscara não é cosmética.
 */
@Injectable({ providedIn: 'root' })
export class AdminContactService {
  private readonly http = inject(HttpClient);

  /**
   * `contextCompanyId`: a empresa que o admin está vendo. Para um USUÁRIO sem
   * telefone próprio, o servidor prefere o cadastro de motorista dele NESSA
   * empresa; só ordena, não amplia o que pode ser lido. Omitido quando não há.
   */
  reveal(
    subjectType: ContactSubjectType,
    subjectId: string,
    channel: ContactChannel,
    contextCompanyId?: string | null,
  ): Observable<RevealedContact> {
    const body = contextCompanyId
      ? { subjectType, subjectId, channel, contextCompanyId }
      : { subjectType, subjectId, channel };
    return this.http.post<RevealedContact>(API, body);
  }
}

/**
 * `?text=` com espaço como %20 (o `encodeURIComponent` já faz isso). Link sem
 * número continua sem número: nunca monta um wa.me vazio.
 */
export function withWhatsAppText(waLink: string | null, text: string | null | undefined): string | null {
  if (!waLink) return null;
  if (!text || !text.trim()) return waLink;
  return `${waLink}?text=${encodeURIComponent(text.trim())}`;
}

/** `mailto:` só com endereço; nada de corpo pré-preenchido com dado do cliente. */
export function mailtoLink(email: string | null | undefined): string | null {
  return email ? `mailto:${email}` : null;
}
