import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { SessionService } from '../../services/session.service';
import { CompanyService } from '../../services/company.service';
import { ApiErrorService } from '../../services/api-error.service';
import { CompanyFullResponse } from '../../types/company-full-response.type';
import { PageCard } from '../../components/core/page-card/page-card';
import { CompanyOwner, CompanyStats } from '../../types/company-settings.types';

/**
 * Company settings is READ-ONLY on purpose.
 *
 * The backend exposes no self-service update endpoint for a company
 * (`CompanyController` has only `POST /create`, `GET /`, `GET /{id}`; the single write is
 * `PATCH /v1/admin/companies/{id}/status`, platform-admin only). The previous "Salvar
 * Alterações" button was a `setTimeout` that changed nothing and told the user it had
 * saved. Rather than fake it, the screen now states that editing is unavailable.
 */
@Component({
  selector: 'app-company-settings',
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    PrimaryInput,
    DefaultPageLayout,
    AlertBanner,
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

  ngOnInit(): void {
    this.loadCompanyInfo();
  }

  protected readonly companyInfo = signal<CompanyFullResponse | null>(null);
  protected readonly error = signal<string | null>(null);

  /** Every control is permanently disabled — there is no endpoint to save them to. */
  protected readonly companyForm = this.fb.group({
    name: [{ value: '', disabled: true }, [Validators.required]],
    documentType: [{ value: '', disabled: true }, [Validators.required]],
    documentNumber: [{ value: '', disabled: true }, [Validators.required]],
    createdAt: [{ value: '', disabled: true }],
    status: [{ value: '', disabled: true }],
  });

  protected readonly owner = signal<CompanyOwner>({
    name: this.sessionService.getItem('name') ?? '',
    email: this.sessionService.getItem('email') ?? '',
    joinedAt: '',
  });

  // TODO: replace with real API data once endpoints are available
  protected readonly stats = signal<CompanyStats>({
    activeUsers: 12,
    pendingInvites: 3,
  });

  protected copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text);
  }

  private loadCompanyInfo(): void {
    this.error.set(null);
    this.companyService.getInfoCompany().subscribe({
      next: (response) => {
        this.companyInfo.set(response);
        this.companyForm.patchValue({
          name: response.name,
          documentType: response.documentType,
          documentNumber: response.documentValue,
          createdAt: response.createdDate,
          status: response.status,
        });
        this.owner.update((o) => ({ ...o, joinedAt: response.createdDate }));
      },
      error: (err: HttpErrorResponse) =>
        this.error.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar os dados da empresa.'),
        ),
    });
  }
}
