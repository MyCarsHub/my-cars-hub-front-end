import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import type { ContactChannel, ContactSubjectType, RevealedContact } from '../../../types/admin-contact.types';
import { AdminContactService, withWhatsAppText } from './admin-contact.service';

/**
 * WhatsApp, Ligar e Copiar a partir de um ITEM DE MENU (⋮), para as telas que não mostram
 * botões de contato soltos (Empresas e detalhe, 18/11/2026). Mesmo cuidado de `ContactActions`:
 * o número inteiro só chega pela revelação auditada no toque, a aba do WhatsApp é aberta DENTRO
 * do gesto e a área de transferência recebe uma promessa criada no gesto (Safari).
 */
@Injectable({ providedIn: 'root' })
export class ContactRevealActions {
  private readonly contacts = inject(AdminContactService);
  private readonly notify = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);

  /** Abre o WhatsApp do sujeito com a mensagem pronta (nula = sem texto). */
  async whatsApp(
    subjectType: ContactSubjectType,
    subjectId: string,
    text: string | null,
    contextCompanyId: string | null = null,
  ): Promise<void> {
    const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    const contact = await this.fetch(subjectType, subjectId, 'WHATSAPP', contextCompanyId);
    const link = withWhatsAppText(contact?.waLink ?? null, text);
    if (!link) {
      tab?.close();
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = link;
    } else {
      window.location.href = link;
    }
  }

  async call(subjectType: ContactSubjectType, subjectId: string, contextCompanyId: string | null = null): Promise<void> {
    const contact = await this.fetch(subjectType, subjectId, 'CALL', contextCompanyId);
    if (contact?.telLink) window.location.href = contact.telLink;
  }

  async copy(subjectType: ContactSubjectType, subjectId: string, contextCompanyId: string | null = null): Promise<void> {
    const pending = this.fetch(subjectType, subjectId, 'COPY', contextCompanyId);
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const blob = pending.then((c) => {
          if (!c?.e164) throw new Error('sem telefone');
          return new Blob([c.e164], { type: 'text/plain' });
        });
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      } else {
        const c = await pending;
        if (!c?.e164) return;
        await navigator.clipboard.writeText(c.e164);
      }
      this.notify.success('Telefone copiado.');
    } catch {
      const c = await pending;
      if (c?.e164) this.notify.warning(`Não foi possível copiar. Número: ${c.display}`);
    }
  }

  /** Revela (auditado, com o canal do toque). Nulo = erro ou sem telefone, já avisados. */
  private async fetch(
    subjectType: ContactSubjectType,
    subjectId: string,
    channel: ContactChannel,
    contextCompanyId: string | null,
  ): Promise<RevealedContact | null> {
    try {
      const contact = await firstValueFrom(this.contacts.reveal(subjectType, subjectId, channel, contextCompanyId));
      if (!contact.available) {
        this.notify.warning('Sem telefone válido cadastrado.');
        return null;
      }
      return contact;
    } catch (err) {
      this.notify.error(this.apiErrors.messageFor(err as HttpErrorResponse, 'Não foi possível obter o telefone.'));
      return null;
    }
  }
}
