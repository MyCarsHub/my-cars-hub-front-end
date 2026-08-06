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
import { InvitesService } from '../../services/invites.service';
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
import { OverdueFee } from './overdue-fee/overdue-fee';

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
 * Company settings — name and document are both freely editable.
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
 * A rota deixou de ser OWNER-only quando a tela `/configuracoes/atraso` virou a seção
 * `app-overdue-fee` daqui: aquela rota aceitava OWNER **e** MANAGER, e o backend também
 * (`PUT /v1/companies/current/overdue-settings`). Manter `roleGuard(['OWNER'])` teria
 * tirado do MANAGER uma capacidade que ele tinha em produção.
 *
 * Então a rota passou a `roleGuard(['OWNER','MANAGER'])` e o que é OWNER-only virou
 * `@if (isOwner)` no template — exatamente os blocos cujo endpoint exige OWNER:
 * o formulário de nome/documento (`PUT /v1/companies/me`), o cartão do proprietário e o
 * atalho para Dados de contato (rota OWNER-only). O `GET` da empresa também só sai para
 * OWNER: sem o formulário não há o que preencher, e assim um MANAGER não dispara uma
 * requisição que pode voltar 403.
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
    OverdueFee,
  ],
  templateUrl: './company-settings.html',
  styleUrl: './company-settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanySettings implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly sessionService = inject(SessionService);
  private readonly companyService = inject(CompanyService);
  private readonly invitesService = inject(InvitesService);
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
    if (this.isOwner) this.loadCompanyInfo();
    // The invite count is a secondary stat here; a failure hides the card instead of
    // shouting. Claiming the error keeps the interceptor's safety-net toast quiet — the
    // dedicated /configuracoes/convites screen is where invite errors are explained.
    this.invitesService.list().subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
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

  /** Masked document already on record, or empty when the company has none. */
  protected readonly currentDocument = computed(() => this.companyInfo()?.documentValue ?? '');

  protected readonly owner = signal<CompanyOwner>({
    name: this.sessionService.getItem('name') ?? '',
    email: this.sessionService.getItem('email') ?? '',
    joinedAt: '',
  });

  // TODO: `activeUsers` is still a placeholder — it needs the company-members endpoint,
  // which is a separate queued feature. `pendingInvites` below is real.
  protected readonly stats = signal<CompanyStats>({
    activeUsers: 12,
  });

  /** Real pending-invite count, from `GET /v1/invites`. */
  protected readonly pendingInvites = this.invitesService.pendingCount;
  protected readonly invitesLoaded = this.invitesService.loaded;

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

  private loadCompanyInfo(): void {
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
