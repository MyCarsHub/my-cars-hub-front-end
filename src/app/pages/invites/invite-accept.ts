import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DOCUMENT, NgOptimizedImage } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TimeoutError, timeout } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { AuthService } from '../../services/auth.service';
import { InvitesService } from '../../services/invites.service';
import { TenantCachesService } from '../../services/tenant-caches.service';
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
  INVITE_TTL_LABEL,
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

/**
 * Quanto a tela espera a navegacao assentar antes de assumir que ela nao vai acontecer.
 *
 * Generoso de proposito: o caminho feliz resolve em milissegundos, entao este numero so e
 * alcancado quando algo realmente travou. Curto demais transformaria uma navegacao lenta
 * numa mensagem de erro desnecessaria.
 */
const NAVIGATION_GRACE_MS = 8000;

/**
 * Teto de espera de CADA chamada desta tela.
 *
 * MEDIUM-1 da revisao — a rede de seguranca cobria a navegacao POS-aceite e deixava de fora
 * os dois estados de espera que vem ANTES: `validating` (o `validate`) e `accepting` (o
 * `accept`). Pendurar nao e errar: sem resposta nao ha `error`, e sem `error` a tela ficava
 * no MESMO spinner eterno que este arquivo existe para matar — o defeito do dono
 * reaparecendo um passo antes.
 *
 * Nenhum interceptor cobre isto: o unico com timeout no projeto NAO esta registrado em
 * `app.config`. Entao o teto e aqui, por chamada.
 */
const REQUEST_GRACE_MS = 15000;

type AcceptStep =
  | 'validating'
  | 'ready'
  | 'onboarding'
  | 'driver-onboarding'
  | 'accepting'
  | 'mismatch'
  /**
   * O aceite DEU CERTO no servidor e a navegacao para dentro do app nao aconteceu.
   * Estado proprio porque a tela nao pode continuar em 'accepting': o trabalho acabou,
   * e o spinner afirmaria que ainda esta em curso.
   */
  | 'linked'
  /**
   * O `accept` nao respondeu no tempo. Pode ter funcionado no servidor — a tela NAO sabe, e
   * por isso nao afirma nenhum dos dois lados.
   */
  | 'unconfirmed'
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
  private readonly tenantCaches = inject(TenantCachesService);
  private readonly document = inject(DOCUMENT);

  private token = '';

  protected readonly step = signal<AcceptStep>('validating');
  protected readonly details = signal<ValidateInviteResponse | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly redirecting = signal(false);
  /** E-mail da sessão aberta nesta aba, só quando ele diverge do convidado. */
  protected readonly signedInEmail = signal('');

  /**
   * Validity promised to the invitee. `ValidateInviteResponse` carries no expiry, so this
   * is the mirrored backend TTL (`types/invite.types.ts`) — not a number typed in the copy.
   */
  protected readonly ttlLabel = INVITE_TTL_LABEL;

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
    cpfShape: 'Faltou algum número do CPF — confira os 11 dígitos do seu documento.',
    cpfInvalid: 'Esse CPF não confere. Confira os números no seu documento.',
    cpfMismatch: 'Este CPF não confere com o do convite.',
  };
  protected readonly phoneMessages: Readonly<Record<string, string>> = {
    required: 'Informe seu telefone.',
    pattern: 'Confira o telefone com o DDD, como (11) 91234-5678.',
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

    this.invites.validate(token).pipe(timeout(REQUEST_GRACE_MS)).subscribe({
      next: (details) => {
        this.details.set(details);
        // Coming back from Google there is already a token — finish without a second click.
        if (this.session.getToken()) {
          this.acceptOrReportMismatch(details);
          return;
        }
        this.step.set('ready');
      },
      error: (err: unknown) => {
        // Pendurou: nao e convite invalido, e falta de resposta. Dizer "convite invalido"
        // aqui mandaria a pessoa pedir outro convite para resolver uma queda de rede.
        if (err instanceof TimeoutError) {
          this.fail(
            err,
            'Não tivemos resposta do servidor. Confira sua conexão e abra o link do ' +
              'e-mail novamente.',
          );
          return;
        }
        this.fail(err, 'Não foi possível verificar este convite. Tente novamente.');
      },
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
  /**
   * A REDE DE SEGURANCA. `router.navigate()` devolve `Promise<boolean>` e um `false` e
   * SILENCIOSO: guard que recusa nao lanca, nao loga e nao troca de tela. Ninguem tratava
   * esse `false`, e por isso um aceite BEM-SUCEDIDO terminava num spinner permanente.
   *
   * Tres saidas, nao uma:
   *
   * - `false` — algum guard recusou. O caso medido era o laco billing/role, mas qualquer
   *   guard futuro produz o mesmo sintoma, e e por isso que o tratamento e do RESULTADO e
   *   nao daquele laco.
   * - rejeicao — o router estoura o limite de redirecionamentos e a promessa REJEITA em vez
   *   de resolver `false`. Tratar so o `false` deixaria metade do defeito de pe.
   * - nunca assentar — o `timeout` cobre a navegacao que simplesmente nao volta. Sem ele a
   *   tela continua presa exatamente como antes.
   *
   * Em TODAS, o estado final e 'linked', nunca 'error': a conta FOI vinculada. Dizer que
   * falhou seria mentir para quem acabou de ser adicionado a empresa com sucesso.
   */
  private goToDashboard(): void {
    let settled = false;
    const land = (navigated: boolean): void => {
      if (settled) return;
      settled = true;
      if (!navigated) {
        this.step.set('linked');
      }
    };

    const timer = setTimeout(() => land(false), NAVIGATION_GRACE_MS);

    this.router.navigate(['/dashboard'], { replaceUrl: true }).then(
      (ok) => {
        clearTimeout(timer);
        land(ok === true);
      },
      () => {
        clearTimeout(timer);
        land(false);
      },
    );
  }

  /**
   * Saida do estado 'linked': recarga COMPLETA da pagina, nao `router.navigate`.
   *
   * Navegar pelo router de novo bateria nos mesmos guards com o mesmo estado em memoria e
   * recusaria de novo. Uma recarga descarta todo cache por empresa que sobrou e refaz a
   * decisao com o token novo — e o unico caminho que nao depende de adivinhar qual guard
   * recusou.
   */
  protected reloadIntoApp(): void {
    this.document.defaultView?.location.assign('/');
  }

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

    /*
     * FEAT-0266 — O GERENTE TAMBEM SEGUE DIRETO, quando o convite carrega o que o aceite
     * precisa. Isto era um pedagio na porta, e MEDIDO no backend ele era desnecessario:
     *
     *   InvitesController:accept -> @RequestBody(required = false)
     *   InvitesService:requireManagerOnboardingIsResolvable -> exige documentId + nome +
     *   telefone RESOLVIVEIS, e os resolve DO PROPRIO CONVITE antes de olhar o corpo. O CPF
     *   so e conferido se vier preenchido (hasText): nunca e obrigatorio.
     *
     * Como a criacao de convite MANAGER exige nome, CPF e telefone (FEAT-0167), um convite
     * moderno e sempre resolvivel — e a pessoa nao precisa redigitar nada. Tres campos a
     * menos na porta para o caso comum.
     *
     * ## Por que o teste e NOME + TELEFONE, e nao o codigo do erro
     *
     * O caminho obvio seria tentar sem corpo e abrir o formulario se voltasse
     * ERROR_MANAGER_CONFIRMATION_REQUIRED. NAO DA, hoje: aquele erro e lancado como
     * `InvalidDataException(mensagem)` SEM codigo (InvitesService:833), ao contrario do
     * irmao do motorista, que tem CODE_DRIVER_REGISTRATION_REQUIRED. E um 400 mudo — e o
     * 400 mudo deste endpoint tambem sai de token em branco e de convite nao-PENDING, como
     * `invite-errors.ts` ja avisa. Abrir formulario em cima dele pediria dados a quem tem um
     * convite JA USADO. Casar a mensagem em portugues seria pior.
     *
     * Entao o discriminador e DADO, nao erro: `name` e `phoneNumber` vem nesta resposta, e
     * um convite que os tem foi criado sob a regra que tambem exigia o CPF — logo tem
     * documentId, logo e resolvivel. Faltando qualquer um dos dois, cai no formulario de
     * antes: nenhum convite legado para de funcionar.
     *
     * A INFERENCIA que isto carrega, declarada: "tem nome e telefone" implica "tem
     * documentId". Ela vale porque os tres nasceram obrigatorios no mesmo FEAT-0167. Para
     * virar FATO, o backend precisa dar codigo ao erro do gerente — proposto como no.
     */
    if (details.requiresManagerOnboarding === true && !this.inviteCarriesManagerData(details)) {
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
   * O convite ja traz o que o aceite do gerente precisa resolver?
   *
   * Nome E telefone, os dois. Meio preenchido nao serve: o backend exige os dois
   * resolviveis, e um convite com so um deles cai no 400 mudo que esta tela nao sabe
   * distinguir.
   */
  private inviteCarriesManagerData(details: ValidateInviteResponse): boolean {
    return (details.name ?? '').trim().length > 0 && (details.phoneNumber ?? '').trim().length > 0;
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
    // "11 caracteres" descreve o CAMPO; isto descreve o que a pessoa tem na mão.
    pattern: 'Digite os 11 números que aparecem na frente da sua CNH, sem pontos nem traços.',
  };
  protected readonly expiryMessages: Readonly<Record<string, string>> = {
    required: 'Informe a validade da CNH.',
  };
  protected readonly cepMessages: Readonly<Record<string, string>> = {
    required: 'Informe o CEP.',
    pattern: 'Confira o CEP — são 8 números, como 01310-100.',
  };
  protected readonly requiredOnly: Readonly<Record<string, string>> = {
    required: 'Preencha este campo para continuar.',
  };
  protected readonly ufMessages: Readonly<Record<string, string>> = {
    required: 'Informe a UF.',
    pattern: 'Use a sigla do estado com 2 letras, como SP.',
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
    this.cepService.lookup(digits).pipe(timeout(REQUEST_GRACE_MS)).subscribe({
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
    const accept$ = (
      payload ? this.invites.accept(this.token, payload) : this.invites.accept(this.token)
    ).pipe(timeout(REQUEST_GRACE_MS));

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
        /*
         * A CAUSA do spinner eterno (medido): aceitar um convite E UMA TROCA DE TENANT, e
         * esta linha zerava SO o cache de convites. Todo o resto dos caches por empresa
         * seguia com o veredito do tenant ANTERIOR — e `BillingAccessService` e um deles.
         *
         * Com o `isBlocked()` da empresa de quem convidou ainda em memoria,
         * `billingAccessGuard` desviava `/dashboard` para `/billing`; `/billing` e
         * `roleGuard(['OWNER'])` e o convidado nunca e OWNER, entao o roleGuard devolvia
         * o convidado para a casa do papel dele, que o billingAccessGuard desviava de
         * novo para `/billing`: LACO. O router cancela, `navigate()` nao abre tela
         * nenhuma, e a pagina ficava em 'accepting' para sempre.
         *
         * `resetAll()` e o que `layout.store` e `impersonation.service` ja chamam em toda
         * troca de empresa — o aceite era o unico caminho de troca que nao chamava. Ele
         * inclui o cache de convites, porque `InvitesService` se registra no mesmo
         * registro.
         */
        this.tenantCaches.resetAll();
        this.goToDashboard();
      },
      error: (err: unknown) => {
        this.submitting.set(false);

        /*
         * MEDIUM-1 — SEM RESPOSTA NAO E FALHA. O `accept` pode ter gravado o vinculo e so a
         * resposta ter se perdido; o servidor e a autoridade e a tela nao sabe. Entao a copy
         * nao afirma nem sucesso nem fracasso, e a acao oferecida — entrar no aplicativo —
         * e a unica que RESOLVE nos dois casos: se funcionou, a pessoa entra; se nao, ela ve
         * que nao entrou. Mandar "tente de novo" seria pior: um segundo aceite do mesmo
         * convite volta 409.
         */
        if (err instanceof TimeoutError) {
          this.apiErrors.claim(err);
          this.step.set('unconfirmed');
          return;
        }

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

          // 402 e 409 saem do MESMO método do backend (`enforceDriverLimit`), por razões
          // DIFERENTES, e é por isso que não podem dividir frase:
          //   sem assinatura / sem plano  -> AccessBlockedException          -> 402
          //   no teto (current >= limit)  -> HasConflictException            -> 409
          //
          // O 409 ainda chega pela CNH repetida, então este status tem DUAS causas e a tela
          // não escolhe entre elas: mostra a mensagem do SERVIDOR, que sabe qual é. O
          // fallback é deliberadamente sem causa — nomear uma delas faria um 409 de teto sem
          // corpo aparecer como "CNH já cadastrada", que é o mesmo defeito uma camada abaixo.
          if (status === 409) {
            this.driverError.set(
              this.apiErrors.messageFor(err, 'Não foi possível concluir seu cadastro nesta empresa.'),
            );
            this.step.set('driver-onboarding');
            return;
          }

          // Assinatura, NÃO vaga. Mandar quem esbarrou na assinatura pedir uma vaga faz a
          // empresa olhar o lugar errado, achar que está tudo certo, e ninguém resolver.
          // O teto de motoristas é 200 em todos os planos — guardrail, não limite comercial —
          // e de qualquer forma ele vem como 409, não por aqui.
          if (status === 402) {
            this.apiErrors.claim(err);
            this.driverError.set(
              'A assinatura desta empresa precisa ser regularizada antes de incluir motoristas. ' +
                'Avise quem te convidou.',
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
        /*
         * MEDIUM-2 — A FRASE DO 400 MUDO, no ramo que este no criou.
         *
         * Tentamos SEM corpo porque o convite trazia nome e telefone. Se o backend recusou
         * assim mesmo com um 400 sem codigo, a copy generica dizia "Este convite nao e mais
         * valido. Peca a empresa para enviar um novo convite." — FALSO e, pior, INUTIL: um
         * convite novo cai no mesmo lugar, entao a pessoa pede, recebe, clica e trava outra
         * vez.
         *
         * E a tela nao tem como saber qual dos casos foi: aquele mesmo 400 mudo sai de
         * convite JA USADO e de "o servidor quer o formulario" (achado 6 da revisao), e o
         * erro do gerente e lancado sem codigo. Entao a frase ADMITE o que nao se sabe e
         * aponta a unica acao que pode resolver os dois: falar com quem convidou. Quando o
         * backend der codigo ao erro, isto vira deteccao e cada caso ganha a frase propria.
         */
        const mudo400 =
          err instanceof HttpErrorResponse && err.status === 400 && cause === null;
        if (!payload && mudo400) {
          this.apiErrors.claim(err);
          this.acceptCause.set(null);
          this.errorMessage.set(
            'Não conseguimos concluir seu acesso, e o convite pode já ter sido usado. ' +
              'Fale com quem te convidou para confirmar — pedir um novo convite pode não ' +
              'resolver.',
          );
          this.step.set('error');
          return;
        }

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
