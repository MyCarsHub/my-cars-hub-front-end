import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { SessionService } from '../../services/session.service';
import { CompanyService } from '../../services/company.service';
import { CompanyFullResponse } from '../../types/company-full-response.type';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { PageCard } from '../../components/core/page-card/page-card';
import { BillingInfo, CompanyOwner, CompanyStats } from '../../types/company-settings.types';

@Component({
  selector: 'app-company-settings',
  imports: [CommonModule, ReactiveFormsModule, PrimaryInput, DefaultPageLayout, ConfirmDialog, PageCard],
  templateUrl: './company-settings.html',
  styleUrl: './company-settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanySettings implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly sessionService = inject(SessionService);
  private readonly companyService = inject(CompanyService);

  ngOnInit(): void {
    this.loadCompanyInfo();
  }

  protected readonly companyInfo = signal<CompanyFullResponse | null>(null);

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
  protected readonly billing = signal<BillingInfo>({
    plan: 'PRO',
    billingCycle: 'Yearly',
    nextBillingDate: '15 de Março, 2025',
    status: 'ACTIVE',
  });

  // TODO: replace with real API data once endpoints are available
  protected readonly stats = signal<CompanyStats>({
    activeUsers: 12,
    pendingInvites: 3,
  });

  protected readonly isEditing = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly showConfirmDialog = signal(false);



  protected toggleEdit(): void {
    if (this.isEditing()) {
      this.showConfirmDialog.set(true);
    } else {
      this.isEditing.set(true);
      this.enableEditableControls();
    }
  }

  protected cancelEdit(): void {
    const info = this.companyInfo();
    if (info) {
      this.companyForm.reset({
        name: info.name,
        documentType: info.documentType,
        documentNumber: info.documentValue,
        createdAt: info.createdDate,
        status: info.status
      });
    }
    this.isEditing.set(false);
    this.disableEditableControls();
  }

  protected onConfirmSave(): void {
    this.showConfirmDialog.set(false);
    this.saveChanges();
  }

  protected onCancelConfirm(): void {
    this.showConfirmDialog.set(false);
  }

  protected copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text);
  }

  private loadCompanyInfo(): void {
    this.companyService.getInfoCompany().subscribe((response) => {
      this.companyInfo.set(response);
      this.companyForm.patchValue({
        name: response.name,
        documentType: response.documentType,
        documentNumber: response.documentValue,
        createdAt: response.createdDate,
        status: response.status,
      });
      this.owner.update((o) => ({ ...o, joinedAt: response.createdDate }));
    });
  }

  private saveChanges(): void {
    if (this.companyForm.invalid) return;

    this.isSaving.set(true);
    // TODO: wire up real API call
    setTimeout(() => {
      this.isSaving.set(false);
      this.isEditing.set(false);
      this.disableEditableControls();
    }, 1000);
  }

  private enableEditableControls(): void {
    this.companyForm.get('name')?.enable();
    this.companyForm.get('documentType')?.enable();
    this.companyForm.get('documentNumber')?.enable();
  }

  private disableEditableControls(): void {
    this.companyForm.get('name')?.disable();
    this.companyForm.get('documentType')?.disable();
    this.companyForm.get('documentNumber')?.disable();
  }
}
