import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { SupportTicketService } from '../../services/support-ticket.service';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { clearServerErrors } from '../../services/api-error';
import { SupportTicketChannel } from '../../types/support.types';

/**
 * Popup de Suporte — renderizado como overlay full-screen (via rota `/suporte`).
 * Usuário descreve o problema, escolhe canal (email ou WhatsApp). Ticket é
 * gravado no backend (audit + painel admin em /admin/suporte); se WhatsApp,
 * também abre wa.me em nova aba com a descrição pré-preenchida.
 * Fechar (Cancelar, backdrop, ESC, X) navega de volta pra rota anterior.
 */
@Component({
  selector: 'app-support',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AlertBanner, FormField, FieldControl],
  templateUrl: './support.html',
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class SupportPage {
  private readonly location = inject(Location);
  private readonly service = inject(SupportTicketService);
  private readonly fb = inject(FormBuilder);
  private readonly externalNav = inject(ExternalNavigationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  protected readonly whatsappNumber = environment.supportWhatsapp;
  protected readonly whatsappEnabled = this.whatsappNumber.length > 0;

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly messageMessages: Readonly<Record<string, string>> = {
    required: 'Descreva seu problema.',
    minlength: 'Descreva seu problema em pelo menos 10 caracteres.',
    maxlength: 'Use no máximo 2000 caracteres.',
  };

  protected readonly form = this.fb.nonNullable.group({
    message: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(2000)]],
  });

  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly messageLength = computed(() => (this.formValue()?.message ?? '').length);

  protected sendViaEmail(): void {
    if (!this.validate()) return;
    this.submit('EMAIL', () => {
      this.notifications.success('Ticket enviado — nosso time responderá por email em breve.');
    });
  }

  protected sendViaWhatsapp(): void {
    if (!this.whatsappEnabled) return;
    if (!this.validate()) return;
    const text = this.form.getRawValue().message.trim();
    this.submit('WHATSAPP', () => {
      const wa = `https://wa.me/${this.whatsappNumber}?text=${encodeURIComponent(text)}`;
      this.externalNav.openExternal(wa);
      this.notifications.success('Ticket registrado e conversa aberta no WhatsApp.');
    });
  }

  protected close(): void {
    this.location.back();
  }

  /**
   * The "mínimo 10 caracteres" rule belongs to the field, not to the screen banner —
   * `app-form-field` renders it under the textarea from the validator key.
   */
  private validate(): boolean {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return false;
    }
    return true;
  }

  private submit(channel: SupportTicketChannel, onSuccess: () => void): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    clearServerErrors(this.form);
    const message = this.form.getRawValue().message.trim();
    this.service.create({ message, channel }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.reset({ message: '' });
        onSuccess();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const { formMessage } = this.apiErrors.handleForm(
          err,
          this.form,
          'Não foi possível enviar. Tente novamente.',
        );
        this.error.set(formMessage);
      },
    });
  }
}
