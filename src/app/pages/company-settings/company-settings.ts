import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { SessionService } from '../../services/session.service';
import { CompanyService } from '../../services/company.service';
import { CompanyFullResponse } from '../../types/company-full-response.type';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';

interface CompanyStats {
  activeUsers: number;
  pendingInvites: number;
  lastAdminAccess: string;
  companyId: string;
}

interface CompanyOwner {
  name: string;
  email: string;
  joinedAt: string;
}

interface BillingInfo {
  plan: 'TRIAL' | 'PRO' | 'ENTERPRISE';
  billingCycle: 'Monthly' | 'Yearly';
  nextBillingDate: string;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
}

@Component({
  selector: 'app-company-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, PrimaryInput, DefaultPageLayout, ConfirmDialog],
  templateUrl: './company-settings.html',
  styleUrl: './company-settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanySettings {
  private readonly fb = inject(FormBuilder);
  private readonly sessionService = inject(SessionService);
  private readonly companyService = inject(CompanyService);

  protected readonly companyInfo = signal<CompanyFullResponse | null>(null);

  ngOnInit() {
    this.getInfoCompany();
  }

  protected readonly companyForm = this.fb.group({
    name: [{ value: '', disabled: true }, [Validators.required]],
    documentType: [{ value: '', disabled: true }, [Validators.required]],
    documentNumber: [{ value: '', disabled: true }, [Validators.required]],
    createdAt: [{ value: '', disabled: true }],
    status: [{ value: '', disabled: true }],
  });

  protected readonly owner = signal<CompanyOwner>({
    name: this.sessionService.getItem('name') || '',
    email: this.sessionService.getItem('email') || '',
    joinedAt: '',
  });

  protected readonly billing = signal<BillingInfo>({
    plan: 'PRO',
    billingCycle: 'Yearly',
    nextBillingDate: '15 de Março, 2025',
    status: 'ACTIVE',
  });

  protected readonly stats = signal<CompanyStats>({
    activeUsers: 12,
    pendingInvites: 3,
    lastAdminAccess: 'Há 2 horas',
    companyId: '550e8400-e29b-41d4-a716-446655440000',
  });

  protected readonly isEditing = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly showConfirmDialog = signal(false);

  protected toggleEdit(): void {
    if (this.isEditing()) {
      this.showConfirmDialog.set(true);
    } else {
      this.isEditing.set(true);
      this.companyForm.get('name')?.enable();
      this.companyForm.get('documentType')?.enable();
      this.companyForm.get('documentNumber')?.enable();
    }
  }

  protected onConfirmSave(): void {
    this.showConfirmDialog.set(false);
    this.saveChanges();
  }

  protected onCancelConfirm(): void {
    this.showConfirmDialog.set(false);
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
    this.companyForm.get('name')?.disable();
    this.companyForm.get('documentType')?.disable();
    this.companyForm.get('documentNumber')?.disable();
  }

  private getInfoCompany() {
    this.companyService.getInfoCompany().subscribe((response) => {
      this.companyInfo.set(response);
      this.companyForm.patchValue({
        name: response.name,
        documentType: response.documentType,
        documentNumber: response.documentValue,
        createdAt: response.createdDate,
        status: response.status
      });
      this.owner.update(o => ({ ...o, joinedAt: response.createdDate }));
    });
  }

  private saveChanges(): void {
    if (this.companyForm.invalid) return;

    this.isSaving.set(true);
    setTimeout(() => {
      this.isSaving.set(false);
      this.isEditing.set(false);
      this.companyForm.get('name')?.disable();
      this.companyForm.get('documentType')?.disable();
      this.companyForm.get('documentNumber')?.disable();
    }, 1000);
  }

  protected copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text);
  }
}
