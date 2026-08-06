import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  SUPPORT_REPLY_EMAIL_STATUS_META,
  SupportTicketReply,
  SupportTicketReplyEmailStatus,
} from '../../../types/support.types';

/**
 * Thread de respostas de um ticket. Componente puro de apresentação — não
 * conhece o service nem o formulário de resposta.
 *
 * O chip de `emailStatus` é deliberadamente honesto: `QUEUED` diz "despachado"
 * (não "enviado"/"entregue") e `SKIPPED` diz que ninguém foi avisado. Nunca
 * deixe o rótulo sugerir confirmação de entrega — o backend não a tem, e por
 * isso mesmo também não tem um estado de "falhou".
 */
@Component({
  selector: 'app-admin-support-thread',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  host: { class: 'block' },
  template: `
    @if (replies().length === 0) {
      <p class="text-sm text-neutral-500">
        Nenhuma resposta ainda. A primeira resposta será enviada ao autor do ticket.
      </p>
    } @else {
      <ol class="space-y-3 list-none">
        @for (reply of replies(); track reply.id) {
          <li class="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <span class="text-sm font-medium text-neutral-900 break-words">
                {{ reply.authorName || 'Administrador removido' }}
              </span>
              <time class="text-[11px] text-neutral-500 tabular-nums" [attr.datetime]="reply.createdDate">
                {{ reply.createdDate | date: 'dd/MM/yyyy HH:mm' }}
              </time>
            </div>

            <p class="text-sm text-neutral-800 mt-1.5 whitespace-pre-wrap break-words">
              {{ reply.message }}
            </p>

            <p class="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                [class]="emailChip(reply.emailStatus)"
              >
                {{ emailLabel(reply.emailStatus) }}
              </span>
              <span class="text-[11px] text-neutral-600 break-words">
                {{ emailHint(reply.emailStatus) }}
              </span>
            </p>
          </li>
        }
      </ol>
    }
  `,
})
export class AdminSupportThread {
  readonly replies = input.required<SupportTicketReply[]>();

  protected emailLabel(status: SupportTicketReplyEmailStatus): string {
    return SUPPORT_REPLY_EMAIL_STATUS_META[status]?.label ?? status;
  }

  protected emailChip(status: SupportTicketReplyEmailStatus): string {
    return SUPPORT_REPLY_EMAIL_STATUS_META[status]?.chip ?? 'bg-neutral-200 text-neutral-800';
  }

  protected emailHint(status: SupportTicketReplyEmailStatus): string {
    return SUPPORT_REPLY_EMAIL_STATUS_META[status]?.hint ?? '';
  }
}
