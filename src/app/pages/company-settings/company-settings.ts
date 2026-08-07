import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { SessionService } from '../../services/session.service';
import { CompanyService } from '../../services/company.service';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { clearServerErrors } from '../../services/api-error';
import { CompanyFullResponse } from '../../types/company-full-response.type';
import { PageCard } from '../../components/core/page-card/page-card';
import { CompanyOwner, CompanyStats } from '../../types/company-settings.types';
import {
  applyMaskedDocumentInput,
  documentCheckDigitValidator,
  documentShapeValidator,
  maskDocument,
  normalizeDocument,
} from '../../utils/document-mask';
import { LayoutStore } from '../../components/core/layouts/layout.store';
import { UserCompanies } from '../../types/user-companies';

const SAVE_FALLBACK = 'Não foi possível salvar os dados da empresa.';

/**
 * Statuses the `errorInterceptor` already toasts (0 / 401 / 403 / 5xx). Repeating them
 * in the page banner would show the user the same failure twice.
 */
function ownedByInterceptor(status: number): boolean {
  return status === 0 || status === 401 || status === 403 || status >= 500;
}

/** `scrollIntoView` is absent in jsdom and in a few older mobile browsers. */
function centre(element: HTMLElement | null): void {
  if (element && typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ block: 'center' });
  }
}

/**
 * Company settings — name and document are editable, but behind an explicit "Editar".
 *
 * ## Leitura por padrão, edição sob demanda
 *
 * O cartão institucional abre em SOMENTE-LEITURA: nome e documento saem como legenda
 * em caixa alta miúda + valor, o mesmo tratamento que "Data de fundação" e "Status da
 * conta" já usavam ali. O botão "Editar" (slot `cardActions` do `app-page-card`, mesmo
 * lugar do toggle de `billing.html`) troca para o formulário reativo, que é o MESMO de
 * antes — nenhum validador, payload ou endpoint mudou.
 *
 * "Cancelar" não é só esconder os campos: ele reconstrói o formulário a partir de
 * `companyInfo()` (`resetFormFromCompany`), então o que o usuário digitou e não salvou
 * não sobrevive a uma segunda entrada em edição. Salvar com sucesso também sai do modo
 * de edição — o formulário já não tem nada pendente.
 *
 * Salvar/Cancelar pertencem ao modo de edição: um submit visível sem nada para submeter
 * era exatamente o que fazia a tela parecer inacabada.
 *
 * Não havia toggle de edição in-loco em lugar nenhum do projeto (todo "Editar" existente
 * navega para uma tela de formulário), então o padrão aqui é o mínimo: um `signal`
 * booleano trocando o modo.
 *
 * Backend contract (`PUT /v1/companies/me`): the tenant comes from the access token, so
 * there is no id in the payload. `documentValue` accepts a CPF or a CNPJ and may change
 * in any direction (CPF → CNPJ, CNPJ → CPF, CNPJ → another CNPJ). There is no locked
 * state. CNPJ is alphanumeric since July 2026, so the mask must not be digits-only.
 *
 * The response masks `documentValue` (LGPD), so the form never round-trips it: the field
 * starts empty and only carries what the user actually typed. An untouched field sends
 * `null`, which the backend reads as "keep the current document".
 *
 * The document is validated locally for shape AND mod-11 check digits (same arithmetic
 * as the backend), so an obvious typo is caught without a round-trip; the backend
 * remains the authority and its 400 still lands inline on the field.
 *
 * Name capitalization is owned by the backend (`NameNormalizer`); the screen renders
 * whatever the API returns and normalizes nothing locally.
 *
 * ## Papéis nesta página
 *
 * A rota é `roleGuard(['OWNER'])` — `/configuracoes` e todos os sete filhos são
 * OWNER-only (`app.routes.ts`), e quem barra o acesso é o guard, não este template. O
 * MANAGER não chega mais aqui, nem ao cartão Integrações.
 *
 * Os `@if (isOwner)` que sobraram no template são defesa em profundidade, para o caso de
 * alguém afrouxar o guard — não o controle de acesso principal. Eles recortam os blocos
 * cujo endpoint exige OWNER: o formulário Informações Institucionais
 * (`PUT /v1/companies/me`) com o cartão de atalho Contato ao lado, e o cartão do
 * proprietário. O `GET` da empresa segue o mesmo recorte: sem o formulário não há o que
 * preencher, e assim nenhuma requisição que voltaria 403 chega a sair.
 *
 * O cartão Equipe (atalho de Convites) saiu da tela: o produto está refazendo o fluxo de
 * convites e removeu seus pontos de entrada da UI. A rota `configuracoes/convites` e o
 * `InvitesService` continuam existindo — só o atalho daqui foi removido.
 *
 * Fora do OWNER o grid vira uma coluna só (não há coluna lateral) — é o layout desse
 * cenário de defesa em profundidade, não um caminho que o produto ofereça.
 */
@Component({
  selector: 'app-company-settings',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    DefaultPageLayout,
    AlertBanner,
    FormField,
    FieldControl,
    PageCard,
  ],
  templateUrl: './company-settings.html',
  styleUrl: './company-settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanySettings implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly sessionService = inject(SessionService);
  private readonly companyService = inject(CompanyService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly layoutStore = inject(LayoutStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /**
   * OWNER-only blocks. `PUT /v1/companies/me` exige OWNER no backend, então mostrar o
   * formulário a um MANAGER só produziria um 403 no salvamento.
   */
  protected readonly isOwner = this.sessionService.getItem('selectedRole') === 'OWNER';

  ngOnInit(): void {
    // Só OWNER edita os dados cadastrais — sem o formulário, o GET não tem consumidor.
    if (this.isOwner) this.reload();
  }

  protected readonly companyInfo = signal<CompanyFullResponse | null>(null);
  /** Failure of the initial GET. */
  protected readonly error = signal<string | null>(null);
  /** Failure of the save that has no single field to attach to. */
  protected readonly saveError = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly companyForm = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    documentValue: ['', [documentShapeValidator(), documentCheckDigitValidator()]],
  });

  /** Copy overrides for the inline message resolver. */
  protected readonly nameMessages: Readonly<Record<string, string>> = {
    required: 'Informe o nome da empresa.',
    maxlength: 'O nome deve ter no máximo 200 caracteres.',
  };
  protected readonly documentMessages: Readonly<Record<string, string>> = {
    documentShape: 'Informe um CPF (11 dígitos) ou um CNPJ (14 caracteres).',
    documentInvalid: 'Documento inválido. Confira os números digitados.',
  };

  /**
   * Modo do cartão institucional. `false` = leitura (padrão), `true` = formulário.
   * Não havia toggle de edição in-loco no projeto para copiar — este é o mínimo.
   */
  protected readonly editing = signal(false);

  /**
   * Só há o que editar depois que o GET responde. Sem esta trava o cartão em erro (ou
   * ainda carregando) mostrava título, botão "Editar" e mais nada: clicar abria um
   * campo de nome VAZIO e salvar mandava um `PUT` de renomeação montado sobre dados
   * que o usuário nunca viu. Mesma recusa de `company-contact.ts` — sem os dados
   * atuais, não se edita às cegas.
   *
   * Esta trava também fecha a corrida entre `applyCompany()` e o que está sendo
   * digitado: entrar em edição EXIGE `companyInfo()` preenchido, e o único `patchValue`
   * de fora (`applyCompany`, no retorno do GET) é justamente o que o preenche. Não
   * existe mais janela em que o formulário esteja aberto e um GET ainda em voo — por
   * isso `applyCompany` não precisa de um `if (editing())`, que seria código morto.
   */
  protected readonly canEdit = computed(() => this.companyInfo() !== null);

  /**
   * Linha somente-leitura do documento. Vazia enquanto o GET não voltou — sem valor não
   * há linha, senão fica uma legenda órfã. Com a empresa carregada e sem documento, a
   * frase explícita É o valor, então a linha aparece.
   *
   * É a MESMA fonte nos dois modos (em edição, sob o rótulo "Documento atual"): a regra
   * "tipo · valor / Nenhum documento cadastrado" vivia duplicada no template e nada
   * garantia que as duas cópias continuassem concordando.
   */
  protected readonly documentSummary = computed(() => {
    const info = this.companyInfo();
    if (!info) return '';
    const masked = info.documentValue ?? '';
    return masked ? `${info.documentType} · ${masked}` : 'Nenhum documento cadastrado';
  });

  /** Entra em edição com o formulário sincronizado com o que está na tela. */
  protected startEdit(): void {
    this.resetFormFromCompany();
    this.editing.set(true);
    // O primeiro campo do formulário que acabou de aparecer — sem isso o foco fica no
    // botão "Editar", que some no mesmo frame, e o leitor de tela perde o contexto.
    this.focusAfterRender('#company-name');
  }

  /**
   * Sai da edição descartando o que foi digitado. Reconstrói a partir de `companyInfo()`
   * em vez de só esconder os campos: reabrir a edição precisa mostrar o valor gravado.
   */
  protected cancelEdit(): void {
    this.resetFormFromCompany();
    this.leaveEdit();
  }

  private leaveEdit(): void {
    this.editing.set(false);
    // Devolve o foco ao gatilho, que é para onde o modo de leitura volta.
    this.focusAfterRender('[data-edit-toggle]');
  }

  /**
   * Formulário = estado carregado. `reset` (e não `patchValue`) porque também limpa
   * `touched`/`dirty`: reabrir a edição não deve herdar a borda vermelha da tentativa
   * anterior. `documentValue` volta vazio sempre — a resposta o devolve mascarado.
   */
  private resetFormFromCompany(): void {
    clearServerErrors(this.companyForm);
    this.saveError.set(null);
    this.companyForm.reset({
      name: this.companyInfo()?.name ?? '',
      documentValue: '',
    });
  }

  /** Foco só depois que o novo modo pintou — antes disso o alvo não existe no DOM. */
  private focusAfterRender(selector: string): void {
    afterNextRender(
      () => {
        this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
      },
      { injector: this.injector },
    );
  }

  protected readonly owner = signal<CompanyOwner>({
    name: this.sessionService.getItem('name') ?? '',
    email: this.sessionService.getItem('email') ?? '',
    joinedAt: '',
  });

  /**
   * Iniciais do proprietário para o avatar — primeiro e último nome, no máximo duas
   * letras. Vazio quando não há nome, e nesse caso o template não desenha o círculo:
   * um disco laranja sem conteúdo é lido como imagem quebrada.
   */
  protected readonly ownerInitials = computed(() => {
    const words = this.owner()
      .name.trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    if (words.length === 0) return '';
    const first = words[0].charAt(0);
    const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
    return (first + last).toUpperCase();
  });

  // TODO: `activeUsers` is still a placeholder — it needs the company-members endpoint,
  // which is a separate queued feature.
  protected readonly stats = signal<CompanyStats>({
    activeUsers: 12,
  });

  protected copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text);
  }

  /** Progressive CPF / CNPJ mask, caret preserved. */
  protected onDocumentInput(event: Event): void {
    applyMaskedDocumentInput(event, this.companyForm.get('documentValue'), maskDocument);
  }

  protected save(): void {
    if (this.saving()) return;

    clearServerErrors(this.companyForm);
    this.saveError.set(null);

    if (this.companyForm.invalid) {
      this.companyForm.markAllAsTouched();
      this.revealFirstError();
      return;
    }

    const raw = this.companyForm.getRawValue();
    const typedDocument = normalizeDocument(raw.documentValue);

    this.saving.set(true);
    this.companyService
      .updateCompany({
        name: (raw.name ?? '').trim(),
        // Empty means "keep the current document" — the masked value must never be echoed.
        documentValue: typedDocument.length > 0 ? typedDocument : null,
      })
      .subscribe({
        next: (response) => {
          this.saving.set(false);
          this.applyCompany(response);
          // Salvou: não há mais nada pendente, então o cartão volta a ser leitura.
          this.leaveEdit();
          this.notifications.success('Dados da empresa atualizados.');
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.handleSaveError(err);
        },
      });
  }

  /**
   * `fieldErrors` (400 / 409 on `documentValue`, 400 on `name`) land inline on the
   * control; a 404 with no field goes to the banner. 0 / 401 / 403 / 5xx are left to
   * the `errorInterceptor` toast — banner AND toast would say the same thing twice.
   */
  private handleSaveError(err: HttpErrorResponse): void {
    const result = this.apiErrors.handleForm(err, this.companyForm, SAVE_FALLBACK);
    this.saveError.set(ownedByInterceptor(err.status) ? null : result.formMessage);
    this.revealFirstError();
  }

  /**
   * Brings the first failure into view. The submit button sits at the bottom of a long
   * form, so on a phone a failed save is otherwise entirely off-screen.
   *
   * Field errors win: the invalid control is focused, which both scrolls it into view and
   * lets the screen reader announce the `role="alert"` message wired by `app-form-field`.
   * With no invalid control, the banner is scrolled to instead.
   */
  private revealFirstError(): void {
    afterNextRender(
      () => {
        const invalid = this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (invalid) {
          invalid.focus();
          centre(invalid);
          return;
        }
        centre(this.host.nativeElement.querySelector<HTMLElement>('[data-save-error]'));
      },
      { injector: this.injector },
    );
  }

  private applyCompany(response: CompanyFullResponse): void {
    this.companyInfo.set(response);
    this.companyForm.patchValue({
      // Backend owns the capitalization — render exactly what it returned.
      name: response.name,
      // Never patched from the response: `documentValue` comes back masked.
      documentValue: '',
    });
    this.companyForm.markAsPristine();
    this.owner.update((o) => ({ ...o, joinedAt: response.createdDate }));
    this.syncCompanyName(response.name);
  }

  /**
   * The company name is cached in sessionStorage in two places — `selectedCompanyName`
   * (read by `profile.ts`) and the `userCompanies` array (read by `LayoutStore` for the
   * sidebar tenant switcher). Without this, a rename only shows up after re-login.
   */
  private syncCompanyName(name: string): void {
    this.sessionService.setItem('selectedCompanyName', name);

    const companyId = this.sessionService.getItem('selectedCompanyId');
    const stored = this.sessionService.getItem('userCompanies');
    if (companyId && stored) {
      try {
        const companies = JSON.parse(stored) as UserCompanies[];
        const updated = companies.map((c) =>
          c.companyId === companyId ? { ...c, companyName: name } : c,
        );
        this.sessionService.setItem('userCompanies', JSON.stringify(updated));
      } catch {
        // fail silent: a corrupted `userCompanies` is LayoutStore's problem, not ours
      }
    }

    this.layoutStore.refreshTenants();
  }

  /**
   * Recarrega os dados da empresa. Chamado no `ngOnInit` e pelo "Tentar de novo" do
   * estado de erro — mesmo par de `company-contact.ts`. Zerar `error` de saída já tira
   * o botão da tela enquanto a requisição está em voo, então não há clique duplo a
   * defender.
   */
  protected reload(): void {
    this.error.set(null);
    this.companyService.getInfoCompany().subscribe({
      next: (response) => this.applyCompany(response),
      error: (err: HttpErrorResponse) =>
        this.error.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar os dados da empresa.'),
        ),
    });
  }
}
