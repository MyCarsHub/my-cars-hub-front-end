import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { PageCard } from '../../components/core/page-card/page-card';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';
import { InvitesService } from '../../services/invites.service';
import { NotificationService } from '../../services/notification.service';
import { inviteErrorCopy } from '../../services/invite-errors';
import {
  INVITE_TTL_LABEL,
  InviteRole,
} from '../../types/invite.types';
import { companyRoleLabel } from '../../utils/role-labels';
import {
  applyMaskedDocumentInput,
  cpfShapeValidator,
  maskCpf,
  normalizeCpf,
} from '../../utils/document-mask';
import { cpfValidator } from '../../utils/validators/cpf.validator';
import { applyMaskedPhoneInput, normalizePhone } from '../../utils/phone-mask';

/** Mesmo padrao do onboarding (`step-personal`): DDD + numero, com ou sem mascara. */
const PHONE_PATTERN = /^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$|^\d{10,11}$/;

const CREATE_FALLBACK = 'Não foi possível enviar o convite.';

/**
 * Convites — the only route to this page is `/configuracoes/convites`, and the whole
 * `/configuracoes` subtree is `roleGuard(['OWNER'])` (parent and every child). So the
 * only role that reads this list, or sends, resends and cancels from it, is OWNER.
 * MANAGERs no longer invite anyone — an accepted product consequence, not a bug.
 *
 * Two backend facts drive this screen:
 *
 * - `role` may only be MANAGER or DRIVER. OWNER is rejected with a 400, so it is not
 *   offered at all.
 * - `resend` and `cancel` are keyed by the invite UUID. `GET /invites` never returns the
 *   raw token (by design), so the link itself can never be rebuilt here — resending is
 *   the only way to get a working link back to the invitee.
 *
 * The validity window is the BACKEND's, and its name is `InvitesService.INVITE_TTL_DAYS`.
 * No response carries it, so the frontend mirrors it ONCE in `INVITE_TTL_DAYS`
 * (`types/invite.types.ts`) and the copy below interpolates `INVITE_TTL_LABEL`. Read the
 * value from the constant, never from this comment: the previous version of this comment
 * wrote the number down, the backend then changed it, and the screen went on promising a
 * window that had stopped being true. The owner resent live invites because of it — which
 * burns one of the 3 allowed resends and rotates the token, killing the link the invitee
 * already has. If the backend TTL changes, change the constant and nothing else.
 */
@Component({
  selector: 'app-invites',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    FormField,
    FieldControl,
  ],
  templateUrl: './invites.html',
})
export class Invites implements OnInit {
  /**
   * `true` quando este formulario esta DENTRO de outra tela (o painel de Membros) e nao na
   * propria rota. Troca so a MOLDURA: sem `embedded`, o componente desenha o cabecalho de
   * pagina; com `embedded`, entrega so o cartao.
   *
   * O formulario em si — validadores, mascaras, a regra de nome/CPF/telefone por cargo e o
   * envio — e EXATAMENTE o mesmo nos dois lugares, porque e o mesmo componente. Duplicar o
   * formulario para ganhar um painel teria criado duas regras de cargo para divergirem.
   */
  readonly embedded = input(false);

  /** Emitido depois de um convite enviado com sucesso, para a lista de quem hospeda recarregar. */
  readonly sent = output<void>();

  private readonly fb = inject(FormBuilder);
  private readonly invites = inject(InvitesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  protected readonly createError = signal<string | null>(null);
  protected readonly sending = signal(false);

  /** Validity promised in the form copy — mirror of the backend TTL, never a typed number. */
  protected readonly ttlLabel = INVITE_TTL_LABEL;

  protected readonly roles: ReadonlyArray<{ value: InviteRole; label: string }> = [
    { value: 'MANAGER', label: 'Gerenciador' },
    { value: 'DRIVER', label: 'Motorista' },
  ];

  /**
   * O convite de GERENTE nao era um campo faltando: era uma porta fechada.
   *
   * O backend exige `name`, `cpf` e `phone` quando o cargo e MANAGER
   * (`ERROR_MANAGER_DATA_REQUIRED`), e este formulario mandava so `{email, role}`. Como o
   * select SEMPRE ofereceu "Gerenciador", escolher esse cargo produzia 400 em 100% das
   * tentativas — o fluxo de convite de gerente existia no backend e na tela do convidado, e
   * a unica porta de entrada nao conseguia criar um.
   *
   * O proprio `invite.types.ts` ja documentava a regra. O tipo sabia; o formulario nao.
   */
  protected readonly inviteForm = this.fb.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
    role: ['DRIVER' as InviteRole, [Validators.required]],
    name: [''],
    cpf: [''],
    phone: [''],
  });

  protected readonly nameMessages: Readonly<Record<string, string>> = {
    required: 'Informe o nome de quem vai gerenciar.',
    maxlength: 'O nome deve ter no máximo 180 caracteres.',
  };
  protected readonly cpfMessages: Readonly<Record<string, string>> = {
    required: 'Informe o CPF do gerenciador.',
    cpfShape: 'CPF inválido. Use o formato 000.000.000-00.',
    cpfInvalid: 'CPF inválido.',
  };
  protected readonly phoneMessages: Readonly<Record<string, string>> = {
    required: 'Informe o telefone do gerenciador.',
    pattern: 'Telefone inválido. Use DDD + número.',
  };

  /** Só o cargo MANAGER pede os dados pessoais — a tela segue a mesma regra do backend. */
  protected readonly requiresManagerData = computed(() => this.roleValue() === 'MANAGER');

  protected readonly emailMessages: Readonly<Record<string, string>> = {
    required: 'Informe o e-mail de quem você quer convidar.',
    email: 'Informe um e-mail válido.',
    maxlength: 'O e-mail deve ter no máximo 255 caracteres.',
  };

  /** Espelha o cargo num signal para o template e o `computed` reagirem à troca do select. */
  private readonly roleValue = signal<InviteRole>('DRIVER');

  /**
   * Liga e desliga a obrigatoriedade quando o cargo muda, NOS DOIS SENTIDOS.
   *
   * Motorista → Gerenciador acende os três campos sem o usuário precisar tocar neles;
   * o caminho inverso apaga a exigência E os erros, porque `updateValueAndValidity` com os
   * validadores removidos revalida o controle como válido — um erro que ficasse preso na
   * tela pararia um envio de motorista que está perfeitamente correto.
   */
  private syncManagerValidators(role: InviteRole): void {
    const { name, cpf, phone } = this.inviteForm.controls;

    if (role === 'MANAGER') {
      name.setValidators([Validators.required, Validators.maxLength(180)]);
      // O controle guarda TEXTO MASCARADO, então os dois validadores leem TEXTO —
      // `cpfShapeValidator` sobre a máscara e `cpfValidator` sobre os dígitos que ele
      // extrai. Validar isto com algo que espera número enxergaria o campo como vazio, e o
      // sintoma seria "obrigatório ignorado", não "formato inválido".
      cpf.setValidators([Validators.required, cpfShapeValidator(), cpfValidator()]);
      phone.setValidators([Validators.required, Validators.pattern(PHONE_PATTERN)]);
    } else {
      name.clearValidators();
      cpf.clearValidators();
      phone.clearValidators();
    }

    name.updateValueAndValidity({ emitEvent: false });
    cpf.updateValueAndValidity({ emitEvent: false });
    phone.updateValueAndValidity({ emitEvent: false });
  }

  /** Máscara progressiva de CPF, caret preservado — mesma do onboarding. */
  protected onCpfInput(event: Event): void {
    applyMaskedDocumentInput(event, this.inviteForm.controls.cpf, maskCpf);
  }

  /** Máscara progressiva de telefone, caret preservado. */
  protected onPhoneInput(event: Event): void {
    applyMaskedPhoneInput(event, this.inviteForm.controls.phone);
  }
  ngOnInit(): void {
    this.inviteForm.controls.role.valueChanges.subscribe((role) => {
      const next = (role ?? 'DRIVER') as InviteRole;
      this.roleValue.set(next);
      this.syncManagerValidators(next);
    });
  }

  protected send(): void {
    if (this.sending()) return;

    clearServerErrors(this.inviteForm);
    this.createError.set(null);

    // Normalise BEFORE validating. `Validators.email` matches the raw value, so the
    // trailing space that mobile keyboards append after an address would fail the field
    // with "e-mail inválido" on a perfectly good address. Writing the trimmed value back
    // into the control also keeps what the user sees identical to what is sent.
    const emailControl = this.inviteForm.controls.email;
    const trimmed = (emailControl.value ?? '').trim();
    if (trimmed !== emailControl.value) {
      emailControl.setValue(trimmed);
    }

    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }

    const raw = this.inviteForm.getRawValue();
    this.sending.set(true);

    const role = (raw.role ?? 'DRIVER') as InviteRole;
    // DRIVER envia EXATAMENTE o que enviava antes — o backend ignora os três campos nesse
    // cargo, e omiti-los mantém o caminho do motorista byte a byte igual ao de hoje.
    // MANAGER manda dígitos crus; o backend normaliza, mas normalizar aqui é o que o resto
    // do app já faz e não depende disso.
    const payload =
      role === 'MANAGER'
        ? {
            email: raw.email ?? '',
            role,
            name: (raw.name ?? '').trim(),
            cpf: normalizeCpf(raw.cpf ?? ''),
            phone: normalizePhone(raw.phone ?? ''),
          }
        : { email: raw.email ?? '', role };

    this.invites
      .create(payload)
      .subscribe({
        next: (invite) => {
          this.sending.set(false);
          this.inviteForm.reset({ email: '', role: 'DRIVER', name: '', cpf: '', phone: '' });
          // `reset` não dispara `valueChanges` do jeito que o sync espera em todos os
          // casos; realinhar explicitamente evita o formulário voltar exigindo dados de
          // gerente depois de um convite de gerente enviado com sucesso.
          this.roleValue.set('DRIVER');
          this.syncManagerValidators('DRIVER');
          this.notifications.success(`Convite enviado para ${invite.email}.`);
          // Quem hospeda recarrega: a linha nova tem de aparecer como 'Convite enviado'.
          this.sent.emit();
        },
        error: (err: HttpErrorResponse) => {
          this.sending.set(false);
          this.handleCreateError(err);
        },
      });
  }

  /**
   * 400 carries `fieldErrors` (invalid or blank e-mail, unsupported role) and belongs
   * inline on the control. 403 / 409 / 410 / 429 have no field to attach to, so the
   * invite-specific copy goes to the banner.
   *
   * 403 is also toasted by `errorInterceptor` as a bare "Acesso negado" — the banner is
   * kept anyway because that toast never says WHICH permission is missing or who can
   * grant it. The OWNER-only `roleGuard` on the route does not make a 403 unreachable:
   * the backend remains the authority and can reject on its own terms — a role revoked
   * or a tenant switched mid-session, a plan rule, an invite already resolved elsewhere.
   */
  private handleCreateError(err: HttpErrorResponse): void {
    const specific = inviteErrorCopy(err, 'manage');
    if (specific) {
      this.apiErrors.claim(err);
      this.createError.set(specific);
      return;
    }
    const result = this.apiErrors.handleForm(err, this.inviteForm, CREATE_FALLBACK);
    this.createError.set(result.formMessage);
  }

  private messageFor(err: HttpErrorResponse, fallback: string): string {
    this.apiErrors.claim(err);
    return inviteErrorCopy(err, 'manage') ?? this.apiErrors.messageFor(err, fallback);
  }
}
