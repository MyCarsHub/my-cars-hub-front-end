import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { SessionService } from '../../services/session.service';
import { CompanyService } from '../../services/company.service';

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
  imports: [CommonModule, ReactiveFormsModule, PrimaryInput, DefaultPageLayout],
  templateUrl: './company-settings.html',
  styleUrl: './company-settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanySettings {
  private readonly fb = inject(FormBuilder);
  private readonly sessionService = inject(SessionService);
  private readonly companyService = inject(CompanyService);

  createdAt: string = '';

  ngOnInit() {
    this.getInfoCompany();
  }

  protected readonly companyForm = this.fb.group({
    name: ['MyCarsHub Fleet Solutions', [Validators.required]],
    documentType: ['CNPJ', [Validators.required]],
    documentNumber: ['12.345.678/0001-90', [Validators.required]],
    createdAt: [{ value: this.createdAt, disabled: true }],
    status: [{ value: 'ACTIVE', disabled: true }],
  });

  protected readonly owner = signal<CompanyOwner>({
    name: this.sessionService.getItem('name') || '',
    email: this.sessionService.getItem('email') || '',
    joinedAt: this.createdAt,
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

  protected toggleEdit(): void {
    if (this.isEditing()) {
      this.saveChanges();
    } else {
      this.isEditing.set(true);
    }
  }

  protected cancelEdit(): void {
    this.companyForm.reset({
      name: 'MyCarsHub Fleet Solutions',
      documentType: 'CNPJ',
      documentNumber: '12.345.678/0001-90',
      createdAt: '15 de Março, 2024',
      status: 'ACTIVE'
    });
    this.isEditing.set(false);
  }


  private getInfoCompany() {
    this.companyService.getInfoCompany().subscribe((response) => {
      this.companyForm.patchValue(response);
      this.createdAt = response.createdDate;
    });
  }

  private saveChanges(): void {
    if (this.companyForm.invalid) return;

    this.isSaving.set(true);
    setTimeout(() => {
      this.isSaving.set(false);
      this.isEditing.set(false);

    }, 1000);
  }

  protected copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text);
  }
}
