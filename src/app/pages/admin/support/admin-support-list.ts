import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';

import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import { SupportTicketService } from '../../../services/support-ticket.service';
import { AdminSupportThread } from './admin-support-thread';
import {
  SUPPORT_CHANNEL_LABEL,
  SUPPORT_REPLY_MAX_LENGTH,
  SUPPORT_REPLY_MIN_LENGTH,
  SUPPORT_STATUS_META,
  SupportAssigneeOption,
  SupportCompanyOption,
  SupportTicketAdminDetail,
  SupportTicketAdminItem,
  SupportTicketReply,
  SupportTicketStatus,
} from '../../../types/support.types';

const PAGE_SIZE = 20;

/**
 * Backoffice PLATFORM_ADMIN de tickets de suporte.
 *
 * A listagem mostra empresa e autor por NOME (o backend resolve no read-model),
 * filtra por status e por empresa e pagina. Abrir um ticket expande a thread
 * inline — sem rota de detalhe: o admin triagem várias linhas seguidas e perder
 * o contexto da fila a cada leitura custaria mais que ganharia.
 *
 * Toda mutação (status, resposta, atribuição) devolve `SupportTicketAdminDetail`
 * já atualizado, então a tela nunca recarrega a página inteira depois de agir.
 *
 * **Honestidade do `emailStatus`.** O backend reporta DESPACHO, não entrega:
 * `QUEUED` significa "entregue ao dispatcher" e `SKIPPED` significa "o autor
 * não tem e-mail, ninguém foi avisado". Não existe um terceiro valor para
 * "falhou" — o despacho acontece depois do commit que produz esta resposta, de
 * modo que a requisição não teria como saber. Os textos desta tela — toast
 * incluído — seguem essa distinção; não os troque por "enviado"/"entregue".
 */
@Component({
  selector: 'app-admin-support-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    ActionsMenu,
    FormField,
    FieldControl,
    AdminSupportThread,
  ],
  templateUrl: './admin-support-list.html',
})
export class AdminSupportList implements OnInit {
  private readonly service = inject(SupportTicketService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);

  protected readonly channelLabel = SUPPORT_CHANNEL_LABEL;
  protected readonly statusMeta = SUPPORT_STATUS_META;
  protected readonly replyMaxLength = SUPPORT_REPLY_MAX_LENGTH;

  protected readonly loading = signal(false);
  /** Falha ao CARREGAR a lista — banner no topo, acima dos filtros. */
  protected readonly error = signal<string | null>(null);
  /**
   * Falha da OPERAÇÃO de mudar status, ancorada no ticket que a causou: o banner
   * é renderizado dentro da própria linha, ao lado dos botões de ação. Inline e
   * nunca toast — `messageFor()` reivindica o erro e desarma a rede de segurança.
   */
  protected readonly actionError = signal<{ ticketId: string; message: string } | null>(null);

  protected readonly items = signal<SupportTicketAdminItem[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly statusFilter = signal<SupportTicketStatus | ''>('');
  protected readonly companyFilter = signal('');

  protected readonly companies = signal<SupportCompanyOption[]>([]);
  protected readonly assignees = signal<SupportAssigneeOption[]>([]);

  /** Ticket com a thread aberta. `null` = fila fechada. */
  protected readonly openTicketId = signal<string | null>(null);
  protected readonly detail = signal<SupportTicketAdminDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal<string | null>(null);

  protected readonly replying = signal(false);
  protected readonly replyError = signal<string | null>(null);
  protected readonly assigning = signal(false);
  protected readonly assignError = signal<string | null>(null);

  protected readonly replyMessages: Readonly<Record<string, string>> = {
    required: 'Escreva a resposta antes de enviar.',
    minlength: `A resposta precisa de pelo menos ${SUPPORT_REPLY_MIN_LENGTH} caracteres.`,
    maxlength: `Use no máximo ${SUPPORT_REPLY_MAX_LENGTH} caracteres.`,
  };

  protected readonly replyForm = this.fb.nonNullable.group({
    message: [
      '',
      [
        Validators.required,
        Validators.minLength(SUPPORT_REPLY_MIN_LENGTH),
        Validators.maxLength(SUPPORT_REPLY_MAX_LENGTH),
      ],
    ],
  });

  private readonly replyValue = toSignal(this.replyForm.valueChanges, {
    initialValue: this.replyForm.getRawValue(),
  });

  protected readonly replyLength = computed(() => (this.replyValue()?.message ?? '').length);

  /**
   * Seletor de responsável. É um `FormControl` — e não um signal com `[value]` —
   * porque a UI precisa REVERTER a escolha quando o PUT falha: o ticket não
   * mudou, então o valor volta ao que já estava renderizado e o Angular não
   * emitiria atualização de DOM alguma, deixando o `<select>` mentindo sobre o
   * responsável. O value accessor de reactive forms escreve no DOM sempre.
   */
  protected readonly assigneeControl = this.fb.nonNullable.control('');

  protected readonly openTicket = computed(() => this.detail()?.ticket ?? null);
  protected readonly replies = computed<SupportTicketReply[]>(() => this.detail()?.replies ?? []);

  /** Autor sem e-mail → responder grava a resposta mas não avisa ninguém. */
  protected readonly authorEmail = computed(() => this.openTicket()?.userEmail?.trim() || '');
  protected readonly canEmailAuthor = computed(() => this.authorEmail().length > 0);

  protected readonly replyHint = computed(() =>
    this.canEmailAuthor() ? `Ao enviar, esta mensagem vai por e-mail para ${this.authorEmail()}.` : '',
  );

  /** O rótulo diz o efeito colateral: enviar é mandar e-mail para uma pessoa real. */
  protected readonly replyButtonLabel = computed(() => {
    if (this.replying()) return 'Enviando…';
    return this.canEmailAuthor()
      ? 'Enviar resposta por e-mail ao autor'
      : 'Registrar resposta (sem e-mail)';
  });

  /**
   * Responsável atual que não está na lista de PLATFORM_ADMIN (admin demovido ou
   * lista que não carregou). Sem esta opção o `<select>` mostraria vazio e o
   * admin acharia que o ticket está sem dono.
   */
  protected readonly unlistedAssignee = computed(() => {
    const ticket = this.openTicket();
    if (!ticket?.assignedTo) return null;
    const known = this.assignees().some((a) => a.id === ticket.assignedTo);
    return known ? null : { id: ticket.assignedTo, label: ticket.assignedToName ?? 'Responsável' };
  });

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly hasNext = computed(() => (this.page() + 1) * PAGE_SIZE < this.total());
  protected readonly hasPrev = computed(() => this.page() > 0);
  protected readonly hasFilters = computed(() => !!this.statusFilter() || !!this.companyFilter());

  ngOnInit(): void {
    this.load();
    // Falha nos seletores é silenciosa: a listagem principal segue utilizável.
    this.service.adminCompanies().subscribe({
      next: (list) => this.companies.set(list),
      error: (err: unknown) => this.apiErrors.claim(err),
    });
    this.service.adminAssignees().subscribe({
      next: (list) => this.assignees.set(list),
      error: (err: unknown) => this.apiErrors.claim(err),
    });
  }

  // ------------------------------------------------------------------ listagem

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.actionError.set(null);
    this.service
      .adminList({
        status: this.statusFilter(),
        companyId: this.companyFilter(),
        page: this.page(),
        size: PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.items.set(res.content ?? []);
          this.total.set(res.total ?? 0);
          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar os tickets.'));
          this.loading.set(false);
        },
      });
  }

  protected onStatusFilterChange(status: string): void {
    this.statusFilter.set((status as SupportTicketStatus | '') || '');
    this.resetPageAndReload();
  }

  protected onCompanyFilterChange(companyId: string): void {
    this.companyFilter.set(companyId);
    this.resetPageAndReload();
  }

  protected clearFilters(): void {
    this.statusFilter.set('');
    this.companyFilter.set('');
    this.resetPageAndReload();
  }

  protected nextPage(): void {
    if (!this.hasNext()) return;
    this.page.update((p) => p + 1);
    this.closeTicket();
    this.load();
  }

  protected prevPage(): void {
    if (!this.hasPrev()) return;
    this.page.update((p) => p - 1);
    this.closeTicket();
    this.load();
  }

  /** Mensagem de erro de operação pertencente a esta linha, ou `null`. */
  protected actionErrorFor(ticketId: string): string | null {
    const current = this.actionError();
    return current && current.ticketId === ticketId ? current.message : null;
  }

  protected dismissActionError(): void {
    this.actionError.set(null);
  }

  protected companyLabel(ticket: SupportTicketAdminItem): string {
    return ticket.companyName?.trim() || 'Sem empresa';
  }

  protected authorLabel(ticket: SupportTicketAdminItem): string {
    return ticket.userName?.trim() || ticket.userEmail?.trim() || 'Autor removido';
  }

  protected assigneeLabel(ticket: SupportTicketAdminItem): string {
    return ticket.assignedToName?.trim() || 'Sem responsável';
  }

  protected assigneeOptionLabel(option: SupportAssigneeOption): string {
    return option.name?.trim() || option.email;
  }

  // ------------------------------------------------------------------ thread

  protected toggleTicket(ticket: SupportTicketAdminItem): void {
    if (this.openTicketId() === ticket.id) {
      this.closeTicket();
      return;
    }
    this.openTicketId.set(ticket.id);
    // Mostra o que já se sabe da linha enquanto a thread carrega.
    this.detail.set({ ticket, replies: [] });
    this.syncAssigneeControl();
    this.detailError.set(null);
    this.replyError.set(null);
    this.assignError.set(null);
    this.replyForm.reset({ message: '' });
    this.detailLoading.set(true);
    this.service.adminGet(ticket.id).subscribe({
      next: (res) => {
        if (this.openTicketId() !== ticket.id) return;
        this.applyDetail(res);
        this.detailLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        if (this.openTicketId() !== ticket.id) return;
        this.detailError.set(this.apiErrors.messageFor(err, 'Não foi possível abrir o ticket.'));
        this.detailLoading.set(false);
      },
    });
  }

  protected closeTicket(): void {
    this.openTicketId.set(null);
    this.detail.set(null);
    this.detailError.set(null);
    this.replyError.set(null);
    this.assignError.set(null);
    this.detailLoading.set(false);
    this.replyForm.reset({ message: '' });
    this.assigneeControl.setValue('', { emitEvent: false });
    this.assigneeControl.enable({ emitEvent: false });
  }

  protected isOpen(ticketId: string): boolean {
    return this.openTicketId() === ticketId;
  }

  // ------------------------------------------------------------------ mutações

  protected changeStatus(ticket: SupportTicketAdminItem, next: SupportTicketStatus): void {
    if (ticket.status === next) return;
    this.actionError.set(null);
    this.service.adminUpdateStatus(ticket.id, { status: next }).subscribe({
      next: (res) => {
        this.applyDetail(res);
        this.notifications.success(
          `Ticket movido para "${this.statusMeta[res.ticket.status].label}".`,
        );
      },
      error: (err: HttpErrorResponse) => {
        this.actionError.set({
          ticketId: ticket.id,
          message: this.apiErrors.messageFor(err, 'Falha ao atualizar status.'),
        });
      },
    });
  }

  /**
   * Envia a resposta. Guardado por `replying()` — o clique duplo não vira dois
   * e-mails para a mesma pessoa.
   */
  protected submitReply(): void {
    const ticket = this.openTicket();
    if (!ticket || this.replying()) return;
    if (this.replyForm.invalid) {
      this.replyForm.markAllAsTouched();
      return;
    }

    const message = this.replyForm.getRawValue().message.trim();
    const before = new Set(this.replies().map((r) => r.id));

    this.replying.set(true);
    this.replyError.set(null);
    this.service.adminReply(ticket.id, { message }).subscribe({
      next: (res) => {
        this.applyDetail(res);
        this.replyForm.reset({ message: '' });
        this.replying.set(false);
        this.announceReply(res.replies.find((r) => !before.has(r.id)) ?? null);
      },
      error: (err: HttpErrorResponse) => {
        this.replying.set(false);
        this.replyError.set(this.apiErrors.messageFor(err, 'Não foi possível enviar a resposta.'));
      },
    });
  }

  /**
   * `''` no `<select>` significa "sem responsável" — e isso é um DELETE, não um
   * PUT com campo vazio: o backend exige `assigneeId` no PUT e responde 400 sem
   * ele, justamente para que um corpo malformado não vire uma desatribuição
   * silenciosa.
   */
  protected onAssigneeChange(value: string): void {
    const ticket = this.openTicket();
    if (!ticket || this.assigning()) return;
    this.runAssignment(
      value
        ? this.service.adminAssign(ticket.id, { assigneeId: value })
        : this.service.adminUnassign(ticket.id),
    );
  }

  /**
   * Tronco comum de atribuir e desatribuir: as duas rotas devolvem o mesmo
   * `SupportTicketAdminDetail`, então o sucesso, o erro e a reversão visual do
   * `<select>` são idênticos — só o pedido muda.
   */
  private runAssignment(request$: Observable<SupportTicketAdminDetail>): void {
    this.assigning.set(true);
    this.assignError.set(null);
    // `disable()` em vez de `[disabled]`: mexer no atributo com reactive forms
    // dispara o aviso do Angular e não desabilita o controle de verdade.
    this.assigneeControl.disable({ emitEvent: false });
    request$.subscribe({
      next: (res) => {
        this.applyDetail(res);
        this.assigning.set(false);
        this.assigneeControl.enable({ emitEvent: false });
        this.notifications.success(
          res.ticket.assignedTo
            ? `Responsável definido: ${res.ticket.assignedToName ?? 'administrador'}.`
            : 'Ticket devolvido à fila, sem responsável.',
        );
      },
      error: (err: HttpErrorResponse) => {
        this.assigning.set(false);
        this.assigneeControl.enable({ emitEvent: false });
        // O ticket não mudou: devolve o `<select>` ao responsável real.
        this.syncAssigneeControl();
        this.assignError.set(
          this.apiErrors.messageFor(err, 'Não foi possível definir o responsável.'),
        );
      },
    });
  }

  // ------------------------------------------------------------------ internals

  private resetPageAndReload(): void {
    this.page.set(0);
    this.closeTicket();
    this.load();
  }

  /** Sincroniza a linha da listagem e, se for o ticket aberto, a thread. */
  private applyDetail(res: SupportTicketAdminDetail): void {
    this.items.update((rows) => rows.map((r) => (r.id === res.ticket.id ? res.ticket : r)));
    if (this.openTicketId() !== res.ticket.id) return;
    this.detail.set(res);
    this.syncAssigneeControl();
  }

  /** Alinha o `<select>` ao responsável que o backend confirmou. */
  private syncAssigneeControl(): void {
    this.assigneeControl.setValue(this.openTicket()?.assignedTo ?? '', { emitEvent: false });
  }

  /**
   * O aviso reflete o DESPACHO, nunca a entrega: `QUEUED` diz "despachado" (sem
   * confirmação de chegada) e `SKIPPED` avisa que ninguém foi notificado — e os
   * dois deixam claro que a resposta ficou gravada.
   */
  private announceReply(added: SupportTicketReply | null): void {
    if (added?.emailStatus === 'SKIPPED') {
      this.notifications.warning(
        'Resposta registrada. O autor não tem e-mail cadastrado, então ninguém foi avisado.',
      );
      return;
    }
    this.notifications.success(
      'Resposta registrada e e-mail despachado ao autor. A entrega não é confirmada aqui.',
    );
  }
}
