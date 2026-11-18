import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { StatusChip, type StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { whenExact, whenLong } from '../audit/admin-when';
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
  imports: [StatusChip],
  host: { class: 'block' },
  template: `
    @if (replies().length === 0) {
      <p class="text-sm text-fg-subtle">
        Nenhuma resposta ainda. A primeira resposta será enviada ao autor do ticket.
      </p>
    } @else {
      <ol class="space-y-3 list-none">
        @for (reply of replies(); track reply.id) {
          <li class="rounded-xl bg-surface dark:bg-surface-sunken p-3">
            <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <span class="text-sm font-medium text-fg break-words">
                {{ reply.authorName || 'Administrador removido' }}
              </span>
              <time
                class="text-xs text-fg-subtle tabular-nums"
                [attr.datetime]="reply.createdDate"
                [attr.title]="long(reply.createdDate)"
              >
                {{ exact(reply.createdDate) }}
              </time>
            </div>

            <p class="text-sm text-fg-body mt-1.5 whitespace-pre-wrap break-words">
              {{ reply.message }}
            </p>

            <p class="mt-2 flex flex-wrap items-center gap-1.5">
              <app-status-chip size="sm" [tone]="emailTone(reply.emailStatus)">
                {{ emailLabel(reply.emailStatus) }}
              </app-status-chip>
              <span class="text-xs text-fg-muted break-words">
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

  /** Despachado é azul (feito, sem confirmação de entrega); sem e-mail fica neutro. */
  protected emailTone(status: SupportTicketReplyEmailStatus): StatusChipTone {
    return status === 'QUEUED' ? 'blue' : 'neutral';
  }

  /** Horário de Brasília: o servidor manda UTC sem sufixo. */
  protected exact(value: string | null): string {
    return whenExact(value) ?? '—';
  }

  protected long(value: string | null): string | null {
    return whenLong(value);
  }

  protected emailHint(status: SupportTicketReplyEmailStatus): string {
    return SUPPORT_REPLY_EMAIL_STATUS_META[status]?.hint ?? '';
  }
}
