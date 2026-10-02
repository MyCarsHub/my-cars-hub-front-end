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
import { RouterLink } from '@angular/router';
import { Invites } from '../../invites/invites';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { PageCard } from '../../../components/core/page-card/page-card';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../../services/api-error.service';
import { CompanyMembersService } from '../../../services/company-members.service';
import { InvitesService } from '../../../services/invites.service';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';
import { CompanyMemberResponse } from '../../../types/company-member.types';
import { InviteResponse } from '../../../types/invite.types';
import { companyRoleLabel } from '../../../utils/role-labels';

/** O que a linha representa — e o que decide quais acoes ela oferece. */
type PersonKind = 'member' | 'invite';

/**
 * Uma linha da lista de pessoas: quem JA tem acesso e quem foi convidado, lado a lado.
 *
 * `id` e o identificador para as acoes e muda de significado conforme o `kind`: o `userId`
 * do membro, ou o UUID do convite. Os dois endpoints sao chaveados por ids diferentes, e
 * misturar os dois foi o erro que este campo unico torna impossivel de escrever sem querer.
 */
interface PersonRow {
  kind: PersonKind;
  id: string;
  /**
   * O que identifica a pessoa na tela. Membro tem nome; CONVIDADO SO TEM E-MAIL — a
   * resposta de `GET /invites` nao devolve `name`, nem quando o convite foi criado com um.
   * Nao ha nome a inventar, e o estado da linha e o que explica a ausencia.
   */
  title: string;
  /** Segunda linha: o e-mail do membro, ou vazio na linha de convite, onde ele e o titulo. */
  subtitle: string;
  roleLabel: string;
  stateLabel: string;
  stateClass: string;
  /** Rotulo da data, que muda de sentido: "com acesso desde" x "expira em". */
  dateLabel: string;
  date: string;
  canRemove: boolean;
  canResend: boolean;
  canCancel: boolean;
  /** Por que nao ha acao, quando nao ha — a ausencia e explicada, nao silenciosa. */
  lockedReason: string;
  removeLabel: string;
}

const STATE_ACTIVE = 'bg-emerald-50 text-emerald-700 border-emerald-100';
const STATE_PENDING = 'bg-amber-50 text-amber-700 border-amber-100';
const STATE_EXPIRED = 'bg-neutral-100 text-neutral-700 border-neutral-200';

/**
 * Pessoas da empresa — UMA lista com quem tem acesso e quem foi convidado.
 *
 * ## Por que uma lista e nao duas telas
 *
 * Quem convidou alguem ha dois dias nao sabia em qual das duas telas procurar. A pessoa
 * convidada nao e um objeto diferente de um membro: e o MESMO objeto num estado anterior.
 * Duas telas modelavam o banco; uma lista modela como a pessoa pensa. O padrao e o de todo
 * SaaS de equipe, e nao preferencia.
 *
 * ## A juncao, e o defeito que ela evita
 *
 * Duas fontes que JA existiam, sem endpoint novo e sem chamada caras: o roster
 * (`GET /companies/{id}/members`, sempre ACTIVE) e a lista de convites (`GET /invites`).
 *
 * **Convite ACEITO nao entra.** Ele e a mesma pessoa que o roster ja devolve, e juntar a
 * lista crua pintaria cada pessoa que entrou por convite DUAS vezes — uma como membro e
 * outra como convite aceito. Pareceria defeito de dados e seria defeito de juncao.
 *
 * ## EXPIRADO vem pronto do servidor, e isso foi medido
 *
 * `GET /invites` DERIVA o estado expirado na leitura
 * (`CASE WHEN status = 'PENDING' AND expires_at <= NOW()`), porque a coluna e escrita de
 * forma preguicosa — so o aceite autenticado a grava. Entao esta tela NAO precisa comparar
 * datas: o `status` que chega ja diz a verdade. Derivar aqui tambem seria uma segunda regra
 * para a mesma pergunta, e as duas divergiriam.
 *
 * ## As acoes do convite expirado, medidas e nao supostas
 *
 * REENVIAR funciona em convite expirado: `RESENDABLE_STATUSES` do backend e
 * `[PENDING, EXPIRED]` e o UPDATE do reenvio aceita os dois status. CANCELAR tambem — o
 * cancelamento so recusa convite ACEITO. Por isso a linha expirada oferece as DUAS acoes,
 * e nao e escondida: esconder faria quem administra acreditar que a pessoa ainda esta
 * pendente, ou nao saber que ela nunca entrou.
 *
 * ## Ordem
 *
 * Convites primeiro (expirados antes dos pendentes), depois os membros por nome. Quem abre
 * esta tela abre para AGIR: so a linha de convite tem prazo e pede acao; membro ativo nao
 * pede nada. Ordenar tudo por nome misturaria o que precisa de acao com o que nao precisa.
 */
@Component({
  selector: 'app-company-members',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, Invites, DefaultPageLayout, PageCard, AlertBanner, ConfirmDialog],
  templateUrl: './members.html',
})
export class CompanyMembers implements OnInit {
  private readonly members = inject(CompanyMembersService);
  private readonly invites = inject(InvitesService);
  private readonly session = inject(SessionService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  protected readonly loading = computed(() => this.members.loading() || this.invites.loading());
  protected readonly loaded = computed(() => this.members.loaded() && this.invites.loaded());

  protected readonly listError = signal<string | null>(null);
  /** Id da linha com acao em voo — desabilita so aquela linha. */
  protected readonly busyId = signal<string | null>(null);
  protected readonly pendingRemoval = signal<PersonRow | null>(null);
  protected readonly pendingCancel = signal<PersonRow | null>(null);

  /**
   * Quem pode gerenciar pessoas, lido do TOKEN — a mesma fonte do `roleGuard`.
   *
   * Terceira barreira, nao a primeira: a rota tem `roleGuard(['OWNER', 'MANAGER'])` e o
   * backend responde 403 ao motorista nas duas fontes. Ela ganha o lugar pelo que RENDERIZA
   * — uma frase em vez de duas chamadas falhando.
   */
  protected readonly canManagePeople = computed(() => {
    const role = this.session.getCompanyRoleFromToken();
    return role === 'OWNER' || role === 'MANAGER';
  });

  protected readonly rows = computed<PersonRow[]>(() => {
    const myId = this.session.getItem('id');
    const memberRows = this.members.members().map((m) => this.toMemberRow(m, myId));
    memberRows.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));

    /*
     * A juncao e por STATUS, e sozinha ela deixa passar um caso: quem JA e membro ativo e
     * tem um convite PENDENTE aparece duas vezes, uma em cada estado. O dedupe por E-MAIL
     * fecha isso, e a linha do MEMBRO ganha — ela e a autoridade, porque o acesso ja existe
     * e o convite redundante nao concede nada.
     *
     * Raro por construcao: `createInvite` do backend nao deixa nascer convite para quem tem
     * vinculo vivo. Sobra linha legada e corrida. Custa duas linhas, entao e aqui e nao num
     * no proprio.
     */
    const activeEmails = new Set(
      this.members.members().map((m) => m.email.trim().toLowerCase()),
    );
    const pending = this.invites
      .invites()
      // ACEITO fica de fora: e a mesma pessoa que o roster ja traz. CANCELADO e REVOGADO
      // tambem — nao ha ninguem esperando do outro lado.
      .filter((i) => i.status === 'PENDING' || i.status === 'EXPIRED')
      .filter((i) => !activeEmails.has((i.email ?? '').trim().toLowerCase()));
    // Expirado antes de pendente: e o convite que JA falhou, e o unico que nao vai
    // resolver sozinho. Ordenado pelo STATUS, nao pelo rotulo — comparar o texto da tela
    // amarraria a ordem a uma decisao de copy.
    const inviteRows = [
      ...pending.filter((i) => i.status === 'EXPIRED'),
      ...pending.filter((i) => i.status === 'PENDING'),
    ].map((i) => this.toInviteRow(i));

    return [...inviteRows, ...memberRows];
  });

  protected readonly isEmpty = computed(() => this.loaded() && this.rows().length === 0);
  protected readonly activeCount = computed(() => this.members.members().length);

  /**
   * O painel de convite abre AQUI, nao em outra pagina.
   *
   * Bloco que expande, e nao modal nem gaveta: no celular um modal com seis campos cobre a
   * tela inteira e tira a lista de vista, e e a lista que diz se o convite chegou. O bloco
   * empurra a lista para baixo e os dois continuam na mesma rolagem.
   */
  protected readonly inviteOpen = signal(false);

  /**
   * OS QUATRO NUMEROS, e todos saem do que a tela JA carregou — duas listas, zero chamada
   * nova. Medido antes de escrever: convite tem `status`, membro tem `role`.
   *
   * `invites()` traz TODOS os status, e e por isso que "aceitos" existe: ele nao aparece na
   * lista de linhas (convite aceito e a pessoa que o roster ja devolve) mas e contavel, e e
   * exatamente o numero que responde "quantos convites viraram gente".
   */
  protected readonly pendingInvitesCount = computed(
    () => this.invites.invites().filter((i) => i.status === 'PENDING').length,
  );
  protected readonly acceptedInvitesCount = computed(
    () => this.invites.invites().filter((i) => i.status === 'ACCEPTED').length,
  );
  protected readonly managersCount = computed(
    () => this.members.members().filter((m) => m.role === 'MANAGER').length,
  );
  protected readonly driversCount = computed(
    () => this.members.members().filter((m) => m.role === 'DRIVER').length,
  );
  protected readonly invitedCount = computed(
    () => this.rows().filter((r) => r.kind === 'invite').length,
  );

  ngOnInit(): void {
    if (!this.canManagePeople()) {
      return;
    }
    this.load();
  }

  /**
   * Recarrega as DUAS fontes.
   *
   * O botao existe porque a mensagem do 404 pede para atualizar, e porque esta tela nao
   * mostra QUANDO a lista foi carregada — entao lista velha e lista atual sao
   * indistinguiveis. Vale tambem quando outra pessoa remove alguem com a tela aberta.
   */
  protected load(): void {
    this.listError.set(null);
    this.members.list().subscribe({
      error: (error: HttpErrorResponse) => this.listError.set(this.listMessage(error)),
    });
    this.invites.list().subscribe({
      error: (error: HttpErrorResponse) => this.listError.set(this.listMessage(error)),
    });
  }

  protected toggleInvite(): void {
    this.inviteOpen.update((open) => !open);
  }

  /**
   * Convite enviado de dentro desta tela: fecha o painel e RELE os convites, para a linha
   * nova aparecer como "Convite enviado" sem a pessoa precisar atualizar nada.
   *
   * So os convites: enviar convite nao mexe no roster.
   */
  protected onInviteSent(): void {
    this.inviteOpen.set(false);
    this.invites.list().subscribe({
      error: (error: HttpErrorResponse) => this.listError.set(this.listMessage(error)),
    });
  }

  protected askRemove(row: PersonRow): void {
    if (row.canRemove) this.pendingRemoval.set(row);
  }

  protected dismissRemove(): void {
    this.pendingRemoval.set(null);
  }

  protected askCancel(row: PersonRow): void {
    if (row.canCancel) this.pendingCancel.set(row);
  }

  protected dismissCancel(): void {
    this.pendingCancel.set(null);
  }

  protected confirmRemove(): void {
    const row = this.pendingRemoval();
    if (!row) return;
    this.pendingRemoval.set(null);
    this.busyId.set(row.id);
    this.listError.set(null);
    this.members.remove(row.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.notifications.success(row.title + ' perdeu o acesso a esta empresa.');
      },
      error: (error: HttpErrorResponse) => {
        this.busyId.set(null);
        this.listError.set(this.removeMessage(error, row));
      },
    });
  }

  protected confirmCancel(): void {
    const row = this.pendingCancel();
    if (!row) return;
    this.pendingCancel.set(null);
    this.busyId.set(row.id);
    this.listError.set(null);
    this.invites.cancel(row.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.notifications.success('O convite de ' + row.title + ' foi cancelado.');
      },
      error: (error: HttpErrorResponse) => {
        this.busyId.set(null);
        this.listError.set(this.inviteActionMessage(error, row));
      },
    });
  }

  /**
   * Reenviar nao pede confirmacao, mas o aviso de sucesso diz o que mudou: o link ANTIGO
   * para de funcionar, porque o reenvio rotaciona o token. Quem reenvia precisa saber que
   * o link que a pessoa talvez tenha no WhatsApp acabou de morrer.
   */
  protected resend(row: PersonRow): void {
    if (!row.canResend) return;
    this.busyId.set(row.id);
    this.listError.set(null);
    this.invites.resend(row.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.notifications.success(
          'Novo convite enviado para ' + row.title + '. O link anterior deixou de valer.',
        );
        /*
         * HIGH-2 — RELER, nao adivinhar. O servidor rotaciona o token E move o `expiresAt`.
         * Sem esta releitura a linha fica com a data e o rotulo antigos, entao "Convite
         * expirado" PERMANECE na tela depois de um reenvio BEM-SUCEDIDO — e quem administra
         * reenvia outra vez. Cada tentativa queima 1 dos 3 reenvios e mata o link anterior,
         * entao a pessoa do outro lado recebe tres e-mails e so o ultimo funciona.
         *
         * So a fonte de CONVITES e relida: um reenvio nao muda o roster.
         */
        this.invites.list().subscribe({
          error: (err: HttpErrorResponse) => this.listError.set(this.listMessage(err)),
        });
      },
      error: (error: HttpErrorResponse) => {
        this.busyId.set(null);
        this.listError.set(this.inviteActionMessage(error, row));
      },
    });
  }

  private toMemberRow(member: CompanyMemberResponse, myId: string | null): PersonRow {
    const isSelf = myId !== null && myId === member.userId;
    const isOwner = member.role === 'OWNER';
    return {
      kind: 'member',
      id: member.userId,
      title: member.name,
      subtitle: member.email,
      roleLabel: companyRoleLabel(member.role),
      stateLabel: 'Com acesso',
      stateClass: STATE_ACTIVE,
      dateLabel: 'Com acesso desde',
      date: member.memberSince,
      canRemove: !isSelf && !isOwner,
      canResend: false,
      canCancel: false,
      lockedReason: this.lockedReason(isSelf, isOwner),
      removeLabel: 'Remover acesso de ' + member.name,
    };
  }

  private toInviteRow(invite: InviteResponse): PersonRow {
    const expired = invite.status === 'EXPIRED';
    return {
      kind: 'invite',
      id: invite.id,
      // O e-mail E o identificador aqui: nao ha nome na resposta da lista.
      title: invite.email,
      subtitle: '',
      roleLabel: companyRoleLabel(invite.role),
      stateLabel: expired ? 'Convite expirado' : 'Convite enviado',
      stateClass: expired ? STATE_EXPIRED : STATE_PENDING,
      dateLabel: expired ? 'Expirou em' : 'Expira em',
      date: invite.expiresAt,
      canRemove: false,
      // Medido no backend: reenvio aceita PENDING e EXPIRED; cancelamento recusa so ACEITO.
      canResend: true,
      canCancel: true,
      lockedReason: '',
      removeLabel: '',
    };
  }

  private lockedReason(isSelf: boolean, isOwner: boolean): string {
    if (isSelf && isOwner) {
      return 'Você é o dono desta empresa e não pode remover o seu próprio acesso.';
    }
    if (isSelf) return 'Você não pode remover o seu próprio acesso.';
    if (isOwner) return 'O acesso do dono da empresa não pode ser removido aqui.';
    return '';
  }

  private listMessage(error: HttpErrorResponse): string {
    if (error.status === 403) {
      return 'Só o dono e os gerenciadores podem ver quem tem acesso a esta empresa.';
    }
    if (error.status === 404) {
      return 'Empresa não encontrada para esta sessão. Entre novamente e tente de novo.';
    }
    return this.apiErrors.messageFor(error, 'Não foi possível carregar as pessoas da empresa.');
  }

  /**
   * O 404 do backend e AMBIGUO de proposito — cobre usuario inexistente, membro de outra
   * empresa e vinculo JA removido. A copy nao afirma qual foi: diz que o acesso nao esta
   * mais la e pede para atualizar, verdade nos tres casos.
   */
  private removeMessage(error: HttpErrorResponse, row: PersonRow): string {
    if (error.status === 403) {
      return 'Você não tem permissão para remover o acesso de ' + row.title + '.';
    }
    if (error.status === 409) {
      return 'Esta empresa ficaria sem dono. Não é possível remover o último dono.';
    }
    if (error.status === 404) {
      return row.title + ' já não tem acesso a esta empresa. Atualize a lista.';
    }
    return this.apiErrors.messageFor(error, 'Não foi possível remover o acesso.');
  }

  /**
   * HIGH-1 — 410 e 404 NAO sao a mesma resposta e nao pedem a mesma acao:
   *
   * - **410 e EXPIRADO**, e expirado se RECUPERA por reenvio: o backend aceita reenviar um
   *   convite expirado (`RESENDABLE_STATUSES` = PENDING + EXPIRED). Mandar "atualize a
   *   lista" aqui esconde a acao que resolve.
   * - **404 e NUNCA EXISTIU** — ou e de outra empresa, ou ja foi cancelado. Nao ha o que
   *   reenviar; o que resolve e recarregar e convidar de novo.
   *
   * As duas frases dividiam uma linha, e a frase era a do 404. O spec que pegava isso
   * (`410 no reenvio fala em expirado, nao em inexistente`) saiu no MESMO diff que
   * introduziu a inversao — ver o caso que o repoe em `members.spec.ts`.
   */
  private inviteActionMessage(error: HttpErrorResponse, row: PersonRow): string {
    if (error.status === 410) {
      return 'O convite de ' + row.title + ' expirou. Use Reenviar convite para enviar um novo.';
    }
    if (error.status === 404) {
      return 'Este convite já não existe. Atualize a lista e convide a pessoa de novo.';
    }
    if (error.status === 409) {
      return 'Este convite já foi utilizado por ' + row.title + '. Atualize a lista.';
    }
    // 400 do teto de reenvios vem com a frase do servidor, que nomeia o limite.
    return this.apiErrors.messageFor(error, 'Não foi possível concluir a ação neste convite.');
  }
}
