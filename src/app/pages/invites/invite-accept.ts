import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { AuthService } from '../../services/auth.service';
import { InvitesService } from '../../services/invites.service';
import { LoginService } from '../../services/loginService';
import { SessionService } from '../../services/session.service';
import { InviteAcceptCause, inviteAcceptCause, inviteErrorCopy } from '../../services/invite-errors';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import {
  applyMaskedDocumentInput,
  cpfShapeValidator,
  maskCpf,
  normalizeCpf,
} from '../../utils/document-mask';
import { cpfValidator } from '../../utils/validators/cpf.validator';
import { applyMaskedPhoneInput, maskPhone, normalizePhone } from '../../utils/phone-mask';

import {
  AcceptInviteRequest,
  DriverAcceptInviteRequest,
  ValidateInviteResponse,
} from '../../types/invite.types';
import { LicenseCategory } from '../../types/driver.types';
import { CepLookupResult, CepService } from '../../services/cep.service';
import { applyMaskedCepInput, normalizeCep } from '../../utils/cep-mask';
import { PENDING_INVITE_TOKEN_KEY } from './invite-session';
import { companyRoleLabel } from '../../utils/role-labels';

/** Só o corpo do motorista traz CNH — é o que separa os dois formulários no erro. */
function isDriverPayload(
  payload: AcceptInviteRequest | DriverAcceptInviteRequest,
): payload is DriverAcceptInviteRequest {
  return 'licenseNumber' in payload;
}

/** Mesmo padrao do onboarding (`step-personal`): DDD + numero, com ou sem mascara. */
const PHONE_PATTERN = /^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$|^\d{10,11}$/;

type AcceptStep =
  | 'validating'
  | 'ready'
  | 'onboarding'
  | 'driver-onboarding'
  | 'accepting'
  | 'mismatch'
  | 'error';

/**
 * Public landing page for the invitation e-mail.
 *
 * The link the backend mails is `{frontendUrl}/invite/accept?token={rawToken}` — this
 * component's route MUST keep that exact shape, path and query-param name included, or
 * every invitation already sent lands on a 404.
 *
 * Flow, in the order the backend was designed for:
 *
 *   1. `GET /invites/validate/{token}` — anonymous, so the invitee sees WHICH company
 *      invited them before being asked to log in.
 *   2. Google login. The raw token is stashed in sessionStorage first; `OauthSuccess`
 *      reads it back and returns here instead of going to the dashboard.
 *   3. `POST /invites/accept/{token}` with the fresh (TEMPORALLY) token.
 *   4. The response carries a company-scoped ACCESS token, which is persisted verbatim.
 *
 * Step 4 deliberately does NOT call `/auth/select-company` nor `/auth/me`: the accept
 * response is already scoped to the right company, while `/auth/me` would (a) pick an
 * OWNER company first and silently drop the invitee into the wrong tenant, and (b) be
 * subject to the read-your-writes lag documented in `AuthService.writeSession`.
 *
 * Lives OUTSIDE the authenticated shell — its whole point is being reachable logged out.
 */
@Component({
  selector: 'app-invite-accept',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage, RouterLink, AlertBanner, ReactiveFormsModule, FormField, FieldControl],
  templateUrl: './invite-accept.html',
})
export class InviteAccept implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly invites = inject(InvitesService);
  private readonly session = inject(SessionService);
  private readonly auth = inject(AuthService);
  private readonly loginService = inject(LoginService);
  private readonly apiErrors = inject(ApiErrorService);

  private token = '';

  protected readonly step = signal<AcceptStep>('validating');
  protected readonly details = signal<ValidateInviteResponse | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly redirecting = signal(false);
  /** E-mail da sessão aberta nesta aba, só quando ele diverge do convidado. */
  protected readonly signedInEmail = signal('');

  protected readonly companyName = computed(() => this.details()?.companyName ?? '');
  protected readonly invitedEmail = computed(() => this.details()?.email ?? '');
  protected readonly roleLabel = computed(() => {
    const role = this.details()?.role;
    return role ? companyRoleLabel(role) : '';
  });

  /** Returning users "entram"; brand-new ones are really creating an account. */
  protected readonly ctaLabel = computed(() =>
    this.details()?.userExists ? 'Entrar com o Google' : 'Criar conta com o Google',
  );

  /** Qual causa produziu o erro do aceite (FIX-0555/FEAT-0167); `null` para os demais erros. */
  private readonly acceptCause = signal<InviteAcceptCause | null>(null);

  private readonly fb = inject(FormBuilder);

  /** Erro do servidor mostrado DENTRO do formulário, sem derrubar a tela (FEAT-0167). */
  protected readonly onboardingError = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected readonly nameMessages: Readonly<Record<string, string>> = {
    required: 'Informe seu nome completo.',
  };
  protected readonly cpfMessages: Readonly<Record<string, string>> = {
    required: 'Informe seu CPF.',
    cpfShape: 'CPF inválido. Use o formato 000.000.000-00.',
    cpfInvalid: 'CPF inválido.',
    cpfMismatch: 'Este CPF não confere com o do convite.',
  };
  protected readonly phoneMessages: Readonly<Record<string, string>> = {
    required: 'Informe seu telefone.',
    pattern: 'Telefone inválido. Use DDD + número.',
  };

  /**
   * FEAT-0167 — o que o convidado GERENTE confirma antes de virar membro.
   *
   * Nome e telefone chegam pré-preenchidos do convite. O CPF NÃO: a rota de validação é
   * ANÔNIMA, quem tem o link lê a resposta, e por isso o backend não devolve o CPF nem
   * mascarado. O convidado digita, e o servidor compara com o cofre. Não há o que
   * pré-preencher aqui — a ausência é a decisão, não uma lacuna.
   */
  protected readonly onboardingForm = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
    cpf: ['', [Validators.required, cpfShapeValidator(), cpfValidator()]],
    phone: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
  });

  /**
   * A validated invite that failed on accept is recoverable by logging in as the invited
   * e-mail — the usual cause is being signed in as somebody else in this tab.
   *
   * FIX-0555 — MENOS quando a causa é a falta de cadastro de motorista. Aí trocar de conta
   * não resolve nada: a ação é do gestor, e oferecer o botão empurra o convidado a repetir
   * a tentativa e falhar igual, que foi o que aconteceu em produção.
   */
  protected readonly canSwitchAccount = computed(
    () =>
      this.step() === 'error' &&
      this.details() !== null &&
      this.acceptCause() !== 'driver-identity-missing',
  );

  ngOnInit(): void {
    const token = (this.route.snapshot.queryParamMap.get('token') ?? '').trim();

    if (!token) {
      this.errorMessage.set(
        'Link de convite inválido. Abra o link exatamente como ele chegou no seu e-mail.',
      );
      this.step.set('error');
      return;
    }

    this.token = token;
    // Re-stash on every entry: `SessionService.clear()` (logout, oauth-success) wipes it,
    // and the query param is the only place it survives for sure.
    this.session.setItem(PENDING_INVITE_TOKEN_KEY, token);

    this.invites.validate(token).subscribe({
      next: (details) => {
        this.details.set(details);
        // Coming back from Google there is already a token — finish without a second click.
        if (this.session.getToken()) {
          this.acceptOrReportMismatch(details);
          return;
        }
        this.step.set('ready');
      },
      error: (err: unknown) =>
        this.fail(err, 'Não foi possível verificar este convite. Tente novamente.'),
    });
  }

  /** Stashes the token and hands the tab to Google. */
  protected continueWithGoogle(): void {
    if (this.redirecting()) return;
    this.redirecting.set(true);
    this.session.setItem(PENDING_INVITE_TOKEN_KEY, this.token);
    this.loginService.loginWithGoogle();
  }

  /** Drops the current (wrong) session and restarts the Google flow for this invite. */
  protected switchAccount(): void {
    if (this.redirecting()) return;
    this.auth.logout();
    this.continueWithGoogle();
  }

  /**
   * Há token nesta aba — mas de QUEM?
   *
   * O caso real: o link do convite é aberto no mesmo navegador onde o proprietário já
   * está logado, e o convidado é uma segunda conta da mesma pessoa. Aceitar às cegas
   * gastava o convite contra a conta errada e voltava 400 do backend. A divergência é
   * detectável aqui — os dois e-mails já estão em mãos.
   *
   * Comparação sem caixa e sem espaços: o backend normaliza dos dois lados.
   *
   * Sessão SEM `email` guardado não é divergência: é exatamente o que a volta do Google
   * produz no fluxo de convite (`OauthSuccess` zera a sessão e pula o `/auth/me`). Sem
   * e-mail para comparar, seguimos com o aceite e o backend continua sendo a autoridade
   * — o caminho de erro com "Entrar com outra conta" segue existindo para esse caso.
   */
  private acceptOrReportMismatch(details: ValidateInviteResponse): void {
    const signedIn = (this.session.getItem('email') ?? '').trim();
    const invited = (details.email ?? '').trim();

    if (signedIn && invited && signedIn.toLowerCase() !== invited.toLowerCase()) {
      this.signedInEmail.set(signedIn);
      this.step.set('mismatch');
      return;
    }

    // FEAT-0167 — o gerente confirma os dados ANTES do aceite; o motorista segue direto,
    // sem corpo, exatamente como sempre foi.
    if (details.requiresManagerOnboarding === true) {
      this.startOnboarding(details);
      return;
    }

    // O MOTORISTA NÃO TEM FLAG, E ISSO É DELIBERADO — não é assimetria por esquecimento.
    //
    // `requiresManagerOnboarding` é barato: o backend o deriva de `role == MANAGER`, um
    // campo que já vem nesta mesma resposta. Não consulta nada e não revela nada.
    //
    // A pergunta equivalente para o motorista — "esta empresa já tem motorista com este
    // e-mail?" — só se responde LENDO A TABELA DE MOTORISTAS, e este endpoint é PÚBLICO:
    // responde a quem só tem um link, sem autenticação. Publicar esse flag seria abrir uma
    // leitura sobre o cadastro do tenant para qualquer portador de link.
    //
    // O espelho "perfeito" (flag = role == DRIVER, sem consulta) foi RECUSADO por piorar o
    // caminho principal: o motorista convidado a partir do próprio cadastro JÁ TEM tudo, e
    // seria mandado digitar CNH e endereço à toa.
    //
    // Então aqui a decisão é do SERVIDOR: tentamos o aceite sem corpo, e o
    // DRIVER_REGISTRATION_REQUIRED abre o formulário. Quem já tem cadastro entra em um
    // passo, sem ver formulário nenhum; a ida perdida só acontece para quem precisa mesmo
    // preencher.
    //
    // Se você veio "consertar a assimetria": as duas telas decidem por mecânicas diferentes
    // porque as duas perguntas têm custos diferentes. Não implemente o flag do motorista.
    this.acceptInvite();
  }

  /**
   * Abre o formulário já com o que o convite sabe. Nome e telefone re-mascarados na
   * hidratação, porque o backend guarda dígitos crus e o convidado precisa RECONHECER os
   * próprios dados para confirmá-los.
   */
  private startOnboarding(details: ValidateInviteResponse): void {
    this.onboardingForm.patchValue({
      name: details.name ?? '',
      phone: maskPhone(details.phoneNumber ?? ''),
    });
    this.onboardingError.set(null);
    this.step.set('onboarding');
  }

  /** Máscara progressiva de CPF, caret preservado. */
  protected onCpfInput(event: Event): void {
    applyMaskedDocumentInput(event, this.onboardingForm.controls.cpf, maskCpf);
  }

  /** Máscara progressiva de telefone, caret preservado. */
  protected onPhoneInput(event: Event): void {
    applyMaskedPhoneInput(event, this.onboardingForm.controls.phone);
  }

  // ---------------------------------------------------------------------------------
  // Onboarding do MOTORISTA — irmão do de gerente, mesma mecânica de confirmação.
  // ---------------------------------------------------------------------------------

  private readonly cepService = inject(CepService);

  protected readonly cepLoading = signal(false);
  protected readonly driverError = signal<string | null>(null);

  /** Categorias vêm do enum do cadastro de motorista — não redigitadas aqui. */
  protected readonly licenseCategories: readonly LicenseCategory[] = [
    'A',
    'B',
    'C',
    'D',
    'E',
    'AB',
    'AC',
    'AD',
    'AE',
  ];

  protected readonly licenseMessages: Readonly<Record<string, string>> = {
    required: 'Informe o número da CNH.',
    pattern: 'A CNH tem 11 caracteres, sem pontos ou traços.',
  };
  protected readonly expiryMessages: Readonly<Record<string, string>> = {
    required: 'Informe a validade da CNH.',
  };
  protected readonly cepMessages: Readonly<Record<string, string>> = {
    required: 'Informe o CEP.',
    pattern: 'CEP inválido. Use 00000-000.',
  };
  protected readonly requiredOnly: Readonly<Record<string, string>> = {
    required: 'Campo obrigatório.',
  };
  protected readonly ufMessages: Readonly<Record<string, string>> = {
    required: 'Informe a UF.',
    pattern: 'Use a sigla de 2 letras.',
  };

  /**
   * FEAT — o motorista CONFIRMA o que o convite já sabe e DIGITA o que falta.
   *
   * Nome, CPF e telefone chegam pré-preenchidos QUANDO o convite os tem. Os convites que já
   * estão em produção nasceram só com e-mail, então estes três podem vir VAZIOS — por isso
   * são `required` aqui e não apenas "confirmáveis": o caminho em branco é o caso real do
   * dono, não uma borda.
   *
   * `licenseNumber` usa o MESMO padrão do cadastro manual (11 alfanuméricos), não uma regra
   * nova escrita para esta tela.
   */
  protected readonly driverForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(180)]],
    cpf: ['', [Validators.required, cpfShapeValidator(), cpfValidator()]],
    phone: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
    licenseNumber: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9]{11}$/)]],
    licenseCategory: ['B' as LicenseCategory, [Validators.required]],
    licenseExpiry: ['', [Validators.required]],
    cep: ['', [Validators.required, Validators.pattern(/^\d{5}-?\d{3}$/)]],
    street: ['', [Validators.required, Validators.maxLength(180)]],
    number: [''],
    complement: [''],
    district: ['', [Validators.required, Validators.maxLength(120)]],
    city: ['', [Validators.required, Validators.maxLength(120)]],
    uf: ['', [Validators.required, Validators.pattern(/^[A-Za-z]{2}$/)]],
  });

  /**
   * Abre o formulário do motorista. Os três primeiros campos são pré-preenchidos SÓ com o
   * que o convite tem — `?? ''` é o caso real dos convites antigos, não um detalhe.
   */
  private startDriverOnboarding(details: ValidateInviteResponse): void {
    // `?? ''` NÃO é defensividade decorativa: os convites que estão em produção hoje
    // nasceram só com e-mail, então nome e telefone chegam nulos e o formulário abre em
    // branco. Esse é o caso real, não a borda.
    //
    // O CPF nunca é pré-preenchido: a rota de validação é anônima e o backend não o
    // devolve, nem mascarado. O convidado digita e o servidor compara com o cofre.
    this.driverForm.patchValue({
      name: details.name ?? '',
      phone: maskPhone(details.phoneNumber ?? ''),
    });
    this.driverError.set(null);
    this.step.set('driver-onboarding');
  }

  protected onDriverCpfInput(event: Event): void {
    applyMaskedDocumentInput(event, this.driverForm.controls.cpf, maskCpf);
  }

  protected onDriverPhoneInput(event: Event): void {
    applyMaskedPhoneInput(event, this.driverForm.controls.phone);
  }

  protected onLicenseInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 11).toUpperCase();
    input.value = raw;
    this.driverForm.controls.licenseNumber.setValue(raw);
  }

  /** CEP reusa o `CepService` que a tela da empresa já usa — não há uma segunda busca. */
  protected onCepInput(event: Event): void {
    applyMaskedCepInput(event, this.driverForm.controls.cep);
    const digits = normalizeCep(this.driverForm.controls.cep.value);
    if (digits.length !== 8) return;

    this.cepLoading.set(true);
    this.cepService.lookup(digits).subscribe({
      next: (found: CepLookupResult | null) => {
        this.cepLoading.set(false);
        if (!found) return;
        // Não sobrescreve o que o usuário já digitou à mão.
        const patch: Record<string, string> = {};
        if (!this.driverForm.controls.street.value) patch['street'] = found.street;
        if (!this.driverForm.controls.district.value) patch['district'] = found.district;
        if (!this.driverForm.controls.city.value) patch['city'] = found.city;
        if (!this.driverForm.controls.uf.value) patch['uf'] = found.uf;
        this.driverForm.patchValue(patch);
      },
      // A busca é conveniência: se o ViaCEP cair, o endereço continua preenchível à mão.
      error: () => this.cepLoading.set(false),
    });
  }

  protected submitDriverOnboarding(): void {
    if (this.submitting()) return;

    if (this.driverForm.invalid) {
      this.driverForm.markAllAsTouched();
      return;
    }

    const raw = this.driverForm.getRawValue();
    this.submitting.set(true);
    this.driverError.set(null);

    this.acceptInvite({
      name: raw.name.trim(),
      cpf: normalizeCpf(raw.cpf),
      phone: normalizePhone(raw.phone),
      licenseNumber: raw.licenseNumber.trim().toUpperCase(),
      licenseCategory: raw.licenseCategory,
      licenseExpiry: raw.licenseExpiry,
      address: {
        street: raw.street.trim(),
        number: raw.number.trim(),
        complement: raw.complement.trim(),
        district: raw.district.trim(),
        cep: normalizeCep(raw.cep),
        city: raw.city.trim(),
        uf: raw.uf.trim().toUpperCase(),
      },
    });
  }

  protected submitOnboarding(): void {
    if (this.submitting()) return;

    if (this.onboardingForm.invalid) {
      this.onboardingForm.markAllAsTouched();
      return;
    }

    const raw = this.onboardingForm.getRawValue();
    this.submitting.set(true);
    this.onboardingError.set(null);
    // Dígitos crus no corpo: o backend aceita mascarado, mas mandar normalizado é o que o
    // resto do app faz e evita depender da normalização dele.
    this.acceptInvite({
      name: raw.name.trim(),
      cpf: normalizeCpf(raw.cpf),
      phone: normalizePhone(raw.phone),
    });
  }

  private acceptInvite(payload?: AcceptInviteRequest | DriverAcceptInviteRequest): void {
    this.step.set('accepting');
    this.errorMessage.set(null);

    // Sem corpo, a chamada e a MESMA de antes — nem um argumento a mais. O caminho do
    // motorista nao pode mudar de forma so porque o do gerente ganhou um corpo.
    const accept$ = payload
      ? this.invites.accept(this.token, payload)
      : this.invites.accept(this.token);

    accept$.subscribe({
      next: (response) => {
        this.session.removeItem(PENDING_INVITE_TOKEN_KEY);
        // Same session writes as the onboarding finish: ACCESS token + the selected
        // tenant + the onboarding flag, so `authGuard` lets /dashboard through without
        // an /auth/me round trip.
        this.auth.applyFinishResponse(response);
        // The invited address is the account's address; nothing else here knows it and
        // the shell would otherwise render an empty identity until the next login.
        const email = this.details()?.email;
        if (email) this.session.setItem('email', email);
        // The cache belongs to whatever tenant was open before this accept.
        this.invites.reset();
        this.router.navigate(['/dashboard'], { replaceUrl: true });
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const cause = inviteAcceptCause(err);

        // O CAMINHO PRINCIPAL do motorista. Isto NÃO é erro para o usuário ler: é o
        // servidor pedindo o formulário, e é assim que a tela descobre que falta cadastro.
        if (cause === 'driver-registration-required') {
          this.apiErrors.claim(err);
          const current = this.details();
          if (current) {
            this.startDriverOnboarding(current);
            return;
          }
        }

        // Erros que pertencem ao FORMULÁRIO do motorista: mantêm o convidado nele.
        if (payload && this.step() === 'accepting' && isDriverPayload(payload)) {
          const status = err instanceof HttpErrorResponse ? err.status : 0;

          // CNH já usada nesta empresa: a mensagem é do SERVIDOR, que sabe o caso
          // concreto. Uma frase minha aqui seria um palpite por cima de um fato.
          if (status === 409) {
            this.driverError.set(
              this.apiErrors.messageFor(err, 'Esta CNH já está cadastrada nesta empresa.'),
            );
            this.step.set('driver-onboarding');
            return;
          }

          // Teto do plano. O limite de motoristas é 200 em TODOS os planos — teto de
          // segurança, não limite comercial, então isto praticamente não acontece. Tratado
          // para não virar tela branca, e nada além disso: uma frase curta que diz que quem
          // resolve é a empresa, sem mandar o motorista "tentar de novo".
          if (status === 402) {
            this.apiErrors.claim(err);
            this.driverError.set(
              'A empresa precisa liberar uma vaga de motorista. Avise quem te convidou.',
            );
            this.step.set('driver-onboarding');
            return;
          }
        }
        // FEAT-0167 — CPF errado é o único dos três cujo conserto é AQUI: o convidado
        // digitou um dígito errado. Voltar para a tela de erro o tiraria do formulário e o
        // obrigaria a recomeçar o fluxo inteiro por causa de um campo. Os outros dois erros
        // realmente exigem sair (trocar de conta, falar com o gestor) e seguem caindo em
        // `fail`.
        if (payload && inviteAcceptCause(err) === 'cpf-mismatch') {
          this.apiErrors.claim(err);
          this.onboardingForm.controls.cpf.setErrors({ cpfMismatch: true });
          this.onboardingForm.controls.cpf.markAsTouched();
          this.onboardingError.set(inviteErrorCopy(err, 'accept'));
          this.step.set('onboarding');
          return;
        }
        this.fail(err, 'Não foi possível aceitar este convite. Tente novamente.');
      },
    });
  }

  /**
   * Invite-specific copy wins (410 expired, 409 already used, 403 wrong account, 429 rate
   * limited); anything else falls back to the shared extractor. Claiming first keeps the
   * `errorInterceptor` safety-net toast from duplicating what the banner already says.
   */
  private fail(err: unknown, fallback: string): void {
    this.apiErrors.claim(err);
    this.acceptCause.set(inviteAcceptCause(err));
    this.errorMessage.set(inviteErrorCopy(err, 'accept') ?? this.apiErrors.messageFor(err, fallback));
    this.step.set('error');
  }
}
